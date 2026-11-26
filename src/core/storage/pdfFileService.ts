import { useAppStore } from '@/store/useAppStore';
import { PDFManager } from '@/core/pdf/pdfManager';
import { PDFAnnotationSerializer } from '@/core/serialization/pdfAnnotationSerializer';

export interface SaveDocumentResult {
  saved: boolean;
  cancelled?: boolean;
  fileName?: string;
  mode?: 'overwrite' | 'save_as' | 'download';
}

/**
 * Apre uno o più PDF tramite il dialogo nativo di Windows (/__api/open-native-multi)
 * quando si è nell'eseguibile portatile — zero popup di sicurezza Edge/127.0.0.1 —
 * rilevando automaticamente se il file è già aperto/bloccato altrove (modalità Sola Lettura).
 * Nel browser standard usa File System Access API o <input type="file">.
 */
export async function openPdfFilesWithPicker(onFallback: () => void): Promise<void> {
  // 1. Canale nativo Windows (Host Portatile OpenRevu-Portable-Light.exe)
  try {
    const res = await fetch('/__api/open-native-multi', { cache: 'no-store' });
    if (res.status === 204) {
      // Utente ha annullato la finestra di apertura Windows
      return;
    }
    if (res.status === 200) {
      const data = await res.json();
      const files: { fileName: string; filePath: string; readOnly?: boolean }[] = data?.files || [];
      if (files.length === 0) return;

      const loadedDocs: {
        id: string;
        fileName: string;
        bytes: Uint8Array;
        numPages: number;
        pagesInfo: any[];
        markups: any[];
        nativeFilePath: string;
        isReadOnly: boolean;
      }[] = [];
      const readOnlyNames: string[] = [];

      for (const f of files) {
        const readRes = await fetch('/__api/read-native', {
          method: 'GET',
          headers: { 'X-File-Path': encodeURIComponent(f.filePath) },
          cache: 'no-store',
        });
        if (!readRes.ok) continue;
        const buffer = await readRes.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const isReadOnly =
          Boolean(f.readOnly) || readRes.headers.get('X-File-ReadOnly') === 'true';
        const docId = crypto.randomUUID();
        const result = await PDFManager.getInstance().loadDocument(bytes, docId);
        loadedDocs.push({
          id: docId,
          fileName: f.fileName,
          bytes,
          numPages: result.numPages,
          pagesInfo: result.pagesInfo,
          markups: result.existingMarkups,
          nativeFilePath: f.filePath,
          isReadOnly,
        });
        if (isReadOnly) {
          readOnlyNames.push(f.fileName);
        }
      }

      if (loadedDocs.length > 0) {
        useAppStore.getState().openMultipleDocuments(loadedDocs);
        if (readOnlyNames.length > 0) {
          alert(
            `Documento aperto in SOLA LETTURA:\n• ${readOnlyNames.join('\n• ')}\n\n` +
              `Il file è attualmente aperto da un altro programma/utente o è protetto da scrittura.\n` +
              `Puoi comunque visualizzarlo e aggiungere annotazioni, ma per salvare dovrai usare "Salva con nome".`
          );
        }
      }
      return;
    }
  } catch {
    // Non siamo nell'host portatile: prosegui con il picker browser
  }

  // 2. Fallback browser (File System Access API / <input type="file">)
  const showOpenFilePicker = (window as any).showOpenFilePicker;
  if (typeof showOpenFilePicker !== 'function') {
    onFallback();
    return;
  }

  try {
    const handles: any[] = await showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: 'Documenti PDF',
          accept: { 'application/pdf': ['.pdf'] },
        },
      ],
    });
    if (!handles || handles.length === 0) return;

    const loadedDocs: {
      id: string;
      fileName: string;
      bytes: Uint8Array;
      numPages: number;
      pagesInfo: any[];
      markups: any[];
      fileHandle: any;
    }[] = [];

    for (const handle of handles) {
      const file: File = await handle.getFile();
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const docId = crypto.randomUUID();
      const result = await PDFManager.getInstance().loadDocument(bytes, docId);
      loadedDocs.push({
        id: docId,
        fileName: file.name,
        bytes,
        numPages: result.numPages,
        pagesInfo: result.pagesInfo,
        markups: result.existingMarkups,
        fileHandle: handle,
      });
    }

    useAppStore.getState().openMultipleDocuments(loadedDocs);
  } catch (err: any) {
    if (err?.name === 'AbortError') return;
    console.warn('showOpenFilePicker fallback:', err);
    onFallback();
  }
}

