import { PDFManager } from '@/core/pdf/pdfManager';
import Tesseract from 'tesseract.js';

export interface AutoMarkRegion {
  // Coordinate percentuali relative alla pagina (0..1)
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

export type AutoMarkElement =
  | { type: 'region'; id: string; name: string; region: AutoMarkRegion }
  | { type: 'text'; id: string; value: string };

export interface ExtractedBookmark {
  id: string;
  pageNumber: number;
  title: string;
}

export class AutoMarkService {
  private static getActiveDoc(docId?: string) {
    const mgr = PDFManager.getInstance();
    let doc = docId ? mgr.getDocument(docId) : null;
    if (!doc) doc = mgr.getDocument('primary');
    if (!doc) {
      // Fallback: cerca il primo documento caricato in memoria
      doc = (mgr as any).docs?.values()?.next()?.value || null;
    }
    return doc;
  }

  /**
   * Estrae il testo da una data regione su una singola pagina.
   * Prova prima con l'estrazione vettoriale ad altissima velocità e precisione.
   * Se non viene rilevato testo (es. PDF scansionato/raster), usa Tesseract OCR.
   */
  public static async extractTextFromRegion(
    pageNumber: number,
    region: AutoMarkRegion,
    useOcrFallback: boolean = true,
    docId?: string
  ): Promise<string> {
    const doc = this.getActiveDoc(docId);
    if (!doc) {
      throw new Error('Nessun documento PDF caricato.');
    }

    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.0 });

    // 1. Estrazione vettoriale con PDF.js
    const textContent = await page.getTextContent();
    const regionX1 = region.xPct * viewport.width;
    const regionY1 = region.yPct * viewport.height;
    const regionX2 = regionX1 + region.widthPct * viewport.width;
    const regionY2 = regionY1 + region.heightPct * viewport.height;

    const matchedStrings: { text: string; x: number; y: number }[] = [];

    for (const item of textContent.items as any[]) {
      if (!item.str || !item.transform) continue;

      // Coordinate PDF.js transform: [scaleX, skewY, skewX, scaleY, tx, ty]
      const [scaleX, skewY, skewX, scaleY, tx, ty] = item.transform;
      const fontHeight = Math.hypot(skewX, scaleY) || item.height || 10;
      const fontWidth = Math.hypot(scaleX, skewY) || 10;
      const strWidth = item.width || (item.str.length * fontWidth * 0.55);

      // Conversione precisa coordinate PDF -> Viewport (supporta rotazioni e cropbox)
      const [vx, vyBaseline] = viewport.convertToViewportPoint(tx, ty);
      const vpCenterY = vyBaseline - fontHeight * 0.35;
      const vpLeft = vx;
      const vpRight = vx + strWidth;
      const vpCenterX = (vpLeft + vpRight) / 2;

      // Inclusione rigorosa geometrica all'interno della fence selezionata dall'utente:
      // 1. Controllo verticale: il centro della riga di testo deve cadere strettamente entro i limiti Y della regione
      const isVerticallyInside = vpCenterY >= regionY1 && vpCenterY <= regionY2;

      // 2. Controllo orizzontale: il centro o la maggior parte della parola/frase deve cadere nell'intervallo X
      const hOverlap = Math.max(0, Math.min(vpRight, regionX2) - Math.max(vpLeft, regionX1));
      const isHorizontallyInside = (vpCenterX >= regionX1 && vpCenterX <= regionX2) || (hOverlap >= Math.min(strWidth * 0.5, 12));

      if (isVerticallyInside && isHorizontallyInside) {
        matchedStrings.push({ text: item.str, x: vpLeft, y: vpCenterY });
      }
    }

    if (matchedStrings.length > 0) {
      // Ordina prima per Y (riga per riga, tolleranza 4pt) e poi per X (da sinistra a destra)
      matchedStrings.sort((a, b) => {
        if (Math.abs(a.y - b.y) > 4) return a.y - b.y;
        return a.x - b.x;
      });

      const extracted = matchedStrings
        .map((s) => s.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (extracted.length > 0) {
        return extracted;
      }
    }

    // 2. Se non c'è testo vettoriale e OCR è abilitato, renderizza il crop e avvia Tesseract
    if (useOcrFallback) {
      return await this.extractTextViaOCR(page, viewport, region);
    }

    return `Tavola Pag. ${pageNumber}`;
  }

  /**
   * Renderizza la sola porzione della regione su Canvas ed esegue l'OCR
   */
  private static async extractTextViaOCR(
    page: any,
    viewport: any,
    region: AutoMarkRegion
  ): Promise<string> {
    try {
      const renderScale = 2.0; // Scala aumentata per accuratezza OCR
      const pageVp = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      const cropW = Math.max(4, Math.floor(region.widthPct * pageVp.width));
      const cropH = Math.max(4, Math.floor(region.heightPct * pageVp.height));
      const cropX = Math.floor(region.xPct * pageVp.width);
      const cropY = Math.floor(region.yPct * pageVp.height);

      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      // Renderizza pagina su canvas temporaneo
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = pageVp.width;
      fullCanvas.height = pageVp.height;
      const fullCtx = fullCanvas.getContext('2d');
      if (!fullCtx) return '';

      await page.render({
        canvasContext: fullCtx,
        viewport: pageVp,
      }).promise;

      // Ritaglia la regione
      ctx.drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      // Esegui OCR con Tesseract.js
      const { data } = await Tesseract.recognize(canvas, 'eng+ita', {
        logger: () => {},
      });

      const cleanText = (data?.text || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[^\w\s\-\.\/]/gi, '')
        .trim();

      return cleanText || `Pagina ${page.pageNumber}`;
    } catch (err) {
      console.warn('OCR fallito o non disponibile, fallback:', err);
      return `Pagina ${page.pageNumber}`;
    }
  }

