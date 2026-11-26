import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFPageInfo } from '@/types/pdf';
import { AnyMarkup } from '@/types/markup';
import { resolveOriginalPdfFont } from '@/core/fonts/fontDefinitions';
import { PDFAnnotationSerializer } from '@/core/serialization/pdfAnnotationSerializer';

// Imposta il worker di PDF.js per Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface RenderTaskHandle {
  cancel: () => void;
  promise: Promise<void>;
}

export interface SafeCanvasMetrics {
  pixelWidth: number;
  pixelHeight: number;
  effectiveDpr: number;
  isCapped: boolean;
}

export class PDFManager {
  public static readonly MAX_CANVAS_DIM = 4096;
  public static readonly MAX_CANVAS_PIXELS = 12_582_912; // ~48 MB RGBA VRAM budget per canvas

  private static instance: PDFManager;
  private docs: Map<string, pdfjsLib.PDFDocumentProxy> = new Map();
  private docDataRefs: Map<string, ArrayBuffer | Uint8Array> = new Map();
  private activeRenderTasks: Map<string, pdfjsLib.RenderTask> = new Map();

  private constructor() {}

  /**
   * Calcola dimensioni pixel sicure per Canvas HTML5 evitando overflow GPU/VRAM
   * su tavole CAD A0/A1 ad alto zoom.
   */
  public static computeSafeCanvasMetrics(
    cssWidth: number,
    cssHeight: number,
    desiredDpr: number = Math.min(window.devicePixelRatio || 1, 2.5)
  ): SafeCanvasMetrics {
    const safeW = Math.max(1, cssWidth);
    const safeH = Math.max(1, cssHeight);
    const dimLimitDpr = PDFManager.MAX_CANVAS_DIM / Math.max(safeW, safeH);
    const areaLimitDpr = Math.sqrt(PDFManager.MAX_CANVAS_PIXELS / (safeW * safeH));
    const effectiveDpr = Math.max(0.25, Math.min(desiredDpr, dimLimitDpr, areaLimitDpr));
    const isCapped = effectiveDpr < desiredDpr - 0.02;
    return {
      pixelWidth: Math.max(1, Math.floor(safeW * effectiveDpr)),
      pixelHeight: Math.max(1, Math.floor(safeH * effectiveDpr)),
      effectiveDpr,
      isCapped,
    };
  }

  public static getInstance(): PDFManager {
    if (!PDFManager.instance) {
      PDFManager.instance = new PDFManager();
    }
    return PDFManager.instance;
  }

  /**
   * Carica un documento PDF da un buffer per un dato docId ('primary' o 'secondary')
   */
  public async loadDocument(
    data: ArrayBuffer | Uint8Array,
    docId: string = 'primary'
  ): Promise<{
    doc: pdfjsLib.PDFDocumentProxy;
    numPages: number;
    pagesInfo: PDFPageInfo[];
    existingMarkups: AnyMarkup[];
  }> {
    this.cancelDocRenders(docId);
    const existing = this.docs.get(docId);
    if (existing) {
      try {
        await existing.destroy();
      } catch (err) {
        console.warn(`Errore rilascio documento precedente [${docId}]:`, err);
      }
      this.docs.delete(docId);
    }

    // Copia sicura dei byte per prevenire detaching da parte del Web Worker di PDF.js
    const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.docDataRefs.set(docId, data);
    const dataCopy = uint8.slice(0);
    const pdfLibBytes = uint8.slice(0);

    const loadingTask = pdfjsLib.getDocument({
      data: dataCopy,
      cMapUrl: './cmaps/',
      cMapPacked: true,
      standardFontDataUrl: './standard_fonts/',
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: false,
    });

    const doc = await loadingTask.promise;
    this.docs.set(docId, doc);
    // Imposta anche come 'primary' per fallback universale
    this.docs.set('primary', doc);
    const numPages = doc.numPages;

    const pageNumbers = Array.from({ length: numPages }, (_, idx) => idx + 1);
    const [pages, pageLabels] = await Promise.all([
      Promise.all(pageNumbers.map((n) => doc.getPage(n))),
      doc.getPageLabels().catch(() => null),
    ]);

    const pagesInfo: PDFPageInfo[] = pages.map((page, idx) => {
      const viewport = page.getViewport({ scale: 1.0 });
      const rawLabel = pageLabels && pageLabels[idx] ? String(pageLabels[idx]).trim() : '';
      return {
        pageNumber: idx + 1,
        pageIndex: idx,
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation,
        label: rawLabel && rawLabel !== String(idx + 1) ? rawLabel : undefined,
      };
    });

    const existingMarkups = await PDFAnnotationSerializer.extractMarkupsFromDocument(
      doc,
      pages,
      docId,
      pdfLibBytes
    );

    return {
      doc,
      numPages,
      pagesInfo,
      existingMarkups,
    };
  }

