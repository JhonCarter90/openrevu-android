import { useAppStore } from '@/store/useAppStore';
import { PDFManager } from '@/core/pdf/pdfManager';
import { AnyMarkup } from '@/types/markup';

export interface StudioPeerInfo {
  author: string;
  updatedAt: number;
  markupCount: number;
  isOnline: boolean;
}

export interface StudioLiveState {
  active: boolean;
  docId: string | null;
  nativeFilePath: string | null;
  peers: StudioPeerInfo[];
  lastSyncAt: number | null;
  error: string | null;
}

type Listener = (state: StudioLiveState) => void;

class StudioLiveManager {
  private state: StudioLiveState = {
    active: false,
    docId: null,
    nativeFilePath: null,
    peers: [],
    lastSyncAt: null,
    error: null,
  };
  private listeners = new Set<Listener>();
  private intervalId: number | null = null;
  private syncing = false;
  private lastMergedSignature = '';

  public getState(): StudioLiveState {
    return this.state;
  }

  public subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(partial: Partial<StudioLiveState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((fn) => fn(this.state));
  }

  /**
   * Apre un PDF da cartella condivisa tramite finestra nativa dell'host portatile
   * (ottenendo il percorso di rete reale) e avvia subito Studio Live.
   */
  public async openSharedPdfAndStart(): Promise<boolean> {
    try {
      const res = await fetch('/__api/open-native', { cache: 'no-store' });
      if (res.status === 204) return false;
      if (!res.ok) {
        alert('Studio Live su cartella condivisa richiede l\'eseguibile desktop OpenRevu-Portable-Light.exe.');
        return false;
      }

      const encodedPath = res.headers.get('X-File-Path');
      const encodedName = res.headers.get('X-File-Name');
      const nativeFilePath = encodedPath ? decodeURIComponent(encodedPath) : '';
      const fileName = encodedName ? decodeURIComponent(encodedName) : 'documento.pdf';
      if (!nativeFilePath) return false;

      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const docId = crypto.randomUUID();
      const loaded = await PDFManager.getInstance().loadDocument(bytes, docId);
      useAppStore.getState().openDocument(
        fileName,
        bytes,
        loaded.numPages,
        loaded.pagesInfo,
        loaded.existingMarkups,
        docId,
        { nativeFilePath }
      );

      this.start(docId, nativeFilePath);
      return true;
    } catch {
      alert('Studio Live su cartella condivisa richiede l\'eseguibile desktop OpenRevu-Portable-Light.exe.');
      return false;
    }
  }

  public start(docId: string, nativeFilePath: string) {
    this.stop();
    this.lastMergedSignature = '';
    this.emit({
      active: true,
      docId,
      nativeFilePath,
      peers: [],
      error: null,
    });
    void this.syncOnce();
    this.intervalId = window.setInterval(() => {
      void this.syncOnce();
    }, 2500);
  }

  public stop() {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.emit({
      active: false,
      docId: null,
      nativeFilePath: null,
      peers: [],
      error: null,
    });
  }

  public async toggleForActiveDocument(): Promise<void> {
    const st = useAppStore.getState();
    const activeDoc = st.openDocuments.find((d) => d.id === st.activeDocumentId);

    if (this.state.active && this.state.docId === st.activeDocumentId) {
      this.stop();
      return;
    }

    if (activeDoc?.nativeFilePath) {
      this.start(activeDoc.id, activeDoc.nativeFilePath);
      return;
    }

    await this.openSharedPdfAndStart();
  }

  public async syncOnce(): Promise<void> {
    if (!this.state.active || !this.state.nativeFilePath || this.syncing) return;

    const st = useAppStore.getState();
    const targetDoc = st.openDocuments.find((d) => d.id === this.state.docId);
    if (!targetDoc) {
      this.stop();
      return;
    }

    this.syncing = true;
    try {
      const myAuthor = (st.currentUser || 'Utente').trim() || 'Utente';
      const isActive = st.activeDocumentId === targetDoc.id;
      const allMarkups = isActive ? st.markups : targetDoc.markups;

      // Invia SOLO i markup creati/modificati localmente da questo utente (non quelli importati dai colleghi)
      const myOwnMarkups = allMarkups.filter((m) => !(m as any).__studioPeer);

      const payload = JSON.stringify({
        author: myAuthor,
        updatedAt: Date.now(),
        markups: myOwnMarkups,
      });

      const res = await fetch('/__api/studio-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-File-Path': encodeURIComponent(this.state.nativeFilePath),
          'X-Author': encodeURIComponent(myAuthor),
        },
        body: payload,
      });

      if (!res.ok) {
        this.emit({ error: `Errore sincronizzazione (${res.status})` });
        return;
      }

      const data = (await res.json()) as {
        ok: boolean;
        peers?: Array<{ author: string; updatedAt: number; markups: AnyMarkup[] }>;
      };

      const now = Date.now();
      const peerList: StudioPeerInfo[] = [];
      const peerMarkups: AnyMarkup[] = [];
      const myIds = new Set(myOwnMarkups.map((m) => m.id));

      for (const p of data.peers || []) {
        if (!p || !p.author) continue;
        peerList.push({
          author: p.author,
          updatedAt: p.updatedAt || 0,
          markupCount: Array.isArray(p.markups) ? p.markups.length : 0,
          isOnline: now - (p.updatedAt || 0) < 30_000,
        });
        if (Array.isArray(p.markups)) {
          for (const pm of p.markups) {
            if (!pm || !pm.id || myIds.has(pm.id)) continue;
            // Evita duplicati di annotazioni già presenti nel PDF originale all'apertura
            if (pm.id.startsWith('pdf_annot_')) continue;
            peerMarkups.push({
              ...pm,
              author: pm.author || p.author,
              __studioPeer: p.author,
            } as any);
          }
        }
      }

      const sig = peerMarkups
        .map((m) => `${m.id}:${m.modificationDate || ''}`)
        .sort()
        .join('|');

      if (sig !== this.lastMergedSignature) {
        this.lastMergedSignature = sig;
        const latestState = useAppStore.getState();
        const latestDoc = latestState.openDocuments.find((d) => d.id === this.state.docId);
        if (latestDoc) {
          const isCur = latestState.activeDocumentId === latestDoc.id;
          const baseOwn = (isCur ? latestState.markups : latestDoc.markups).filter(
            (m) => !(m as any).__studioPeer
          );
          const merged = [...baseOwn, ...peerMarkups];
          useAppStore.setState({
            openDocuments: latestState.openDocuments.map((d) =>
              d.id === latestDoc.id ? { ...d, markups: merged } : d
            ),
            ...(isCur ? { markups: merged } : {}),
          });
        }
      }

      this.emit({
        peers: peerList,
        lastSyncAt: now,
        error: null,
      });
    } catch {
      this.emit({ error: 'Cartella di rete temporaneamente non raggiungibile' });
    } finally {
      this.syncing = false;
    }
  }
}

export const studioLiveService = new StudioLiveManager();