  /**
   * Valuta l'espressione con token [Area1], [Area2] ecc. e testo libero arbitrario
   * esattamente come mostrato nello screenshot di Bluebeam Revu AutoMark:
   * es. "[Area1] testo aggiunto - [Area2]" -> "15802.PIP.MEC.STD testo aggiunto - MANUAL GEAR-OPERATORS FOR VALVES"
   */
  public static async extractFromExpression(
    pageNumber: number,
    expression: string,
    areasMap: Record<string, AutoMarkRegion>,
    useOcrFallback: boolean = true,
    docId?: string
  ): Promise<string> {
    const doc = this.getActiveDoc(docId);
    if (!doc) throw new Error('Nessun documento PDF aperto.');

    // Trova tutti i token [Area1], [Area2], etc.
    const tokenRegex = /\[(Area\d+)\]/g;
    const tokensFound = Array.from(new Set(Array.from(expression.matchAll(tokenRegex), (m) => m[1])));

    const extractedMap: Record<string, string> = {};
    for (const token of tokensFound) {
      const region = areasMap[token];
      if (region) {
        const text = await this.extractTextFromRegion(pageNumber, region, useOcrFallback, docId);
        extractedMap[token] = text;
      } else {
        extractedMap[token] = `[${token}]`;
      }
    }

    // Sostituisci i token con i valori estratti
    const result = expression.replace(/\[(Area\d+)\]/g, (_, name) => {
      return extractedMap[name] || `[${name}]`;
    });

    return result.replace(/\s+/g, ' ').trim();
  }

  /**
   * Genera i segnalibri per l'intervallo di pagine specificato usando l'espressione AutoMark
   */
  public static async generateBookmarksFromExpression(
    startPage: number,
    endPage: number,
    expression: string,
    areasMap: Record<string, AutoMarkRegion>,
    onProgress?: (current: number, total: number, title: string) => void,
    docId?: string
  ): Promise<ExtractedBookmark[]> {
    const results: ExtractedBookmark[] = [];
    const total = endPage - startPage + 1;

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      let title = await this.extractFromExpression(pageNum, expression, areasMap, true, docId);
      if (!title || title.trim().length === 0) {
        title = `Tavola Pag. ${pageNum}`;
      }
      results.push({
        id: crypto.randomUUID(),
        pageNumber: pageNum,
        title: title.trim(),
      });

      if (onProgress) {
        onProgress(pageNum - startPage + 1, total, title);
      }
    }

    return results;
  }

  /**
   * Estrae e concatena il testo da una serie di elementi (regioni selezionate e testi fissi)
   * esattamente come fa Bluebeam Revu nella finestra AutoMark.
   */
  public static async extractCompositeLabel(
    pageNumber: number,
    elements: AutoMarkElement[],
    useOcrFallback: boolean = true,
    docId?: string
  ): Promise<string> {
    const doc = this.getActiveDoc(docId);
    if (!doc) throw new Error('Nessun documento aperto.');

    const parts: string[] = [];
    for (const elem of elements) {
      if (elem.type === 'text') {
        parts.push(elem.value);
      } else if (elem.type === 'region') {
        const text = await this.extractTextFromRegion(pageNumber, elem.region, useOcrFallback, docId);
        parts.push(text);
      }
    }
    return parts.join('').replace(/\s+/g, ' ').trim();
  }

  /**
   * Genera i segnalibri per tutte le pagine usando una singola regione o un template di concatenazione
   */
  public static async generateBookmarksAcrossAllPages(
    target: AutoMarkRegion | AutoMarkElement[],
    onProgress?: (current: number, total: number, title: string) => void,
    docId?: string
  ): Promise<ExtractedBookmark[]> {
    const doc = this.getActiveDoc(docId);
    if (!doc) throw new Error('Nessun documento aperto.');

    const totalPages = doc.numPages;
    const results: ExtractedBookmark[] = [];

    const isComposite = Array.isArray(target);

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      let title = '';
      if (isComposite) {
        title = await this.extractCompositeLabel(pageNum, target as AutoMarkElement[], true, docId);
      } else {
        title = await this.extractTextFromRegion(pageNum, target as AutoMarkRegion, true, docId);
      }

      if (!title || title.trim().length === 0) {
        title = `Tavola Pag. ${pageNum}`;
      }
      results.push({
        id: crypto.randomUUID(),
        pageNumber: pageNum,
        title: title.trim(),
      });

      if (onProgress) {
        onProgress(pageNum, totalPages, title);
      }
    }

    return results;
  }
}