  /**
   * Estrae i segnalibri nativi del PDF (Outline) risolvendo il numero di pagina di destinazione
   */
  public async getDocumentOutline(
    docId: string = 'primary'
  ): Promise<Array<{ id: string; title: string; pageNumber: number }>> {
    const doc =
      this.docs.get(docId) ||
      this.docs.get('primary') ||
      (this.docs.size > 0 ? Array.from(this.docs.values())[0] : null);
    if (!doc) return [];

    try {
      const outline = await doc.getOutline();
      if (!outline || outline.length === 0) return [];

      const results: Array<{ id: string; title: string; pageNumber: number }> = [];
      const resolveDestPage = async (dest: any): Promise<number> => {
        try {
          let destArray = dest;
          if (typeof dest === 'string') {
            destArray = await doc.getDestination(dest);
          }
          if (Array.isArray(destArray) && destArray[0]) {
            const pageIdx = await doc.getPageIndex(destArray[0]);
            return pageIdx + 1;
          }
        } catch {
          // fallback
        }
        return 1;
      };

      const walk = async (items: any[], depth: number = 0) => {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const pageNumber = item.dest ? await resolveDestPage(item.dest) : Math.min(doc.numPages, results.length + 1);
          const prefix = depth > 0 ? `${'  '.repeat(depth)}↳ ` : '';
          results.push({
            id: `outline_${depth}_${i}_${pageNumber}`,
            title: `${prefix}${item.title || `Pagina ${pageNumber}`}`,
            pageNumber,
          });
          if (item.items && item.items.length > 0 && depth < 2) {
            await walk(item.items, depth + 1);
          }
        }
      };

      await walk(outline, 0);
      return results;
    } catch {
      return [];
    }
  }

  /**
   * Assicura che il documento con id docId sia presente in memoria.
   * Se non è presente o non coincide, lo carica automaticamente dal buffer dati.
   */
  public async ensureDocumentLoaded(
    docId: string,
    data: ArrayBuffer | Uint8Array
  ): Promise<pdfjsLib.PDFDocumentProxy> {
    const existing = this.docs.get(docId);
    const prevData = this.docDataRefs.get(docId);
    if (existing && prevData === data) {
      return existing;
    }
    const res = await this.loadDocument(data, docId);
    return res.doc;
  }

  /**
   * Calcola la rotazione effettiva sommando la rotazione intrinseca della pagina (/Rotate)
   * alla rotazione vista richiesta dall'utente, evitando di sovrascrivere page.rotate quando viewportRotation è 0.
   */
  public static getEffectiveRotation(pageRotate: number = 0, viewportRotation: number = 0): number {
    return (((pageRotate || 0) + (viewportRotation || 0)) % 360 + 360) % 360;
  }

  /**
   * Esegue il rendering ad altissima definizione della pagina su Canvas HTML5
   * Gestisce il DevicePixelRatio e l'hardware acceleration per fluidità a 60 FPS
   */
  public renderPage(
    canvas: HTMLCanvasElement,
    pageNumber: number,
    scale: number,
    viewportRotation: number = 0,
    docId: string = 'primary'
  ): RenderTaskHandle {
    const taskKey = `${docId}_${pageNumber}`;

    // Se c'è già un rendering in corso su questa pagina, annullalo
    if (this.activeRenderTasks.has(taskKey)) {
      try {
        this.activeRenderTasks.get(taskKey)?.cancel();
      } catch (e) {
        // ignora se già completato o annullato
      }
      this.activeRenderTasks.delete(taskKey);
    }

    let isCancelled = false;

    const promise = (async () => {
      // Fallback universale: prova docId, poi 'primary', poi il primo documento caricato in memoria
      const doc = this.docs.get(docId) || this.docs.get('primary') || (this.docs.size > 0 ? Array.from(this.docs.values())[0] : null);
      if (!doc) {
        throw new Error(`Nessun documento PDF caricato per [${docId}]`);
      }

      const page = await doc.getPage(pageNumber);
      if (isCancelled) return;

      const viewport = page.getViewport({
        scale: scale,
        rotation: PDFManager.getEffectiveRotation(page.rotate, viewportRotation),
      });

      // Calcola il moltiplicatore DPI sicuro entro il budget VRAM/GPU per evitare canvas bianchi su A0/A1 ad alto zoom
      const desiredDpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const metrics = PDFManager.computeSafeCanvasMetrics(viewport.width, viewport.height, desiredDpr);
      canvas.width = metrics.pixelWidth;
      canvas.height = metrics.pixelHeight;
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        throw new Error('Impossibile ottenere il contesto 2D del Canvas');
      }

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.scale(metrics.effectiveDpr, metrics.effectiveDpr);

      // Sfondo bianco tecnico
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, viewport.width, viewport.height);

      const renderContext: any = {
        canvasContext: ctx,
        viewport: viewport,
        intent: 'display',
        annotationMode: 0, // Disabilita il rendering statico di PDF.js: i markup sono renderizzati e modificabili sul layer interattivo OpenRevu
      };

      const renderTask = page.render(renderContext);
      this.activeRenderTasks.set(taskKey, renderTask);

      try {
        await renderTask.promise;
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error(`Errore render pagina ${pageNumber} [${docId}]:`, err);
          throw err;
        }
      } finally {
        ctx.restore();
        this.activeRenderTasks.delete(taskKey);
      }
    })();

    return {
      cancel: () => {
        isCancelled = true;
        const task = this.activeRenderTasks.get(taskKey);
        if (task) {
          try {
            task.cancel();
          } catch (e) {}
          this.activeRenderTasks.delete(taskKey);
        }
      },
      promise,
    };
  }

  /**
   * Renderizza in alta definizione (HiDPI 1:1) solo una porzione ritagliata della pagina (Tile/Viewport).
   * Permette zoom profondo (300% - 1200%) su tavole CAD A0/A1 con linee affilate senza saturare la VRAM.
   */
  public renderPageRegion(
    canvas: HTMLCanvasElement,
    pageNumber: number,
    scale: number,
    viewportRotation: number,
    region: { x: number; y: number; width: number; height: number },
    docId: string = 'primary'
  ): RenderTaskHandle {
    const taskKey = `${docId}_${pageNumber}_tile`;
    if (this.activeRenderTasks.has(taskKey)) {
      try {
        this.activeRenderTasks.get(taskKey)?.cancel();
      } catch {}
      this.activeRenderTasks.delete(taskKey);
    }

    let isCancelled = false;

    const promise = (async () => {
      const doc = this.docs.get(docId) || this.docs.get('primary') || (this.docs.size > 0 ? Array.from(this.docs.values())[0] : null);
      if (!doc) return;

      const page = await doc.getPage(pageNumber);
      if (isCancelled) return;

      const viewport = page.getViewport({
        scale,
        rotation: PDFManager.getEffectiveRotation(page.rotate, viewportRotation),
      });

      const regW = Math.max(1, Math.min(region.width, viewport.width - region.x));
      const regH = Math.max(1, Math.min(region.height, viewport.height - region.y));
      if (regW <= 1 || regH <= 1) return;

      const desiredDpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const metrics = PDFManager.computeSafeCanvasMetrics(regW, regH, desiredDpr);
      canvas.width = metrics.pixelWidth;
      canvas.height = metrics.pixelHeight;
      canvas.style.width = `${Math.floor(regW)}px`;
      canvas.style.height = `${Math.floor(regH)}px`;

      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.scale(metrics.effectiveDpr, metrics.effectiveDpr);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, regW, regH);
      ctx.translate(-region.x, -region.y);

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
        intent: 'display',
        annotationMode: 0,
      } as any);
      this.activeRenderTasks.set(taskKey, renderTask);

      try {
        await renderTask.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn(`Errore render tile pagina ${pageNumber}:`, err);
        }
      } finally {
        ctx.restore();
        this.activeRenderTasks.delete(taskKey);
      }
    })();

    return {
      cancel: () => {
        isCancelled = true;
        const task = this.activeRenderTasks.get(taskKey);
        if (task) {
          try {
            task.cancel();
          } catch {}
          this.activeRenderTasks.delete(taskKey);
        }
      },
      promise,
    };
  }

  /**
   * Rilascia in sicurezza la memoria del documento PDF chiuso dal worker PDF.js
   */
  public async releaseDocument(docId: string): Promise<void> {
    this.cancelDocRenders(docId);
    const doc = this.docs.get(docId);
    if (!doc) return;
    this.docs.delete(docId);
    // Rimuove anche il riferimento 'primary' se puntava allo stesso documento
    if (this.docs.get('primary') === doc) {
      this.docs.delete('primary');
    }
    // Verifica che nessun altro tab condivida lo stesso proxy prima di distruggerlo
    const stillReferenced = Array.from(this.docs.values()).includes(doc);
    if (!stillReferenced) {
      try {
        await doc.destroy();
      } catch {}
    }
  }

  public cancelDocRenders(docId: string) {
    for (const [key, task] of this.activeRenderTasks.entries()) {
      if (key.startsWith(`${docId}_`)) {
        try {
          task.cancel();
        } catch (e) {}
        this.activeRenderTasks.delete(key);
      }
    }
  }

  public cancelAllRenders() {
    this.activeRenderTasks.forEach((task) => {
      try {
        task.cancel();
      } catch (e) {}
    });
    this.activeRenderTasks.clear();
  }

  public getDocument(docId: string = 'primary'): pdfjsLib.PDFDocumentProxy | null {
    const doc = this.docs.get(docId) || this.docs.get('primary') || (this.docs.size > 0 ? this.docs.values().next().value : null);
    return doc || null;
  }

  /**
   * Estrae i blocchi di testo originali della pagina per selezione (Copia/Incolla)
   * e per lo strumento Modifica Testo Originale (stile Bluebeam Revu Edit Text).
   */
  public async getPageTextItems(
    pageNumber: number, 
    docId: string = 'primary'
  ): Promise<{ str: string; x: number; y: number; width: number; height: number; fontSize: number; fontFamily: string; fontWeight?: 'normal' | 'bold'; fontStyle?: 'normal' | 'italic'; rawFontName?: string }[]> {
    const doc = this.getDocument(docId);
    if (!doc) return [];
    try {
      const page = await doc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1.0 });
      const items: { str: string; x: number; y: number; width: number; height: number; fontSize: number; fontFamily: string; fontWeight?: 'normal' | 'bold'; fontStyle?: 'normal' | 'italic'; rawFontName?: string }[] = [];

      for (const item of textContent.items as any[]) {
        if (!item.str || item.str.trim().length === 0) continue;
        // Trasforma correttamente le coordinate testo tramite viewport.transform (supporta /Rotate 90/180/270 e CropBox)
        const vtx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const fontSize = Math.max(7, Math.hypot(vtx[0], vtx[1]));
        const x = vtx[4];
        const y = Math.max(0, vtx[5] - fontSize);
        const width = item.width > 0 ? item.width : item.str.length * fontSize * 0.55;
        const height = item.height > 0 ? item.height : fontSize * 1.2;

        const resolvedFont = resolveOriginalPdfFont(
          item.fontName || textContent.styles?.[item.fontName]?.fontFamily || ''
        );

        items.push({
          str: item.str,
          x,
          y,
          width,
          height,
          fontSize,
          fontFamily: resolvedFont.family,
          fontWeight: resolvedFont.fontWeight,
          fontStyle: resolvedFont.fontStyle,
          rawFontName: item.fontName,
        });
      }
      return items;
    } catch (e) {
      console.warn(`Errore estrazione testo pagina ${pageNumber}:`, e);
      return [];
    }
  }
}
