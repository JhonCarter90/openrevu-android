import * as pdfjsLib from 'pdfjs-dist';
import { PDFManager } from '@/core/pdf/pdfManager';
import { AnyMarkup } from '@/types/markup';
import { OpenDocumentItem } from '@/store/useAppStore';

export interface SearchResultItem {
  id: string;
  docId: string;
  fileName: string;
  pageIndex: number;
  pageLabel?: string;
  source: 'page_text' | 'ocr' | 'markup';
  matchText: string;
  snippet: string;
  rect: { x: number; y: number; width: number; height: number };
  markupId?: string;
}

export interface SearchOptions {
  query: string;
  scope: 'current' | 'all_open';
  searchPages: boolean;
  searchMarkups: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  useOcrOnScanned: boolean;
}

export interface SearchProgress {
  currentDocName: string;
  processedPages: number;
  totalPages: number;
  ocrRunning?: boolean;
  ocrError?: string;
  matchesFound: number;
}

interface OcrWordEntry {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface OcrLineEntry {
  text: string;
  words: Array<{ text: string; start: number; end: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
}

// Cache in memoria delle righe/parole OCR per pagina (evita di rieseguire Tesseract ad ogni ricerca)
const ocrPageCache = new Map<string, { scale: number; lines: OcrLineEntry[]; fullText: string }>();

function extractOcrLinesFromResult(ocrRes: any): OcrLineEntry[] {
  const lines: OcrLineEntry[] = [];
  const data = ocrRes?.data;
  if (!data) return lines;

  if (Array.isArray(data.blocks)) {
    for (const block of data.blocks) {
      for (const para of block?.paragraphs || []) {
        for (const line of para?.lines || []) {
          const lineWords: OcrWordEntry[] = (line?.words || []).filter(
            (w: any) => w?.text && w?.bbox
          );
          if (lineWords.length === 0) continue;

          let lineText = '';
          const mappedWords: OcrLineEntry['words'] = [];
          for (const w of lineWords) {
            const clean = String(w.text).replace(/\s+/g, ' ').trim();
            if (!clean) continue;
            if (lineText.length > 0) lineText += ' ';
            const start = lineText.length;
            lineText += clean;
            const end = lineText.length;
            mappedWords.push({ text: clean, start, end, bbox: w.bbox });
          }

          if (lineText) {
            lines.push({ text: lineText, words: mappedWords });
          }
        }
      }
    }
  }

  // Fallback se qualche versione restituisce solo data.words piatto
  if (lines.length === 0 && Array.isArray(data.words)) {
    for (const w of data.words) {
      if (w?.text && w?.bbox) {
        const clean = String(w.text).trim();
        if (clean) {
          lines.push({
            text: clean,
            words: [{ text: clean, start: 0, end: clean.length, bbox: w.bbox }],
          });
        }
      }
    }
  }

  return lines;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchRegex(query: string, caseSensitive: boolean, wholeWord: boolean): RegExp {
  const escaped = escapeRegExp(query);
  const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
  return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
}

function buildSnippet(fullText: string, index: number, length: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(fullText.length, index + length + 28);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < fullText.length ? '…' : '';
  return `${prefix}${fullText.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function getMarkupBoundingRect(m: AnyMarkup): { x: number; y: number; width: number; height: number } {
  const anyM = m as any;
  if (anyM.boxRect) {
    return {
      x: anyM.boxRect.x,
      y: anyM.boxRect.y,
      width: Math.max(12, anyM.boxRect.width),
      height: Math.max(12, anyM.boxRect.height),
    };
  }
  if (anyM.startPoint && anyM.endPoint) {
    const x1 = Math.min(anyM.startPoint.x, anyM.endPoint.x);
    const y1 = Math.min(anyM.startPoint.y, anyM.endPoint.y);
    return {
      x: x1,
      y: y1,
      width: Math.max(16, Math.abs(anyM.endPoint.x - anyM.startPoint.x)),
      height: Math.max(16, Math.abs(anyM.endPoint.y - anyM.startPoint.y)),
    };
  }
  if (Array.isArray(anyM.points) && anyM.points.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of anyM.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      x: minX,
      y: minY,
      width: Math.max(16, maxX - minX),
      height: Math.max(16, maxY - minY),
    };
  }
  return { x: 40, y: 40, width: 60, height: 24 };
}

/**
 * Esegue la ricerca testuale asincrona su uno o più documenti PDF aperti,
 * con supporto opzionale a OCR (Tesseract.js) solo sulle pagine scansionate prive di testo nativo.
 */
export async function searchDocuments(
  docs: OpenDocumentItem[],
  options: SearchOptions,
  onProgress?: (progress: SearchProgress) => void,
  signal?: AbortSignal
): Promise<SearchResultItem[]> {
  const trimmed = options.query.trim();
  if (!trimmed || docs.length === 0) return [];

  const regex = buildSearchRegex(trimmed, options.caseSensitive, options.wholeWord);
  const results: SearchResultItem[] = [];
  const totalPages = docs.reduce((acc, d) => acc + Math.max(1, d.numPages || d.pagesInfo.length), 0);
  let processedPages = 0;

  let ocrWorker: any = null;
  const pdfManager = PDFManager.getInstance();

  try {
    for (const docItem of docs) {
      if (signal?.aborted) break;

      // 1. Ricerca nelle marcature del documento
      if (options.searchMarkups && docItem.markups.length > 0) {
        for (const m of docItem.markups) {
          if (signal?.aborted) break;
          const textBlob = [
            (m as any).text || '',
            m.contents || '',
            m.subject || '',
          ]
            .filter(Boolean)
            .join(' · ');
          if (!textBlob) continue;

          regex.lastIndex = 0;
          const match = regex.exec(textBlob);
          if (match) {
            const pIdx = m.pageIndex ?? 0;
            results.push({
              id: `mk_${docItem.id}_${m.id}_${results.length}`,
              docId: docItem.id,
              fileName: docItem.fileName,
              pageIndex: pIdx,
              pageLabel: docItem.pagesInfo[pIdx]?.label,
              source: 'markup',
              matchText: match[0],
              snippet: buildSnippet(textBlob, match.index, match[0].length),
              rect: getMarkupBoundingRect(m),
              markupId: m.id,
            });
          }
        }
      }

      // 2. Ricerca nel testo nativo delle pagine (+ OCR opzionale solo se pagina scansionata)
      if (!options.searchPages) {
        processedPages += Math.max(1, docItem.numPages);
        onProgress?.({
          currentDocName: docItem.fileName,
          processedPages,
          totalPages,
          matchesFound: results.length,
        });
        continue;
      }

      const pdfDoc = await pdfManager.ensureDocumentLoaded(docItem.id, docItem.fileBytes);
      const numPages = pdfDoc.numPages;

      for (let pNum = 1; pNum <= numPages; pNum++) {
        if (signal?.aborted) break;
        const pageIndex = pNum - 1;
        const pageLabel = docItem.pagesInfo[pageIndex]?.label;

        const page = await pdfDoc.getPage(pNum);
        const viewport = page.getViewport({ scale: 1.0 });
        const textContent = await page.getTextContent();
        const rawItems = (textContent.items as any[]) || [];

        let nativeCharsCount = 0;
        let pageNativeMatches = 0;

        // Raggruppa gli item nativi per riga così anche testo spezzato in più frammenti (es. "A" + "04") viene trovato
        interface PositionedItem {
          str: string;
          x: number;
          y: number;
          w: number;
          h: number;
        }
        const positionedItems: PositionedItem[] = [];

        for (const item of rawItems) {
          const str: string = item.str || '';
          if (!str) continue;
          nativeCharsCount += str.trim().length;

          const vtx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const fontSize = Math.max(6, Math.hypot(vtx[0], vtx[1]));
          const totalW = item.width > 0 ? item.width : Math.max(fontSize * 0.6, str.length * fontSize * 0.55);
          const totalH = item.height > 0 ? item.height : fontSize * 1.15;

          positionedItems.push({
            str,
            x: vtx[4],
            y: vtx[5],
            w: totalW,
            h: totalH,
          });
        }

        // Ricostruzione righe per tolleranza verticale (y)
        const lines: PositionedItem[][] = [];
        const sortedItems = [...positionedItems].sort((a, b) => a.y - b.y || a.x - b.x);
        for (const it of sortedItems) {
          const lastLine = lines[lines.length - 1];
          if (lastLine && Math.abs(lastLine[0].y - it.y) <= Math.max(4, it.h * 0.5)) {
            lastLine.push(it);
          } else {
            lines.push([it]);
          }
        }

        for (const line of lines) {
          if (signal?.aborted) break;
          line.sort((a, b) => a.x - b.x);

          let lineText = '';
          const spans: Array<{ start: number; end: number; item: PositionedItem }> = [];
          let prevEndX = -Infinity;

          for (const it of line) {
            if (spans.length > 0) {
              const gap = it.x - prevEndX;
              const spaceThreshold = Math.max(1.5, it.h * 0.22);
              if (gap > spaceThreshold && !lineText.endsWith(' ') && !it.str.startsWith(' ')) {
                lineText += ' ';
              }
            }
            const start = lineText.length;
            lineText += it.str;
            const end = lineText.length;
            spans.push({ start, end, item: it });
            prevEndX = it.x + it.w;
          }

          regex.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(lineText)) !== null) {
            if (signal?.aborted) break;
            const matchStart = m.index;
            const matchEnd = matchStart + m[0].length;

            // Calcola bounding rect combinando gli span coinvolti dal match
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const sp of spans) {
              if (sp.end <= matchStart || sp.start >= matchEnd) continue;
              const spLen = Math.max(1, sp.end - sp.start);
              const localStart = Math.max(0, matchStart - sp.start) / spLen;
              const localEnd = Math.min(spLen, matchEnd - sp.start) / spLen;
              const sx = sp.item.x + sp.item.w * localStart;
              const sw = Math.max(6, sp.item.w * Math.max(0.15, localEnd - localStart));
              const sy = Math.max(0, sp.item.y - sp.item.h);
              const sh = Math.max(10, sp.item.h * 1.15);
              minX = Math.min(minX, sx);
              minY = Math.min(minY, sy);
              maxX = Math.max(maxX, sx + sw);
              maxY = Math.max(maxY, sy + sh);
            }

            if (!Number.isFinite(minX)) {
              const fallback = spans[0]?.item;
              minX = fallback ? fallback.x : 20;
              minY = fallback ? Math.max(0, fallback.y - fallback.h) : 20;
              maxX = minX + (fallback ? fallback.w : 40);
              maxY = minY + (fallback ? fallback.h : 14);
            }

            pageNativeMatches++;
            results.push({
              id: `txt_${docItem.id}_${pageIndex}_${results.length}`,
              docId: docItem.id,
              fileName: docItem.fileName,
              pageIndex,
              pageLabel,
              source: 'page_text',
              matchText: m[0],
              snippet: buildSnippet(lineText, matchStart, m[0].length),
              rect: {
                x: minX,
                y: minY,
                width: Math.max(10, maxX - minX),
                height: Math.max(10, maxY - minY),
              },
            });

            if (m[0].length === 0) break;
          }
        }

        // Esegue OCR se l'opzione è attiva e la pagina è scansionata OPPURE non ha restituito match dal testo nativo (es. pagine miste/CAD)
        if (options.useOcrOnScanned && (nativeCharsCount < 10 || pageNativeMatches === 0) && !signal?.aborted) {
          onProgress?.({
            currentDocName: docItem.fileName,
            processedPages,
            totalPages,
            ocrRunning: true,
            matchesFound: results.length,
          });

          try {
            const cacheKey = `${docItem.id}:${pageIndex}`;
            let cached = ocrPageCache.get(cacheKey);

            if (!cached) {
              if (!ocrWorker) {
                const { createWorker } = await import('tesseract.js');
                ocrWorker = await createWorker('eng');
              }

              const maxDim = Math.max(viewport.width, viewport.height, 1);
              const ocrScale = Math.min(3.0, Math.max(1.8, 3600 / maxDim), 4096 / maxDim);
              const ocrViewport = page.getViewport({ scale: ocrScale });
              const offCanvas = document.createElement('canvas');
              offCanvas.width = Math.max(1, Math.floor(ocrViewport.width));
              offCanvas.height = Math.max(1, Math.floor(ocrViewport.height));
              const octx = offCanvas.getContext('2d', { alpha: false });
              if (octx) {
                octx.fillStyle = '#ffffff';
                octx.fillRect(0, 0, offCanvas.width, offCanvas.height);
                await page.render({ canvasContext: octx, viewport: ocrViewport, annotationMode: 0 } as any).promise;

                const ocrRes = await ocrWorker.recognize(offCanvas, {}, { blocks: true, text: true });
                const lines = extractOcrLinesFromResult(ocrRes);
                cached = {
                  scale: ocrScale,
                  lines,
                  fullText: (ocrRes?.data?.text || '').replace(/\s+/g, ' ').trim(),
                };
                ocrPageCache.set(cacheKey, cached);
              }
            }

            if (cached) {
              let ocrLineMatches = 0;
              for (const line of cached.lines) {
                if (signal?.aborted) break;
                regex.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = regex.exec(line.text)) !== null) {
                  if (signal?.aborted) break;
                  const matchStart = m.index;
                  const matchEnd = matchStart + m[0].length;

                  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                  for (const w of line.words) {
                    if (w.end <= matchStart || w.start >= matchEnd) continue;
                    minX = Math.min(minX, w.bbox.x0 / cached.scale);
                    minY = Math.min(minY, w.bbox.y0 / cached.scale);
                    maxX = Math.max(maxX, w.bbox.x1 / cached.scale);
                    maxY = Math.max(maxY, w.bbox.y1 / cached.scale);
                  }

                  if (!Number.isFinite(minX)) {
                    const fallback = line.words[0]?.bbox;
                    minX = fallback ? fallback.x0 / cached.scale : 40;
                    minY = fallback ? fallback.y0 / cached.scale : 40;
                    maxX = fallback ? fallback.x1 / cached.scale : 160;
                    maxY = fallback ? fallback.y1 / cached.scale : 64;
                  }

                  ocrLineMatches++;
                  results.push({
                    id: `ocr_${docItem.id}_${pageIndex}_${results.length}`,
                    docId: docItem.id,
                    fileName: docItem.fileName,
                    pageIndex,
                    pageLabel,
                    source: 'ocr',
                    matchText: m[0],
                    snippet: `[OCR] ${buildSnippet(line.text, matchStart, m[0].length)}`,
                    rect: {
                      x: minX,
                      y: minY,
                      width: Math.max(10, maxX - minX),
                      height: Math.max(10, maxY - minY),
                    },
                  });

                  if (m[0].length === 0) break;
                }
              }

              // Fallback su testo intero OCR nel caso il match sia a cavallo tra più righe
              if (ocrLineMatches === 0 && cached.fullText) {
                regex.lastIndex = 0;
                let fm: RegExpExecArray | null;
                while ((fm = regex.exec(cached.fullText)) !== null) {
                  if (signal?.aborted) break;
                  results.push({
                    id: `ocr_${docItem.id}_${pageIndex}_${results.length}`,
                    docId: docItem.id,
                    fileName: docItem.fileName,
                    pageIndex,
                    pageLabel,
                    source: 'ocr',
                    matchText: fm[0],
                    snippet: `[OCR] ${buildSnippet(cached.fullText, fm.index, fm[0].length)}`,
                    rect: { x: 40, y: 40, width: 120, height: 32 },
                  });
                  if (fm[0].length === 0) break;
                }
              }
            }
          } catch (ocrErr) {
            const msg = ocrErr instanceof Error ? ocrErr.message : String(ocrErr);
            console.warn(`OCR pagina ${pNum} non riuscito:`, ocrErr);
            onProgress?.({
              currentDocName: docItem.fileName,
              processedPages,
              totalPages,
              ocrRunning: false,
              ocrError: msg,
              matchesFound: results.length,
            });
          }
        }

        processedPages++;
        onProgress?.({
          currentDocName: docItem.fileName,
          processedPages,
          totalPages,
          ocrRunning: false,
          matchesFound: results.length,
        });

        // Cede il controllo all'event loop ogni 5 pagine per mantenere l'UI fluida anche su 150+ pagine
        if (pNum % 5 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
  } finally {
    if (ocrWorker) {
      try {
        await ocrWorker.terminate();
      } catch {}
    }
  }

  return results;
}
