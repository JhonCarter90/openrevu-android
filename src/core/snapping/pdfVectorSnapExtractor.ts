import * as pdfjsLib from 'pdfjs-dist';
import { SnapTarget } from './snapManager';
import { PDFManager } from '@/core/pdf/pdfManager';

/**
 * Estrae punti di aggancio CAD reali (vertici e punti medi) direttamente dai tracciati vettoriali
 * del PDF tramite page.getOperatorList() di PDF.js.
 * Mantiene una cache per (docId, pageIndex, rotation) per prestazioni a 60 FPS.
 */
export class PdfVectorSnapExtractor {
  private static cache = new Map<string, SnapTarget[]>();
  private static pending = new Map<string, Promise<SnapTarget[]>>();
  private static readonly MAX_TARGETS_PER_PAGE = 3500;

  public static clearDocCache(docId: string) {
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(`${docId}_`)) this.cache.delete(key);
    }
  }

  public static getCachedTargets(
    docId: string,
    pageIndex: number,
    viewportRotation: number = 0
  ): SnapTarget[] | null {
    const key = `${docId}_${pageIndex}_${viewportRotation}`;
    return this.cache.get(key) || null;
  }

  public static async extractPageTargets(
    docId: string,
    pageIndex: number,
    viewportRotation: number = 0
  ): Promise<SnapTarget[]> {
    const key = `${docId}_${pageIndex}_${viewportRotation}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const inflight = this.pending.get(key);
    if (inflight) return inflight;

    const job = (async (): Promise<SnapTarget[]> => {
      try {
        const doc = PDFManager.getInstance().getDocument(docId);
        if (!doc) return [];
        const page = await doc.getPage(pageIndex + 1);
        const viewport = page.getViewport({
          scale: 1.0,
          rotation: PDFManager.getEffectiveRotation(page.rotate, viewportRotation),
        });
        const opList = await page.getOperatorList();
        const OPS = pdfjsLib.OPS;

        const targets: SnapTarget[] = [];
        const seen = new Set<string>();
        const addTarget = (x: number, y: number, type: 'endpoint' | 'midpoint', label: string) => {
          if (targets.length >= this.MAX_TARGETS_PER_PAGE) return;
          if (!isFinite(x) || !isFinite(y)) return;
          if (x < -10 || y < -10 || x > viewport.width + 10 || y > viewport.height + 10) return;
          // Quantizzazione a 0.5 pt per deduplicare vertici sovrapposti tipici dei CAD
          const k = `${type[0]}_${Math.round(x * 2)}_${Math.round(y * 2)}`;
          if (seen.has(k)) return;
          seen.add(k);
          targets.push({ point: { x, y }, type, label });
        };

        // Stack CTM (Current Transformation Matrix)
        let ctm: number[] = [...viewport.transform];
        const stack: number[][] = [];

        const applyPt = (m: number[], px: number, py: number): [number, number] => [
          m[0] * px + m[2] * py + m[4],
          m[1] * px + m[3] * py + m[5],
        ];

        const addSegment = (x1: number, y1: number, x2: number, y2: number) => {
          const [vx1, vy1] = applyPt(ctm, x1, y1);
          const [vx2, vy2] = applyPt(ctm, x2, y2);
          const dist = Math.hypot(vx2 - vx1, vy2 - vy1);
          if (dist < 1.5) return;
          addTarget(vx1, vy1, 'endpoint', 'Vertice PDF');
          addTarget(vx2, vy2, 'endpoint', 'Vertice PDF');
          if (dist >= 8) {
            addTarget((vx1 + vx2) / 2, (vy1 + vy2) / 2, 'midpoint', 'Punto Medio PDF');
          }
        };

        const fnArr = opList.fnArray;
        const argsArr = opList.argsArray;

        for (let i = 0; i < fnArr.length; i++) {
          if (targets.length >= this.MAX_TARGETS_PER_PAGE) break;
          const fn = fnArr[i];
          const args = argsArr[i];

          if (fn === OPS.save) {
            stack.push([...ctm]);
          } else if (fn === OPS.restore) {
            const prev = stack.pop();
            if (prev) ctm = prev;
          } else if (fn === OPS.transform && args && args.length >= 6) {
            ctm = pdfjsLib.Util.transform(ctm, args);
          } else if (fn === OPS.constructPath && args && args.length >= 2) {
            const subOps: number[] = args[0] || [];
            const coords: number[] = args[1] || [];
            let ci = 0;
            let curX = 0;
            let curY = 0;
            let startX = 0;
            let startY = 0;

            for (let s = 0; s < subOps.length; s++) {
              if (targets.length >= this.MAX_TARGETS_PER_PAGE) break;
              const sub = subOps[s];
              if (sub === OPS.moveTo) {
                curX = coords[ci++];
                curY = coords[ci++];
                startX = curX;
                startY = curY;
              } else if (sub === OPS.lineTo) {
                const nx = coords[ci++];
                const ny = coords[ci++];
                addSegment(curX, curY, nx, ny);
                curX = nx;
                curY = ny;
              } else if (sub === OPS.curveTo) {
                const x3 = coords[ci + 4];
                const y3 = coords[ci + 5];
                ci += 6;
                const [vx, vy] = applyPt(ctm, x3, y3);
                addTarget(vx, vy, 'endpoint', 'Vertice PDF');
                curX = x3;
                curY = y3;
              } else if (sub === OPS.curveTo2 || sub === OPS.curveTo3) {
                const x2 = coords[ci + 2];
                const y2 = coords[ci + 3];
                ci += 4;
                const [vx, vy] = applyPt(ctm, x2, y2);
                addTarget(vx, vy, 'endpoint', 'Vertice PDF');
                curX = x2;
                curY = y2;
              } else if (sub === OPS.closePath) {
                if (curX !== startX || curY !== startY) {
                  addSegment(curX, curY, startX, startY);
                }
                curX = startX;
                curY = startY;
              } else if (sub === OPS.rectangle) {
                const rx = coords[ci++];
                const ry = coords[ci++];
                const rw = coords[ci++];
                const rh = coords[ci++];
                addSegment(rx, ry, rx + rw, ry);
                addSegment(rx + rw, ry, rx + rw, ry + rh);
                addSegment(rx + rw, ry + rh, rx, ry + rh);
                addSegment(rx, ry + rh, rx, ry);
                curX = rx;
                curY = ry;
              }
            }
          }
        }

        this.cache.set(key, targets);
        return targets;
      } catch (err) {
        console.warn('Errore estrazione snap vettoriale PDF:', err);
        return [];
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, job);
    return job;
  }
}