/**
 * Salva il documento attivo:
 * - Se `saveAs` è false e il documento ha `nativeFilePath` o `fileHandle`, sovrascrive il file originale.
 * - Se `saveAs` è true (o non esiste alcun handle/percorso), apre "Salva con nome..." e aggiorna l'handle attivo.
 */
export async function saveActiveDocument(options?: { saveAs?: boolean }): Promise<SaveDocumentResult> {
  const saveAs = Boolean(options?.saveAs);
  const state = useAppStore.getState();
  const { activeDocumentId, openDocuments, fileName, fileBytes, markups } = state;

  if (!fileBytes) {
    alert('Nessun file PDF aperto da salvare.');
    return { saved: false };
  }

  const activeDoc = openDocuments.find((d) => d.id === activeDocumentId);
  const bookmarksToSave = activeDoc?.bookmarksDirty ? activeDoc.bookmarks : undefined;
  const exportedBytes = await PDFAnnotationSerializer.exportMarkupsToPDF(
    fileBytes,
    markups,
    bookmarksToSave
  );
  let effectiveSaveAs = saveAs;

  // Se il documento è in sola lettura (aperto altrove o protetto), impedisci sovrascrittura e apri Salva con nome
  if (!effectiveSaveAs && activeDoc?.isReadOnly) {
    alert(
      `Il file "${activeDoc.fileName}" è aperto in SOLA LETTURA.\n` +
        `Le modifiche possono essere salvate solo con "Salva con nome".`
    );
    effectiveSaveAs = true;
  }

  // 1. Sovrascrittura diretta su file nativo (Host Portatile Windows, zero popup Edge)
  if (!effectiveSaveAs && activeDoc?.nativeFilePath) {
    try {
      const res = await fetch('/__api/save-native', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'X-File-Path': encodeURIComponent(activeDoc.nativeFilePath),
        },
        body: exportedBytes as unknown as BodyInit,
      });
      if (res.ok) {
        state.markDocumentSaved(activeDocumentId);
        return { saved: true, fileName: activeDoc.fileName, mode: 'overwrite' };
      }
      if (res.status === 423) {
        state.updateActiveDocumentSaveTarget({ isReadOnly: true });
        alert(
          `Impossibile sovrascrivere "${activeDoc.fileName}" perché il file è aperto da un altro programma/utente o è in sola lettura.\n\n` +
            `Si aprirà "Salva con nome" per salvare una copia con le tue modifiche.`
        );
        effectiveSaveAs = true;
      }
    } catch (err) {
      console.warn('Salvataggio nativo non riuscito, passo al picker:', err);
    }
  }

  // 2. Sovrascrittura diretta tramite FileSystemFileHandle (solo browser standard)
  if (!effectiveSaveAs && activeDoc?.fileHandle) {
    try {
      const handle = activeDoc.fileHandle;
      if (typeof handle.queryPermission === 'function') {
        let perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted' && typeof handle.requestPermission === 'function') {
          perm = await handle.requestPermission({ mode: 'readwrite' });
        }
        if (perm !== 'granted') {
          throw new Error('Permesso di scrittura negato sul file originale');
        }
      }
      const writable = await handle.createWritable();
      await writable.write(exportedBytes);
      await writable.close();
      state.markDocumentSaved(activeDocumentId);
      return { saved: true, fileName: activeDoc.fileName, mode: 'overwrite' };
    } catch (err: any) {
      if (err?.name === 'AbortError') return { saved: false, cancelled: true };
      console.warn('Sovrascrittura tramite fileHandle fallita, apro Salva con nome:', err);
    }
  }

  const suggestedName = fileName && fileName.toLowerCase().endsWith('.pdf')
    ? fileName
    : `${(fileName || 'documento').replace(/\.pdf$/i, '')}.pdf`;

  // 2b. Salvataggio nativo su Android (Capacitor Filesystem -> Documents/OpenRevu)
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < exportedBytes.length; i += chunkSize) {
        const chunk = exportedBytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
      }
      const base64Data = btoa(binary);
      const targetPath = `OpenRevu/${suggestedName}`;
      await Filesystem.writeFile({
        path: targetPath,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true,
      });
      state.markDocumentSaved(activeDocumentId);
      alert(`PDF salvato in Documenti/${targetPath}`);
      return { saved: true, fileName: suggestedName, mode: 'overwrite' };
    }
  } catch (androidSaveErr) {
    console.warn('Salvataggio Capacitor Android non riuscito, passo al fallback:', androidSaveErr);
  }

  // 3. Salva con nome nativo su host portatile (apre SaveFileDialog di Windows, zero popup Edge)
  try {
    const res = await fetch('/__api/save-as-native', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-Suggested-Path': encodeURIComponent(activeDoc?.nativeFilePath || suggestedName),
      },
      body: exportedBytes as unknown as BodyInit,
    });
    if (res.status === 204) {
      return { saved: false, cancelled: true };
    }
    if (res.status === 423) {
      alert(
        'Il file di destinazione selezionato è attualmente aperto da un altro programma o è protetto in sola lettura.\nScegli un nome file diverso.'
      );
      return { saved: false };
    }
    if (res.ok) {
      const data = await res.json();
      state.updateActiveDocumentSaveTarget({
        nativeFilePath: data.filePath,
        fileHandle: undefined,
        fileName: data.fileName || suggestedName,
        isReadOnly: false,
      });
      state.markDocumentSaved(activeDocumentId);
      return { saved: true, fileName: data.fileName || suggestedName, mode: 'save_as' };
    }
  } catch (err) {
    console.warn('Salva con nome nativo non disponibile (modalità browser), passo al picker:', err);
  }

  // 4. Salva con nome browser (File System Access API)

  if (typeof (window as any).showSaveFilePicker === 'function') {
    try {
      const pickerOpts: any = {
        suggestedName,
        types: [
          {
            description: 'Documento PDF con Annotazioni',
            accept: { 'application/pdf': ['.pdf'] },
          },
        ],
      };
      if (activeDoc?.fileHandle) {
        pickerOpts.startIn = activeDoc.fileHandle;
      }
      const handle = await (window as any).showSaveFilePicker(pickerOpts);
      const writable = await handle.createWritable();
      await writable.write(exportedBytes);
      await writable.close();

      const savedName = handle.name || suggestedName;
      state.updateActiveDocumentSaveTarget({
        fileHandle: handle,
        nativeFilePath: undefined,
        fileName: savedName,
      });
      state.markDocumentSaved(activeDocumentId);
      return { saved: true, fileName: savedName, mode: 'save_as' };
    } catch (pickerErr: any) {
      if (pickerErr?.name === 'AbortError') {
        return { saved: false, cancelled: true };
      }
    }
  }

  // 4. Fallback download standard
  const blob = new Blob([exportedBytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  state.markDocumentSaved(activeDocumentId);
  return { saved: true, fileName: suggestedName, mode: 'download' };
}

/**
 * Controlla all'avvio se l'host portatile ha ricevuto un file PDF da riga di comando ("Apri con").
 */
export async function loadStartupNativeFileIfPresent(): Promise<void> {
  try {
    const res = await fetch('/__api/startup-file', { cache: 'no-store' });
    if (res.status !== 200) return;

    const encodedPath = res.headers.get('X-File-Path');
    const encodedName = res.headers.get('X-File-Name');
    const isReadOnly = res.headers.get('X-File-ReadOnly') === 'true';
    const nativeFilePath = encodedPath ? decodeURIComponent(encodedPath) : '';
    const fileName = encodedName ? decodeURIComponent(encodedName) : 'documento.pdf';
    if (!nativeFilePath) return;

    const buffer = await res.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) return;

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
      { nativeFilePath, isReadOnly }
    );
    if (isReadOnly) {
      alert(
        `Il documento "${fileName}" è attualmente aperto da un altro programma/utente o è in sola lettura.\n` +
          `È stato aperto in SOLA LETTURA: le modifiche potranno essere salvate solo con "Salva con nome".`
      );
    }
  } catch {
    // Non siamo nell'host portatile o nessun file di avvio
  }
}
