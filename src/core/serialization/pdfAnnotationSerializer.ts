import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFHexString,
  PDFNumber,
  PDFRef,
  PDFRawStream,
  decodePDFRawStream,
  StandardFonts,
} from 'pdf-lib';
import type * as pdfjsLib from 'pdfjs-dist';
import {
  AnyMarkup,
  CloudMarkup,
  CloudPlusMarkup,
  CalloutMarkup,
  TextMarkup,
  RectangleMarkup,
  EllipseMarkup,
  LineMarkup,
  PolylineMarkup,
  PolygonMarkup,
  PenMarkup,
  MeasureLengthMarkup,
  MeasurePolylineMarkup,
  MeasureAreaMarkup,
  MeasureCountMarkup,
  StampMarkup,
  Point2D,
} from '@/types/markup';
import type { CompoundSubPath } from '../btx/btxParser';
import { CoordinateTransformer, PDFPageTransform } from '../viewport/coordinateTransformer';
import { CloudGenerator } from '../markup/cloudGenerator';
import { ScaleManager } from '../scale/scaleManager';
import { MarkupRenderer } from '../markup/markupRenderer';

export class PDFAnnotationSerializer {
  /**
   * Converte un colore esadecimale (#RRGGBB) in componenti PDF [0..1]
   */
  public static hexToPdfRgb(hex?: string): [number, number, number] {
    if (!hex || hex === 'transparent') return [1, 0, 0];
    let clean = hex.replace('#', '').trim();
    if (clean.length === 3) {
      clean = clean
        .split('')
        .map((c) => c + c)
        .join('');
    }
    const num = parseInt(clean, 16);
    if (isNaN(num)) return [1, 0, 0];
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;
    return [
      Number(r.toFixed(4)),
      Number(g.toFixed(4)),
      Number(b.toFixed(4)),
    ];
  }

  /**
   * Converte un array RGB [0..255] o [0..1] di PDF.js in stringa HEX (#rrggbb)
   */
  public static pdfColorToHex(color: any, fallback: string = '#ff0000'): string {
    if (!color) return fallback;
    const arr = Array.isArray(color) || ArrayBuffer.isView(color) ? Array.from(color as any) : [color[0], color[1], color[2]];
    if (arr.length < 3 || arr[0] === undefined) return fallback;
    let r = Number(arr[0]);
    let g = Number(arr[1]);
    let b = Number(arr[2]);
    if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
      r = Math.round(r * 255);
      g = Math.round(g * 255);
      b = Math.round(b * 255);
    } else {
      r = Math.round(r);
      g = Math.round(g);
      b = Math.round(b);
    }
    const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  /**
   * Converte una data PDF (D:YYYYMMDDHHmmSS...) in ISO string
   */
  public static parsePDFDate(pdfDate?: string): string {
    if (!pdfDate || typeof pdfDate !== 'string') return new Date().toISOString();
    const match = pdfDate.match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
    if (!match) return new Date().toISOString();
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2] || '01', 10) - 1;
    const day = parseInt(match[3] || '01', 10);
    const hour = parseInt(match[4] || '00', 10);
    const min = parseInt(match[5] || '00', 10);
    const sec = parseInt(match[6] || '00', 10);
    const d = new Date(year, month, day, hour, min, sec);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  /**
   * Formatta una data nel formato standard PDF: D:YYYYMMDDHHmmSS+01'00'
   */
  public static formatPDFDate(date: Date): string {
    const valid = isNaN(date.getTime()) ? new Date() : date;
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = valid.getFullYear();
    const m = pad(valid.getMonth() + 1);
    const d = pad(valid.getDate());
    const h = pad(valid.getHours());
    const min = pad(valid.getMinutes());
    const s = pad(valid.getSeconds());
    return `D:${y}${m}${d}${h}${min}${s}+01'00'`;
  }

  /**
   * Estrae l'immagine raster (/Icon o /Subtype /Image) dall'Appearance Stream (/AP /N) di un /Stamp PDF
   * applicando la rotazione corretta e rendendo trasparente lo sfondo bianco (per incollaggi #clipboard, tubazioni/valvole e firme)
   */
  private static extractStampImageDataUrl(
    pdfDoc: PDFDocument,
    annotDict: PDFDict,
    pageRotation: number
  ): string | undefined {
    try {
      if (typeof document === 'undefined') return undefined;
      const apObj = annotDict.get(PDFName.of('AP'));
      const apDict = apObj ? pdfDoc.context.lookup(apObj) : null;
      if (!(apDict instanceof PDFDict)) return undefined;

      const nObj = apDict.get(PDFName.of('N'));
      const nStream = nObj ? pdfDoc.context.lookup(nObj) : null;
      if (!nStream || !(nStream as any).dict) return undefined;

      const nDict: PDFDict = (nStream as any).dict;
      const resObj = nDict.get(PDFName.of('Resources'));
      const resDict = resObj ? pdfDoc.context.lookup(resObj) : null;
      if (!(resDict instanceof PDFDict)) return undefined;

      const xobjRef = resDict.get(PDFName.of('XObject'));
      const xobjDict = xobjRef ? pdfDoc.context.lookup(xobjRef) : null;
      if (!(xobjDict instanceof PDFDict)) return undefined;

      let imgStream: PDFRawStream | null = null;
      for (const [, val] of xobjDict.entries()) {
        const candidate = pdfDoc.context.lookup(val);
        if (
          candidate &&
          (candidate as any).dict &&
          (candidate as any).dict.get(PDFName.of('Subtype'))?.toString() === '/Image'
        ) {
          imgStream = candidate as PDFRawStream;
          break;
        }
      }
      if (!imgStream) return undefined;

      const imgDict = imgStream.dict;
      const w = (imgDict.get(PDFName.of('Width')) as PDFNumber)?.asNumber?.() || 0;
      const h = (imgDict.get(PDFName.of('Height')) as PDFNumber)?.asNumber?.() || 0;
      if (w <= 0 || h <= 0) return undefined;

      const csStr = imgDict.get(PDFName.of('ColorSpace'))?.toString() || '/DeviceRGB';
      const pixels = decodePDFRawStream(imgStream).decode();

      // Eventuale SMask (canale alpha separato)
      let smaskBytes: Uint8Array | null = null;
      const smaskRef = imgDict.get(PDFName.of('SMask'));
      if (smaskRef) {
        const smaskStream = pdfDoc.context.lookup(smaskRef);
        if (smaskStream instanceof PDFRawStream) {
          try {
            smaskBytes = decodePDFRawStream(smaskStream).decode();
          } catch {}
        }
      }

      const annotRotate =
        (annotDict.get(PDFName.of('Rotate')) as PDFNumber)?.asNumber?.() || 0;
      const netRotation = (((annotRotate - pageRotation) % 360) + 360) % 360;

      const swapDims = netRotation === 90 || netRotation === 270;
      const outW = swapDims ? h : w;
      const outH = swapDims ? w : h;

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;

      const imgData = ctx.createImageData(outW, outH);
      const dst = imgData.data;
      const isGray = csStr.includes('Gray');
      const isCMYK = csStr.includes('CMYK');
      const channels = isGray ? 1 : isCMYK ? 4 : 3;

      for (let iy = 0; iy < h; iy++) {
        for (let ix = 0; ix < w; ix++) {
          const srcIdx = (iy * w + ix) * channels;
          let r = 255;
          let g = 255;
          let b = 255;
          if (isGray) {
            r = g = b = pixels[srcIdx] ?? 255;
          } else if (isCMYK) {
            const c = (pixels[srcIdx] ?? 0) / 255;
            const m = (pixels[srcIdx + 1] ?? 0) / 255;
            const y = (pixels[srcIdx + 2] ?? 0) / 255;
            const k = (pixels[srcIdx + 3] ?? 0) / 255;
            r = Math.round(255 * (1 - c) * (1 - k));
            g = Math.round(255 * (1 - m) * (1 - k));
            b = Math.round(255 * (1 - y) * (1 - k));
          } else {
            r = pixels[srcIdx] ?? 255;
            g = pixels[srcIdx + 1] ?? 255;
            b = pixels[srcIdx + 2] ?? 255;
          }

          let a = smaskBytes ? (smaskBytes[iy * w + ix] ?? 255) : 255;
          // Rendi trasparenti i pixel bianchi di sfondo degli incollaggi #clipboard / timbri
          if (!smaskBytes && r > 244 && g > 244 && b > 244) {
            a = 0;
          }

          let ox = ix;
          let oy = iy;
          if (netRotation === 90) {
            ox = iy;
            oy = w - 1 - ix;
          } else if (netRotation === 180) {
            ox = w - 1 - ix;
            oy = h - 1 - iy;
          } else if (netRotation === 270) {
            ox = h - 1 - iy;
            oy = ix;
          }

          const dstIdx = (oy * outW + ox) * 4;
          dst[dstIdx] = r;
          dst[dstIdx + 1] = g;
          dst[dstIdx + 2] = b;
          dst[dstIdx + 3] = a;
        }
      }

      ctx.putImageData(imgData, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (err) {
      console.warn('Errore estrazione immagine Stamp:', err);
      return undefined;
    }
  }

  /**
   * Estrae i tracciati vettoriali e i testi dall'Appearance Stream (/AP /N) di un /Stamp PDF
   * trasformandoli in CompoundSubPath posizionati nel rettangolo di pagina (rx, ry, rw, rh).
   */
  private static extractStampVectorCompoundPaths(
    pdfDoc: PDFDocument,
    annotDict: PDFDict,
    rx: number,
    ry: number,
    rw: number,
    rh: number
  ): CompoundSubPath[] {
    try {
      const apObj = annotDict.get(PDFName.of('AP'));
      const apDict = apObj ? pdfDoc.context.lookup(apObj) : null;
      if (!(apDict instanceof PDFDict)) return [];

      const nObj = apDict.get(PDFName.of('N'));
      const nStream = nObj ? pdfDoc.context.lookup(nObj) : null;
      if (!(nStream instanceof PDFRawStream)) return [];

      const nDict = nStream.dict;
      const bboxArr = nDict.get(PDFName.of('BBox'));
      let bx1 = 0,
        by1 = 0,
        bx2 = rw,
        by2 = rh;
      if (bboxArr instanceof PDFArray && bboxArr.size() >= 4) {
        const nums = bboxArr.asArray().map((x) => (x as PDFNumber).asNumber?.() ?? 0);
        bx1 = Math.min(nums[0], nums[2]);
        by1 = Math.min(nums[1], nums[3]);
        bx2 = Math.max(nums[0], nums[2]);
        by2 = Math.max(nums[1], nums[3]);
      }
      const bw = Math.max(1e-3, bx2 - bx1);
      const bh = Math.max(1e-3, by2 - by1);

      const out: CompoundSubPath[] = [];

      const mapPt = (px: number, py: number): Point2D => ({
        x: rx + ((px - bx1) / bw) * rw,
        y: ry + (1 - (py - by1) / bh) * rh,
      });

      const mulMat = (m1: number[], m2: number[]): number[] => [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
      ];

      const applyMat = (m: number[], x: number, y: number): Point2D => ({
        x: m[0] * x + m[2] * y + m[4],
        y: m[1] * x + m[3] * y + m[5],
      });

      const toHex = (r: number, g: number, b: number) =>
        '#' +
        [r, g, b]
          .map((v) =>
            Math.max(0, Math.min(255, Math.round(v * 255)))
              .toString(16)
              .padStart(2, '0')
          )
          .join('');

      const parseFormStream = (stream: PDFRawStream, baseMatrix: number[], depth: number) => {
        if (depth > 4) return;
        const dict = stream.dict;
        let mat = [...baseMatrix];
        if (depth > 0) {
          const mArr = dict.get(PDFName.of('Matrix'));
          if (mArr instanceof PDFArray && mArr.size() >= 6) {
            const mn = mArr.asArray().map((x) => (x as PDFNumber).asNumber?.() ?? 0);
            mat = mulMat(mat, mn);
          }
        }

        const bytes = decodePDFRawStream(stream).decode();
        let src = '';
        for (let i = 0; i < bytes.length; i++) src += String.fromCharCode(bytes[i]);

        // Risolve eventuali XObject figli per /Do
        const xobjMap = new Map<string, PDFRawStream>();
        const resObj = dict.get(PDFName.of('Resources'));
        const resDict = resObj ? pdfDoc.context.lookup(resObj) : null;
        if (resDict instanceof PDFDict) {
          const xRef = resDict.get(PDFName.of('XObject'));
          const xDict = xRef ? pdfDoc.context.lookup(xRef) : null;
          if (xDict instanceof PDFDict) {
            for (const [k, v] of xDict.entries()) {
              const target = pdfDoc.context.lookup(v);
              if (target instanceof PDFRawStream) {
                xobjMap.set(k.toString(), target);
              }
            }
          }
        }

        // Tokenizzatore leggero per content stream PDF
        const tokens: string[] = [];
        let idx = 0;
        const len = src.length;
        while (idx < len) {
          const ch = src[idx];
          if (/\s/.test(ch)) {
            idx++;
            continue;
          }
          if (ch === '%') {
            while (idx < len && src[idx] !== '\n' && src[idx] !== '\r') idx++;
            continue;
          }
          if (ch === '(') {
            let depthP = 1;
            let s = '(';
            idx++;
            while (idx < len && depthP > 0) {
              const c = src[idx];
              if (c === '\\' && idx + 1 < len) {
                s += c + src[idx + 1];
                idx += 2;
                continue;
              }
              if (c === '(') depthP++;
              else if (c === ')') depthP--;
              s += c;
              idx++;
            }
            tokens.push(s);
            continue;
          }
          if (ch === '[' || ch === ']') {
            tokens.push(ch);
            idx++;
            continue;
          }
          let tok = '';
          while (idx < len && !/[\s\[\]\(\)<>\/%]/.test(src[idx])) {
            tok += src[idx++];
          }
          if (!tok && src[idx] === '/') {
            tok = '/';
            idx++;
            while (idx < len && !/[\s\[\]\(\)<>\/%]/.test(src[idx])) {
              tok += src[idx++];
            }
          } else if (!tok) {
            idx++;
          }
          if (tok) tokens.push(tok);
        }

        interface GState {
          ctm: number[];
          stroke: string;
          fill: string;
          width: number;
          fontSize: number;
        }
        const stack: GState[] = [];
        let state: GState = {
          ctm: mat,
          stroke: '#000000',
          fill: '#000000',
          width: 1,
          fontSize: 10,
        };
        const numStack: number[] = [];
        const strStack: string[] = [];
        let curPath: { pts: Point2D[]; closed: boolean }[] = [];
        let activePts: Point2D[] = [];
        let curPt: Point2D = { x: 0, y: 0 };
        let inText = false;
        let textMat = [1, 0, 0, 1, 0, 0];

        const flushPath = (doStroke: boolean, doFill: boolean, forceClose = false) => {
          if (activePts.length > 0) {
            curPath.push({ pts: activePts, closed: forceClose });
            activePts = [];
          }
          const ctmScale =
            Math.sqrt(Math.abs(state.ctm[0] * state.ctm[3] - state.ctm[1] * state.ctm[2])) || 1;
          const effStrokeW = doStroke
            ? Math.max(0.05, state.width * ctmScale * (rw / bw))
            : 0;
          for (const seg of curPath) {
            if (seg.pts.length < 2) continue;
            const mapped = seg.pts.map((p) => {
              const tp = applyMat(state.ctm, p.x, p.y);
              return mapPt(tp.x, tp.y);
            });
            out.push({
              type: seg.closed || forceClose || doFill ? 'polygon' : 'polyline',
              points: mapped,
              closed: seg.closed || forceClose,
              strokeColor: doStroke ? state.stroke : 'transparent',
              fillColor: doFill ? state.fill : undefined,
              strokeWidth: effStrokeW,
            });
          }
          curPath = [];
        };

        for (let t = 0; t < tokens.length; t++) {
          const tk = tokens[t];
          if (tk === '[' || tk === ']') continue;
          if (tk.startsWith('(') && tk.endsWith(')')) {
            strStack.push(tk.slice(1, -1).replace(/\\([()\\])/g, '$1'));
            continue;
          }
          if (tk.startsWith('/')) {
            strStack.push(tk);
            continue;
          }
          const num = Number(tk);
          if (!isNaN(num) && tk !== '') {
            numStack.push(num);
            continue;
          }

          switch (tk) {
            case 'q':
              stack.push({ ...state, ctm: [...state.ctm] });
              break;
            case 'Q':
              if (stack.length > 0) state = stack.pop()!;
              break;
            case 'cm': {
              const vals = numStack.splice(-6);
              if (vals.length === 6) state.ctm = mulMat(state.ctm, vals);
              break;
            }
            case 'w': {
              const wVal = numStack.pop();
              if (wVal !== undefined) state.width = Math.max(0.4, wVal);
              break;
            }
            case 'RG': {
              const [r, g, b] = numStack.splice(-3);
              if (b !== undefined) state.stroke = toHex(r, g, b);
              break;
            }
            case 'rg': {
              const [r, g, b] = numStack.splice(-3);
              if (b !== undefined) state.fill = toHex(r, g, b);
              break;
            }
            case 'G': {
              const g = numStack.pop();
              if (g !== undefined) state.stroke = toHex(g, g, g);
              break;
            }
            case 'g': {
              const g = numStack.pop();
              if (g !== undefined) state.fill = toHex(g, g, g);
              break;
            }
            case 'K': {
              const [c, m, y, k] = numStack.splice(-4);
              if (k !== undefined) state.stroke = toHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
              break;
            }
            case 'k': {
              const [c, m, y, k] = numStack.splice(-4);
              if (k !== undefined) state.fill = toHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
              break;
            }
            case 'SC':
            case 'SCN': {
              if (numStack.length >= 4) {
                const [c, m, y, k] = numStack.splice(-4);
                state.stroke = toHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
              } else if (numStack.length >= 3) {
                const [r, g, b] = numStack.splice(-3);
                state.stroke = toHex(r, g, b);
              } else if (numStack.length >= 1) {
                const g = numStack.pop()!;
                state.stroke = toHex(g, g, g);
              }
              strStack.length = 0;
              break;
            }
            case 'sc':
            case 'scn': {
              if (numStack.length >= 4) {
                const [c, m, y, k] = numStack.splice(-4);
                state.fill = toHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
              } else if (numStack.length >= 3) {
                const [r, g, b] = numStack.splice(-3);
                state.fill = toHex(r, g, b);
              } else if (numStack.length >= 1) {
                const g = numStack.pop()!;
                state.fill = toHex(g, g, g);
              }
              strStack.length = 0;
              break;
            }
            case 'm': {
              const [x, y] = numStack.splice(-2);
              if (y !== undefined) {
                if (activePts.length > 0) curPath.push({ pts: activePts, closed: false });
                curPt = { x, y };
                activePts = [curPt];
              }
              break;
            }
            case 'l': {
              const [x, y] = numStack.splice(-2);
              if (y !== undefined) {
                curPt = { x, y };
                activePts.push(curPt);
              }
              break;
            }
            case 'c': {
              const [x1, y1, x2, y2, x3, y3] = numStack.splice(-6);
              if (y3 !== undefined) {
                const p0 = curPt;
                for (let step = 1; step <= 10; step++) {
                  const u = step / 10;
                  const iu = 1 - u;
                  activePts.push({
                    x: iu * iu * iu * p0.x + 3 * iu * iu * u * x1 + 3 * iu * u * u * x2 + u * u * u * x3,
                    y: iu * iu * iu * p0.y + 3 * iu * iu * u * y1 + 3 * iu * u * u * y2 + u * u * u * y3,
                  });
                }
                curPt = { x: x3, y: y3 };
              }
              break;
            }
            case 'v': {
              const [x2, y2, x3, y3] = numStack.splice(-4);
              if (y3 !== undefined) {
                const p0 = curPt;
                const x1 = p0.x;
                const y1 = p0.y;
                for (let step = 1; step <= 10; step++) {
                  const u = step / 10;
                  const iu = 1 - u;
                  activePts.push({
                    x: iu * iu * iu * p0.x + 3 * iu * iu * u * x1 + 3 * iu * u * u * x2 + u * u * u * x3,
                    y: iu * iu * iu * p0.y + 3 * iu * iu * u * y1 + 3 * iu * u * u * y2 + u * u * u * y3,
                  });
                }
                curPt = { x: x3, y: y3 };
              }
              break;
            }
            case 'y': {
              const [x1, y1, x3, y3] = numStack.splice(-4);
              if (y3 !== undefined) {
                const p0 = curPt;
                const x2 = x3;
                const y2 = y3;
                for (let step = 1; step <= 10; step++) {
                  const u = step / 10;
                  const iu = 1 - u;
                  activePts.push({
                    x: iu * iu * iu * p0.x + 3 * iu * iu * u * x1 + 3 * iu * u * u * x2 + u * u * u * x3,
                    y: iu * iu * iu * p0.y + 3 * iu * iu * u * y1 + 3 * iu * u * u * y2 + u * u * u * y3,
                  });
                }
                curPt = { x: x3, y: y3 };
              }
              break;
            }
            case 're': {
              const [x, y, w, h] = numStack.splice(-4);
              if (h !== undefined) {
                if (activePts.length > 0) curPath.push({ pts: activePts, closed: false });
                curPath.push({
                  pts: [
                    { x, y },
                    { x: x + w, y },
                    { x: x + w, y: y + h },
                    { x, y: y + h },
                  ],
                  closed: true,
                });
                activePts = [];
              }
              break;
            }
            case 'h':
              if (activePts.length > 0) {
                curPath.push({ pts: activePts, closed: true });
                activePts = [];
              }
              break;
            case 'S':
              flushPath(true, false, false);
              break;
            case 's':
              flushPath(true, false, true);
              break;
            case 'f':
            case 'F':
            case 'f*':
              flushPath(false, true, true);
              break;
            case 'B':
            case 'B*':
              flushPath(true, true, false);
              break;
            case 'b':
            case 'b*':
              flushPath(true, true, true);
              break;
            case 'n':
              curPath = [];
              activePts = [];
              break;
            case 'BT':
              inText = true;
              textMat = [1, 0, 0, 1, 0, 0];
              break;
            case 'ET':
              inText = false;
              break;
            case 'Tf': {
              const fs = numStack.pop();
              strStack.pop();
              if (fs !== undefined) state.fontSize = Math.abs(fs) || 10;
              break;
            }
            case 'Tm': {
              const vals = numStack.splice(-6);
              if (vals.length === 6) textMat = vals;
              break;
            }
            case 'Td':
            case 'TD': {
              const [tx, ty] = numStack.splice(-2);
              if (ty !== undefined) {
                textMat = mulMat(textMat, [1, 0, 0, 1, tx, ty]);
              }
              break;
            }
            case 'Tj':
            case 'TJ': {
              const txt = strStack.splice(0).filter((s) => !s.startsWith('/')).join('');
              if (inText && txt.trim()) {
                const fullMat = mulMat(state.ctm, textMat);
                const pt = applyMat(fullMat, 0, 0);
                const mp = mapPt(pt.x, pt.y);
                const effSize = Math.max(4, state.fontSize * Math.abs(fullMat[3] || 1) * (rh / bh));
                const estW = Math.max(effSize * txt.length * 0.65, 10);
                const estH = effSize * 1.25;
                out.push({
                  type: 'text',
                  text: txt.trim(),
                  fontSize: effSize,
                  strokeColor: state.fill || state.stroke,
                  strokeWidth: 1,
                  rect: { x: mp.x, y: mp.y - estH * 0.8, width: estW, height: estH },
                });
              }
              break;
            }
            case 'Do': {
              const name = strStack.pop();
              if (name && xobjMap.has(name)) {
                const child = xobjMap.get(name)!;
                if (child.dict.get(PDFName.of('Subtype'))?.toString() === '/Form') {
                  parseFormStream(child, state.ctm, depth + 1);
                }
              }
              break;
            }
            default:
              numStack.length = 0;
              strStack.length = 0;
              break;
          }
        }
      };

      parseFormStream(nStream, [1, 0, 0, 1, 0, 0], 0);
      return out;
    } catch (err) {
      console.warn('Errore estrazione vettoriale Stamp:', err);
      return [];
    }
  }

  /**
   * Estrae tutti i commenti/annotazioni preesistenti da un documento PDF.js + pdf-lib
   * rendendoli selezionabili, modificabili ed eliminabili in OpenRevu
   */
  public static async extractMarkupsFromDocument(
    doc: pdfjsLib.PDFDocumentProxy,
    pages: pdfjsLib.PDFPageProxy[],
    docId: string = 'primary',
    rawBytes?: Uint8Array | ArrayBuffer
  ): Promise<AnyMarkup[]> {
    const targetDocId = (docId === 'secondary' ? 'secondary' : 'primary') as 'primary' | 'secondary';

    let pdfDoc: PDFDocument | null = null;
    if (rawBytes) {
      try {
        pdfDoc = await PDFDocument.load(rawBytes, { ignoreEncryption: true });
      } catch (e) {
        console.warn('Fallback a solo PDF.js per estrazione annotazioni:', e);
      }
    }

    const perPageResults = await Promise.all(
      pages.map(async (page, pageIndex) => {
        try {
          const viewport = page.getViewport({ scale: 1.0 });
          const annots = await page.getAnnotations();
          const pageMarkups: AnyMarkup[] = [];

          for (const a of annots) {
            if (!a || !a.subtype) continue;
            if (a.subtype === 'Popup' || a.subtype === 'Link' || a.subtype === 'Widget') continue;

            // Recupera il dizionario grezzo PDF (/Annot) da pdf-lib tramite l'ID oggetto (es. "3189R" -> 3189 0 R)
            let rawDict: PDFDict | null = null;
            if (pdfDoc && typeof a.id === 'string') {
              const objNum = parseInt(a.id, 10);
              if (!isNaN(objNum) && objNum > 0) {
                const lookedUp = pdfDoc.context.lookup(PDFRef.of(objNum, 0));
                if (lookedUp instanceof PDFDict) {
                  rawDict = lookedUp;
                }
              }
            }

            const dictSubjObj = rawDict?.get(PDFName.of('Subj')) as PDFString | undefined;
            const dictSubj = dictSubjObj?.decodeText ? dictSubjObj.decodeText().trim() : '';

            const rawTitle = (a.titleObj?.str ?? a.title ?? '').trim();
            // Ignora i riquadri invisibili di testo SHX generati da AutoCAD
            if (rawTitle === 'AutoCAD SHX Text') continue;

            const author = rawTitle || 'Revisore';
            const rawSubj = (a.subjectObj?.str ?? a.subject ?? dictSubj ?? '').trim();

            let rawContents = (a.contentsObj?.str ?? a.contents ?? a.richText?.str ?? '').trim();
            if (!rawContents && rawDict) {
              const dictContentsObj = rawDict.get(PDFName.of('Contents')) as PDFString | undefined;
              if (dictContentsObj?.decodeText) {
                rawContents = dictContentsObj.decodeText().trim();
              }
            }
            if (!rawContents) {
              let rcStr = typeof a.richText?.html === 'string' ? a.richText.html : '';
              if (!rcStr && rawDict) {
                const rcObj = rawDict.get(PDFName.of('RC')) as PDFString | undefined;
                if (rcObj?.decodeText) rcStr = rcObj.decodeText();
              }
              if (rcStr) {
                rawContents = rcStr
                  .replace(/<br\s*\/?>/gi, '\n')
                  .replace(/<\/p>/gi, '\n')
                  .replace(/<[^>]+>/g, '')
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&nbsp;/g, ' ')
                  .trim();
              }
            }
            if (
              a.subtype !== 'FreeText' &&
              a.subtype !== 'Text' &&
              rawContents &&
              rawSubj &&
              rawContents === rawSubj
            ) {
              rawContents = '';
            }
            const creationDate = this.parsePDFDate(a.creationDate || a.modificationDate);
            const modificationDate = this.parsePDFDate(a.modificationDate || a.creationDate);
            const opacity = typeof a.opacity === 'number' ? Math.max(0.1, Math.min(1, a.opacity)) : 1;

            if (!a.rect || a.rect.length < 4) continue;
            const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle(a.rect);
            const rx = Math.min(vx1, vx2);
            const ry = Math.min(vy1, vy2);
            const rw = Math.max(4, Math.abs(vx2 - vx1));
            const rh = Math.max(4, Math.abs(vy2 - vy1));

            const colorHex = a.color ? this.pdfColorToHex(a.color, '') : '';
            let interiorHex = a.interiorColor
              ? this.pdfColorToHex(a.interiorColor, '')
              : a.backgroundColor
              ? this.pdfColorToHex(a.backgroundColor, '')
              : '';
            if (!interiorHex && rawDict) {
              const icArr = rawDict.get(PDFName.of('IC'));
              if (icArr instanceof PDFArray && icArr.size() >= 3) {
                const icNums = icArr.asArray().map((n) => (n as PDFNumber).asNumber?.() ?? 0);
                interiorHex = this.pdfColorToHex(icNums, '');
              }
            }

            const fontColorHex = a.defaultAppearanceData?.fontColor
              ? this.pdfColorToHex(a.defaultAppearanceData.fontColor, '')
              : '';

            let bsDict: PDFDict | null = null;
            if (rawDict && pdfDoc) {
              const bsObj = rawDict.get(PDFName.of('BS'));
              const lookedBs = bsObj ? pdfDoc.context.lookup(bsObj) : null;
              if (lookedBs instanceof PDFDict) {
                bsDict = lookedBs;
              }
            }
            const rawBsWObj = bsDict ? pdfDoc?.context.lookup(bsDict.get(PDFName.of('W'))) : null;
            const rawBsW = rawBsWObj instanceof PDFNumber ? rawBsWObj.asNumber() : undefined;
            const borderWidth =
              typeof rawBsW === 'number' && !isNaN(rawBsW)
                ? Math.max(0, rawBsW)
                : typeof a.borderStyle?.width === 'number' && !isNaN(a.borderStyle.width)
                ? Math.max(0, a.borderStyle.width)
                : typeof a.borderStyle?.rawWidth === 'number' && !isNaN(a.borderStyle.rawWidth)
                ? Math.max(0, a.borderStyle.rawWidth)
                : 1;

            // Rileva eventuale linea tratteggiata da borderStyle o dizionario /BS
            let isDashed = a.borderStyle?.style === 2;
            if (!isDashed && bsDict) {
              const sVal = bsDict.get(PDFName.of('S'))?.toString();
              if (sVal === '/D' || bsDict.get(PDFName.of('D'))) {
                isDashed = true;
              }
            }
            const lineStyle = isDashed ? 'dashed' : 'solid';

            // Calcola eventuale /RD (Rect Difference) per Circle / Square di Bluebeam
            let innerRx = rx;
            let innerRy = ry;
            let innerRw = rw;
            let innerRh = rh;
            if (rawDict) {
              const rdPdfArr = rawDict.get(PDFName.of('RD'));
              if (rdPdfArr instanceof PDFArray && rdPdfArr.size() >= 4) {
                const rd = rdPdfArr.asArray().map((n) => (n as PDFNumber).asNumber?.() ?? 0);
                const innerPdfRect = [
                  a.rect[0] + rd[0],
                  a.rect[1] + rd[1],
                  a.rect[2] - rd[2],
                  a.rect[3] - rd[3],
                ];
                const [ibx1, iby1, ibx2, iby2] = viewport.convertToViewportRectangle(innerPdfRect);
                innerRx = Math.min(ibx1, ibx2);
                innerRy = Math.min(iby1, iby2);
                innerRw = Math.max(1, Math.abs(ibx2 - ibx1));
                innerRh = Math.max(1, Math.abs(iby2 - iby1));
              }
            }

            // Estrai metadati di raggruppamento PDF (/NM, /IRT, /RT /Group, /GroupNesting)
            let annotNM = '';
            let groupRootKey = '';
            let groupSubject = '';
            if (rawDict) {
              const nmObj = rawDict.get(PDFName.of('NM')) as PDFString | undefined;
              annotNM = nmObj?.decodeText ? nmObj.decodeText().trim() : nmObj?.toString()?.replace(/^[(/]|[)]$/g, '') || '';
              if (!annotNM && typeof a.id === 'string') annotNM = a.id;

              const irtRef = rawDict.get(PDFName.of('IRT'));
              if (irtRef instanceof PDFRef) {
                groupRootKey = `obj_${irtRef.objectNumber}`;
              } else if (irtRef instanceof PDFString) {
                groupRootKey = `nm_${irtRef.decodeText()}`;
              }

              const gnArr =
                (rawDict.get(PDFName.of('GroupNesting')) as PDFArray | undefined) ||
                (rawDict.get(PDFName.of('TempGroupNesting')) as PDFArray | undefined);
              if (gnArr instanceof PDFArray && gnArr.size() >= 2) {
                const firstEl = gnArr.get(0);
                if (firstEl instanceof PDFString) {
                  groupSubject = firstEl.decodeText().trim();
                }
                const firstIdEl = gnArr.get(1);
                const firstIdStr =
                  firstIdEl instanceof PDFString
                    ? firstIdEl.decodeText().trim()
                    : firstIdEl?.toString()?.replace(/^[(/]|[)]$/g, '') || '';
                if (firstIdStr) {
                  groupRootKey = `gn_${firstIdStr}`;
                }
              }
            }
            const selfObjKey =
              typeof a.id === 'string' && !isNaN(parseInt(a.id, 10))
                ? `obj_${parseInt(a.id, 10)}`
                : '';

            const attachGroupMeta = <T extends AnyMarkup>(mk: T): T => {
              (mk as any)._annotNM = annotNM;
              (mk as any)._selfObjKey = selfObjKey;
              (mk as any)._groupRootKey = groupRootKey;
              (mk as any)._groupSubject = groupSubject;
              return mk;
            };

            // Rileva effetto bordo nuvoletta (/BE << /S /C >>)
            let hasCloudBorderEffect = false;
            if (rawDict && pdfDoc) {
              const beObj = rawDict.get(PDFName.of('BE'));
              const beDict = beObj ? pdfDoc.context.lookup(beObj) : null;
              if (beDict instanceof PDFDict && beDict.get(PDFName.of('S'))?.toString() === '/C') {
                hasCloudBorderEffect = true;
              }
            }

            const id = a.id ? `pdf_annot_${pageIndex}_${a.id}` : crypto.randomUUID();

            // 1. EVIDENZIATORE / HIGHLIGHT / UNDERLINE / STRIKEOUT
            if (
              a.subtype === 'Highlight' ||
              a.subtype === 'Underline' ||
              a.subtype === 'StrikeOut' ||
              a.subtype === 'Squiggly'
            ) {
              const hlColor = colorHex || '#40aa55';
              const m: RectangleMarkup = {
                id,
                docId: targetDocId,
                type: 'rectangle',
                pageIndex,
                author,
                subject: rawSubj || 'Evidenziatore',
                contents: rawContents,
                creationDate,
                modificationDate,
                status: 'None',
                strokeColor: hlColor,
                fillColor: hlColor,
                strokeWidth: 0,
                opacity,
                fillOpacity: 0.42,
                boxRect: { x: rx, y: ry, width: rw, height: rh },
              };
              pageMarkups.push(m);
              continue;
            }

            // 2. NOTA / STICKY NOTE (/Subtype /Text)
            if (a.subtype === 'Text') {
              const noteColor = colorHex || '#ffc100';
              const noteSize = 20;
              const m: RectangleMarkup = {
                id,
                docId: targetDocId,
                type: 'rectangle',
                pageIndex,
                author,
                subject: rawSubj || 'Nota / Commento',
                contents: rawContents,
                creationDate,
                modificationDate,
                status: 'None',
                strokeColor: '#996600',
                fillColor: noteColor,
                strokeWidth: 1.5,
                opacity: 1,
                fillOpacity: 0.95,
                boxRect: {
                  x: rx,
                  y: ry,
                  width: Math.max(18, Math.min(28, rw || noteSize)),
                  height: Math.max(18, Math.min(28, rh || noteSize)),
                },
              };
              pageMarkups.push(m);
              continue;
            }

            // 3. POLIGONO / NUVOLETTA DI REVISIONE / POLILINEA
            if (a.subtype === 'Polygon' || a.subtype === 'PolyLine') {
              const pts: Point2D[] = [];
              if (a.vertices) {
                const vArr = Array.isArray(a.vertices) || ArrayBuffer.isView(a.vertices)
                  ? Array.from(a.vertices as any)
                  : Object.values(a.vertices);
                for (let i = 0; i + 1 < vArr.length; i += 2) {
                  const px = Number(vArr[i]);
                  const py = Number(vArr[i + 1]);
                  if (!isNaN(px) && !isNaN(py)) {
                    const [vx, vy] = viewport.convertToViewportPoint(px, py);
                    pts.push({ x: vx, y: vy });
                  }
                }
              } else if (rawDict) {
                const vPdfArr = rawDict.get(PDFName.of('Vertices'));
                if (vPdfArr instanceof PDFArray) {
                  const rawNums = vPdfArr.asArray().map((n) => (n as PDFNumber).asNumber?.() ?? NaN);
                  for (let i = 0; i + 1 < rawNums.length; i += 2) {
                    if (!isNaN(rawNums[i]) && !isNaN(rawNums[i + 1])) {
                      const [vx, vy] = viewport.convertToViewportPoint(rawNums[i], rawNums[i + 1]);
                      pts.push({ x: vx, y: vy });
                    }
                  }
                }
              }
              if (pts.length > 3) {
                const first = pts[0];
                const last = pts[pts.length - 1];
                if (Math.hypot(first.x - last.x, first.y - last.y) < 1.5) {
                  pts.pop();
                }
              }
              if (pts.length < 2 && pdfDoc && rawDict) {
                const apPaths = this.extractStampVectorCompoundPaths(
                  pdfDoc,
                  rawDict,
                  rx,
                  ry,
                  rw,
                  rh
                );
                if (apPaths.length > 0) {
                  const m: PolylineMarkup = {
                    id,
                    docId: targetDocId,
                    type: 'polyline',
                    pageIndex,
                    author,
                    subject: rawSubj || (a.subtype === 'Polygon' ? 'Poligono' : 'Polilinea'),
                    contents: rawContents,
                    creationDate,
                    modificationDate,
                    status: 'None',
                    strokeColor: colorHex || apPaths[0].strokeColor || '#db3425',
                    fillColor: interiorHex || apPaths[0].fillColor,
                    strokeWidth: apPaths[0].strokeWidth || borderWidth || 1.5,
                    lineStyle,
                    opacity,
                    isSymbol: apPaths.length > 1,
                    boxRect: { x: rx, y: ry, width: rw, height: rh },
                    points: [
                      { x: rx, y: ry },
                      { x: rx + rw, y: ry },
                      { x: rx + rw, y: ry + rh },
                      { x: rx, y: ry + rh },
                    ],
                    compoundPaths: apPaths,
                  };
                  pageMarkups.push(attachGroupMeta(m));
                  continue;
                }
              }
              if (pts.length < 2) {
                pts.push(
                  { x: rx, y: ry },
                  { x: rx + rw, y: ry },
                  { x: rx + rw, y: ry + rh },
                  { x: rx, y: ry + rh }
                );
              }

              const isCloud =
                hasCloudBorderEffect ||
                a.it === 'PolygonCloud' ||
                rawSubj.toLowerCase().includes('cloud') ||
                rawSubj.toLowerCase().includes('nuvol');

              if (isCloud) {
                const m: CloudMarkup = {
                  id,
                  docId: targetDocId,
                  type: 'cloud',
                  pageIndex,
                  author,
                  subject: rawSubj || 'Nuvoletta',
                  contents: rawContents,
                  creationDate,
                  modificationDate,
                  status: 'None',
                  strokeColor: colorHex || '#db3425',
                  fillColor: interiorHex || 'transparent',
                  fillOpacity: interiorHex ? opacity : 0,
                  strokeWidth: borderWidth,
                  opacity,
                  points: pts,
                };
                pageMarkups.push(attachGroupMeta(m));
              } else if (a.subtype === 'PolyLine') {
                const m: PolylineMarkup = {
                  id,
                  docId: targetDocId,
                  type: 'polyline',
                  pageIndex,
                  author,
                  subject: rawSubj || 'Polilinea',
                  contents: rawContents,
                  creationDate,
                  modificationDate,
                  status: 'None',
                  strokeColor: colorHex || '#db3425',
                  strokeWidth: borderWidth,
                  lineStyle,
                  opacity,
                  points: pts,
                };
                pageMarkups.push(attachGroupMeta(m));
              } else {
                const m: PolygonMarkup = {
                  id,
                  docId: targetDocId,
                  type: 'polygon',
                  pageIndex,
                  author,
                  subject: rawSubj || 'Poligono',
                  contents: rawContents,
                  creationDate,
                  modificationDate,
                  status: 'None',
                  strokeColor: colorHex || '#db3425',
                  fillColor: interiorHex || 'transparent',
                  fillOpacity: interiorHex ? opacity : 0,
                  strokeWidth: borderWidth,
                  lineStyle,
                  opacity,
                  points: pts,
                };
                pageMarkups.push(attachGroupMeta(m));
              }
              continue;
            }

            // 4. CASELLA DI TESTO & CALLOUT (/Subtype /FreeText)
            if (a.subtype === 'FreeText') {
              const fontSize = Math.max(7, Math.round(a.defaultAppearanceData?.fontSize || 10));
              const txtColor = fontColorHex || colorHex || '#db3125';

              const clPdfArr = rawDict?.get(PDFName.of('CL'));
              const isCallout =
                a.it === 'FreeTextCallout' ||
                clPdfArr instanceof PDFArray ||
                rawSubj.toLowerCase().includes('callout');

              if (isCallout) {
                let boxRect = {
                  x: rx,
                  y: ry + rh - Math.min(rh, Math.max(36, rh * 0.42)),
                  width: Math.min(rw, Math.max(120, rw * 0.78)),
                  height: Math.min(rh, Math.max(36, rh * 0.42)),
                };

                // Se presente /RD [ left bottom right top ], calcola il vero box di testo interno
                const rdPdfArr = rawDict?.get(PDFName.of('RD'));
                if (rdPdfArr instanceof PDFArray && rdPdfArr.size() >= 4) {
                  const rd = rdPdfArr.asArray().map((n) => (n as PDFNumber).asNumber?.() ?? 0);
                  const innerPdfRect = [
                    a.rect[0] + rd[0],
                    a.rect[1] + rd[1],
                    a.rect[2] - rd[2],
                    a.rect[3] - rd[3],
                  ];
                  const [ibx1, iby1, ibx2, iby2] = viewport.convertToViewportRectangle(innerPdfRect);
                  boxRect = {
                    x: Math.min(ibx1, ibx2),
                    y: Math.min(iby1, iby2),
                    width: Math.max(24, Math.abs(ibx2 - ibx1)),
                    height: Math.max(16, Math.abs(iby2 - iby1)),
                  };
                }

                let arrowPoint: Point2D = { x: rx + rw, y: ry };
                let elbowPoint: Point2D | undefined = undefined;
                if (clPdfArr instanceof PDFArray && clPdfArr.size() >= 4) {
                  const cl = clPdfArr.asArray().map((n) => (n as PDFNumber).asNumber?.() ?? 0);
                  const [ax, ay] = viewport.convertToViewportPoint(cl[0], cl[1]);
                  arrowPoint = { x: ax, y: ay };
                  if (cl.length >= 6) {
                    const [kx, ky] = viewport.convertToViewportPoint(cl[2], cl[3]);
                    elbowPoint = { x: kx, y: ky };
                  }
                }

                const m: CalloutMarkup = {
                  id,
                  docId: targetDocId,
                  type: 'callout',
                  pageIndex,
                  author,
                  subject: rawSubj || 'Callout',
                  contents: rawContents,
                  text: rawContents,
                  creationDate,
                  modificationDate,
                  status: 'None',
                  strokeColor: txtColor,
                  textColor: txtColor,
                  fillColor: colorHex || '#ffffff',
                  fillOpacity: opacity,
                  strokeWidth: borderWidth,
                  opacity,
                  fontSize,
                  fontFamily: 'Helvetica, Arial, sans-serif',
                  arrowPoint,
                  elbowPoint,
                  boxRect,
                };
                pageMarkups.push(attachGroupMeta(m));
              } else {
                const qNum =
                  typeof a.textAlignment === 'number'
                    ? a.textAlignment
                    : (rawDict?.get(PDFName.of('Q')) as PDFNumber | undefined)?.asNumber?.();
                const resolvedAlign: 'left' | 'center' | 'right' =
                  qNum === 1 ? 'center' : qNum === 2 ? 'right' : 'left';
                const m: TextMarkup = {
                  id,
                  docId: targetDocId,
                  type: 'textbox',
                  pageIndex,
                  author,
                  subject: rawSubj || 'Casella di Testo',
                  contents: rawContents,
                  text: rawContents,
                  creationDate,
                  modificationDate,
                  status: 'None',
                  strokeColor: borderWidth > 0 && colorHex ? colorHex : txtColor,
                  textColor: txtColor,
                  fillColor: interiorHex || 'transparent',
                  fillOpacity: interiorHex ? opacity : 0,
                  strokeWidth: borderWidth > 0 && colorHex ? borderWidth : 0,
                  opacity,
                  fontSize,
                  fontFamily: 'Helvetica, Arial, sans-serif',
                  textAlign: resolvedAlign,
                  boxRect: {
                    x: rx,
                    y: ry,
                    width: Math.max(18, rw),
                    height: Math.max(12, rh),
                  },
                };
                pageMarkups.push(attachGroupMeta(m));
              }
              continue;
            }

            // 5. RETTANGOLO O NUVOLETTA RETTANGOLARE (/Subtype /Square)
            if (a.subtype === 'Square') {
              if (hasCloudBorderEffect) {
                const m: CloudMarkup = {
                  id,
                  docId: targetDocId,
                  type: 'cloud',
                  pageIndex,
                  author,
                  subject: rawSubj || 'Nuvoletta',
                  contents: rawContents,
                  creationDate,
                  modificationDate,
                  status: 'None',
                  strokeColor: colorHex || '#db3425',
                  fillColor: interiorHex || 'transparent',
                  fillOpacity: interiorHex ? opacity : 0,
                  strokeWidth: borderWidth,
                  opacity,
                  points: [
                    { x: innerRx, y: innerRy },
                    { x: innerRx + innerRw, y: innerRy },
                    { x: innerRx + innerRw, y: innerRy + innerRh },
                    { x: innerRx, y: innerRy + innerRh },
                  ],
                };
                pageMarkups.push(attachGroupMeta(m));
              } else {
                const m: RectangleMarkup = {
                  id,
                  docId: targetDocId,
                  type: 'rectangle',
                  pageIndex,
                  author,
                  subject: rawSubj || 'Rettangolo',
                  contents: rawContents,
                  creationDate,
                  modificationDate,
                  status: 'None',
                  strokeColor: colorHex || '#ff0000',
                  fillColor: interiorHex || 'transparent',
                  fillOpacity: interiorHex ? opacity : 0,
                  strokeWidth: borderWidth,
                  lineStyle,
                  opacity,
                  boxRect: { x: innerRx, y: innerRy, width: innerRw, height: innerRh },
                };
                pageMarkups.push(attachGroupMeta(m));
              }
              continue;
            }

            // 6. ELLISSE / CERCHIO (/Subtype /Circle)
            if (a.subtype === 'Circle') {
              const m: EllipseMarkup = {
                id,
                docId: targetDocId,
                type: 'ellipse',
                pageIndex,
                author,
                subject: rawSubj || 'Ellisse',
                contents: rawContents,
                creationDate,
                modificationDate,
                status: 'None',
                strokeColor: colorHex || '#ff0000',
                fillColor: interiorHex || 'transparent',
                fillOpacity: interiorHex ? opacity : 0,
                strokeWidth: borderWidth,
                lineStyle,
                opacity,
                boxRect: { x: innerRx, y: innerRy, width: innerRw, height: innerRh },
              };
              pageMarkups.push(attachGroupMeta(m));
              continue;
            }

            // 6b. COLLEGAMENTO IPERTESTUALE (/Subtype /Link)
            if (a.subtype === 'Link') {
              let actionType: 'goto_page' | 'url' | 'open_file' = 'goto_page';
              let targetUrl: string | undefined;
              let targetPage: number | undefined;
              if (a.url) {
                actionType = 'url';
                targetUrl = String(a.url);
              } else if (a.dest) {
                try {
                  const destArr = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : a.dest;
                  if (Array.isArray(destArr) && destArr[0]) {
                    const pIdx = await doc.getPageIndex(destArr[0]);
                    targetPage = pIdx + 1;
                  }
                } catch {}
              }
              if (targetUrl || targetPage) {
                const linkMarkup: any = {
                  id,
                  docId: targetDocId,
                  type: 'hyperlink',
                  pageIndex,
                  author,
                  subject: rawSubj || 'Collegamento ipertestuale',
                  contents: targetUrl || `Vai a Pagina ${targetPage}`,
                  creationDate,
                  modificationDate,
                  status: 'None',
                  strokeColor: colorHex || '#3b82f6',
                  fillColor: '#3b82f6',
                  fillOpacity: 0.12,
                  strokeWidth: 1,
                  opacity: 0.9,
                  boxRect: { x: rx, y: ry, width: rw, height: rh },
                  actionType,
                  targetUrl,
                  targetPage,
                };
                pageMarkups.push(linkMarkup);
              }
              continue;
            }

            // 7. LINEA / FRECCIA / QUOTA (/Subtype /Line)
            if (a.subtype === 'Line') {
              let p1: Point2D = { x: rx, y: ry };
              let p2: Point2D = { x: rx + rw, y: ry + rh };
              // Legge direttamente /L da rawDict perché PDF.js applica Util.normalizeRect() a lineCoordinates,
              // che distrugge l'orientamento reale della linea se non è crescente su entrambi gli assi.
              let rawLineCoords: number[] | null = null;
              if (rawDict && pdfDoc) {
                const lObj = rawDict.get(PDFName.of('L'));
                const lArr = lObj ? pdfDoc.context.lookup(lObj) : null;
                if (lArr instanceof PDFArray && lArr.size() >= 4) {
                  rawLineCoords = [0, 1, 2, 3].map((idx) => {
                    const numObj = pdfDoc.context.lookup(lArr.get(idx));
                    return numObj instanceof PDFNumber ? numObj.asNumber() : 0;
                  });
                }
              }
              const lineCoords =
                rawLineCoords ||
                (a.lineCoordinates && a.lineCoordinates.length >= 4 ? a.lineCoordinates : null);
              if (lineCoords) {
                const [vxA, vyA] = viewport.convertToViewportPoint(
                  lineCoords[0],
                  lineCoords[1]
                );
                const [vxB, vyB] = viewport.convertToViewportPoint(
                  lineCoords[2],
                  lineCoords[3]
                );
                p1 = { x: vxA, y: vyA };
                p2 = { x: vxB, y: vyB };
              }

              // Rileva terminazioni freccia (/LE) per compatibilità con Bluebeam Revu / Acrobat
              let startHead: 'none' | 'arrow' = 'none';
              let endHead: 'none' | 'arrow' = 'none';
              if (rawDict && pdfDoc) {
                const leObj = rawDict.get(PDFName.of('LE'));
                const leArr = leObj ? pdfDoc.context.lookup(leObj) : null;
                if (leArr instanceof PDFArray && leArr.size() >= 2) {
                  const le0 = leArr.get(0)?.toString?.() || '';
                  const le1 = leArr.get(1)?.toString?.() || '';
                  if (le0.includes('Arrow')) startHead = 'arrow';
                  if (le1.includes('Arrow')) endHead = 'arrow';
                }
              }

              const m: LineMarkup = {
                id,
                docId: targetDocId,
                type: endHead === 'arrow' || startHead === 'arrow' ? 'arrow' : 'line',
                pageIndex,
                author,
                subject: rawSubj || (endHead === 'arrow' ? 'Freccia' : 'Linea'),
                contents: rawContents,
                creationDate,
                modificationDate,
                status: 'None',
                strokeColor: colorHex || '#ff0000',
                strokeWidth: borderWidth,
                lineStyle,
                opacity,
                startPoint: p1,
                endPoint: p2,
                startHead,
                endHead,
              };
              pageMarkups.push(attachGroupMeta(m));
              continue;
            }

            // 8. INCHIOSTRO / PENNA A MANO LIBERA (/Subtype /Ink)
            if (a.subtype === 'Ink' && a.inkLists && a.inkLists.length > 0) {
              const pts: Point2D[] = [];
              const firstStroke = a.inkLists[0];
              const sArr = Array.isArray(firstStroke) || ArrayBuffer.isView(firstStroke)
                ? Array.from(firstStroke as any)
                : Object.values(firstStroke);
              for (let i = 0; i + 1 < sArr.length; i += 2) {
                const [vx, vy] = viewport.convertToViewportPoint(Number(sArr[i]), Number(sArr[i + 1]));
                pts.push({ x: vx, y: vy });
              }
              if (pts.length >= 2) {
                const m: PenMarkup = {
                  id,
                  docId: targetDocId,
                  type: 'pen',
                  pageIndex,
                  author,
                  subject: rawSubj || 'Penna',
                  contents: rawContents,
                  creationDate,
                  modificationDate,
                  status: 'None',
                  strokeColor: colorHex || '#ff0000',
                  strokeWidth: borderWidth,
                  opacity,
                  points: pts,
                };
                pageMarkups.push(attachGroupMeta(m));
              }
              continue;
            }

            // 9. TIMBRO / INCOLLAGGIO GRAFICO #CLIPBOARD (/Subtype /Stamp)
            if (a.subtype === 'Stamp') {
              let imageDataUrl: string | undefined = undefined;
              if (pdfDoc && rawDict) {
                imageDataUrl = this.extractStampImageDataUrl(pdfDoc, rawDict, viewport.rotation);
                if (imageDataUrl) {
                  await MarkupRenderer.preloadStampImage(id, imageDataUrl);
                }
              }

              if (!imageDataUrl && pdfDoc && rawDict) {
                const vectorPaths = this.extractStampVectorCompoundPaths(
                  pdfDoc,
                  rawDict,
                  rx,
                  ry,
                  rw,
                  rh
                );
                if (vectorPaths.length > 0) {
                  const vecMarkup: PolylineMarkup = {
                    id,
                    docId: targetDocId,
                    type: 'polyline',
                    pageIndex,
                    author,
                    subject: rawSubj || 'Simbolo',
                    contents: rawContents || '',
                    creationDate,
                    modificationDate,
                    status: 'None',
                    strokeColor: colorHex || vectorPaths[0].strokeColor || '#ef4444',
                    fillColor: vectorPaths[0].fillColor,
                    strokeWidth: vectorPaths[0].strokeWidth || borderWidth || 1.2,
                    opacity,
                    isSymbol: true,
                    isGroup: true,
                    boxRect: { x: rx, y: ry, width: rw, height: rh },
                    points: [
                      { x: rx, y: ry },
                      { x: rx + rw, y: ry },
                      { x: rx + rw, y: ry + rh },
                      { x: rx, y: ry + rh },
                    ],
                    compoundPaths: vectorPaths,
                  };
                  pageMarkups.push(attachGroupMeta(vecMarkup));
                  continue;
                }
              }

              const safeTitle =
                rawSubj && rawSubj.toLowerCase() !== 'timbro'
                  ? rawSubj
                  : rawTitle && rawTitle !== author
                  ? rawTitle
                  : 'TIMBRO';
              const m: StampMarkup = {
                id,
                docId: targetDocId,
                type: 'stamp',
                pageIndex,
                author,
                subject: rawSubj || 'Timbro',
                contents: rawContents || '',
                stampTitle: safeTitle,
                dateStamp: '',
                imageDataUrl,
                creationDate,
                modificationDate,
                status: 'None',
                strokeColor: colorHex || '#db3425',
                strokeWidth: 1.5,
                opacity,
                boxRect: { x: rx, y: ry, width: rw, height: rh },
              };
              pageMarkups.push(attachGroupMeta(m));
              continue;
            }
          }

          // Raggruppa automaticamente le annotazioni collegate da /RT /Group + /IRT o /GroupNesting / /TempGroupNesting
          return this.consolidateGroupedMarkups(pageMarkups, targetDocId, pageIndex);
        } catch (err) {
          console.warn(`Errore estrazione annotazioni pagina ${pageIndex + 1}:`, err);
          return [];
        }
      })
    );

    return perPageResults.flat();
  }

  /**
   * Unisce automaticamente le sub-annotazioni PDF che appartengono allo stesso gruppo/blocco Bluebeam
   * (tramite /IRT + /RT /Group, /GroupNesting o adiacenza geometrica diretta) in un unico simbolo vettoriale.
   */
  private static consolidateGroupedMarkups(
    pageMarkups: AnyMarkup[],
    docId: 'primary' | 'secondary',
    pageIndex: number
  ): AnyMarkup[] {
    if (pageMarkups.length <= 1) return pageMarkups;

    const getMarkupBounds = (m: AnyMarkup): { x1: number; y1: number; x2: number; y2: number } | null => {
      if ('boxRect' in m && m.boxRect) {
        return {
          x1: m.boxRect.x,
          y1: m.boxRect.y,
          x2: m.boxRect.x + m.boxRect.width,
          y2: m.boxRect.y + m.boxRect.height,
        };
      }
      if ('points' in m && m.points && m.points.length > 0) {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const p of m.points) {
          if (p.x < x1) x1 = p.x;
          if (p.y < y1) y1 = p.y;
          if (p.x > x2) x2 = p.x;
          if (p.y > y2) y2 = p.y;
        }
        return { x1, y1, x2, y2 };
      }
      if (m.type === 'line') {
        return {
          x1: Math.min(m.startPoint.x, m.endPoint.x),
          y1: Math.min(m.startPoint.y, m.endPoint.y),
          x2: Math.max(m.startPoint.x, m.endPoint.x),
          y2: Math.max(m.startPoint.y, m.endPoint.y),
        };
      }
      return null;
    };

    const n = pageMarkups.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (i: number, j: number) => {
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[rj] = ri;
    };

    // 1. Unione tramite chiavi esplicite PDF (/IRT, /GroupNesting, /NM)
    const keyToIndex = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const m = pageMarkups[i] as any;
      if (m._selfObjKey) keyToIndex.set(m._selfObjKey, i);
      if (m._annotNM) {
        keyToIndex.set(`nm_${m._annotNM}`, i);
        keyToIndex.set(`gn_${m._annotNM}`, i);
      }
    }
    for (let i = 0; i < n; i++) {
      const m = pageMarkups[i] as any;
      const rk = m._groupRootKey as string | undefined;
      if (rk) {
        if (keyToIndex.has(rk)) {
          union(keyToIndex.get(rk)!, i);
        } else {
          keyToIndex.set(rk, i);
        }
      }
    }

    // 2. Unione geometrica per blocchi CAD esplosi (elementi che si toccano/sovrappongono entro 2.5pt e < 240pt)
    const bounds = pageMarkups.map(getMarkupBounds);
    const isGroupableType = (m: AnyMarkup) =>
      m.type === 'polyline' ||
      m.type === 'polygon' ||
      m.type === 'ellipse' ||
      m.type === 'rectangle' ||
      m.type === 'line' ||
      m.type === 'textbox';

    for (let i = 0; i < n; i++) {
      if (!isGroupableType(pageMarkups[i]) || !bounds[i]) continue;
      const bi = bounds[i]!;
      if (bi.x2 - bi.x1 > 750 || bi.y2 - bi.y1 > 750) continue;

      for (let j = i + 1; j < n; j++) {
        if (!isGroupableType(pageMarkups[j]) || !bounds[j]) continue;
        const bj = bounds[j]!;
        if (bj.x2 - bj.x1 > 750 || bj.y2 - bj.y1 > 750) continue;

        const pad = 2.5;
        const overlaps =
          bi.x1 - pad <= bj.x2 &&
          bi.x2 + pad >= bj.x1 &&
          bi.y1 - pad <= bj.y2 &&
          bi.y2 + pad >= bj.y1;
        if (overlaps) {
          const combW = Math.max(bi.x2, bj.x2) - Math.min(bi.x1, bj.x1);
          const combH = Math.max(bi.y2, bj.y2) - Math.min(bi.y1, bj.y1);
          if (combW <= 800 && combH <= 800) {
            union(i, j);
          }
        }
      }
    }

    const clusters = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!clusters.has(r)) clusters.set(r, []);
      clusters.get(r)!.push(i);
    }

    const result: AnyMarkup[] = [];
    for (const [, indices] of clusters.entries()) {
      if (indices.length === 1) {
        result.push(pageMarkups[indices[0]]);
        continue;
      }

      const members = indices.map((idx) => pageMarkups[idx]);
      const graphicalMembers = members.filter((m) => m.type !== 'textbox');
      const bboxSource = graphicalMembers.length > 0 ? graphicalMembers : members;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const m of bboxSource) {
        const b = getMarkupBounds(m);
        if (!b) continue;
        if (b.x1 < minX) minX = b.x1;
        if (b.y1 < minY) minY = b.y1;
        if (b.x2 > maxX) maxX = b.x2;
        if (b.y2 > maxY) maxY = b.y2;
      }

      if (!isFinite(minX) || !isFinite(minY)) {
        result.push(...members);
        continue;
      }

      const width = Math.max(4, maxX - minX);
      const height = Math.max(4, maxY - minY);
      const compoundPaths: any[] = [];
      let groupName = '';
      let mainStroke = '#ef4444';
      let mainFill: string | undefined = undefined;
      let mainWidth = 1.5;

      const genericSubjects = new Set([
        'Polilinea', 'Poligono', 'Ellisse', 'Rettangolo', 'Casella di Testo',
        'Linea', 'Arco', 'Gruppo', 'Group', 'Polyline', 'Polygon', 'Circle',
        'Square', 'Line', 'Arc', 'FreeText', 'Text Box', 'Typewritten Text',
      ]);

      for (const m of members) {
        const gm = m as any;
        if (!groupName && gm._groupSubject) groupName = gm._groupSubject;
        if (
          !groupName &&
          m.subject &&
          !genericSubjects.has(m.subject.trim())
        ) {
          groupName = m.subject.trim();
        }

        if (m.compoundPaths && m.compoundPaths.length > 0) {
          mainStroke = m.strokeColor || mainStroke;
          mainWidth = m.strokeWidth || mainWidth;
          for (const cp of m.compoundPaths) {
            compoundPaths.push(cp);
          }
        } else if (m.type === 'polyline' || m.type === 'polygon') {
          mainStroke = m.strokeColor || mainStroke;
          mainWidth = m.strokeWidth || mainWidth;
          if (m.type === 'polygon' && m.fillColor && m.fillColor !== 'transparent') {
            mainFill = m.fillColor;
          }
          compoundPaths.push({
            type: m.type === 'polygon' ? 'polygon' : 'polyline',
            points: m.points.map((p) => ({ x: p.x, y: p.y })),
            strokeColor: m.strokeColor,
            fillColor: m.type === 'polygon' && m.fillColor !== 'transparent' ? m.fillColor : undefined,
            strokeWidth: m.strokeWidth,
            ...(m.lineStyle ? { lineStyle: m.lineStyle } : {}),
          } as any);
        } else if (m.type === 'line') {
          mainStroke = m.strokeColor || mainStroke;
          compoundPaths.push({
            type: 'line',
            points: [
              { x: m.startPoint.x, y: m.startPoint.y },
              { x: m.endPoint.x, y: m.endPoint.y },
            ],
            strokeColor: m.strokeColor,
            strokeWidth: m.strokeWidth,
            ...(m.lineStyle ? { lineStyle: m.lineStyle } : {}),
          } as any);
        } else if (m.type === 'ellipse') {
          mainStroke = m.strokeColor || mainStroke;
          if (m.fillColor && m.fillColor !== 'transparent') mainFill = m.fillColor;
          const cx = m.boxRect.x + m.boxRect.width / 2;
          const cy = m.boxRect.y + m.boxRect.height / 2;
          compoundPaths.push({
            type: 'ellipse',
            ellipse: {
              cx,
              cy,
              rx: m.boxRect.width / 2,
              ry: m.boxRect.height / 2,
            },
            strokeColor: m.strokeColor,
            fillColor: m.fillColor !== 'transparent' ? m.fillColor : undefined,
            strokeWidth: m.strokeWidth,
          });
        } else if (m.type === 'rectangle') {
          mainStroke = m.strokeColor || mainStroke;
          if (m.fillColor && m.fillColor !== 'transparent') mainFill = m.fillColor;
          const { x, y, width: rw, height: rh } = m.boxRect;
          compoundPaths.push({
            type: 'rect',
            rect: { x, y, width: rw, height: rh },
            strokeColor: m.strokeColor,
            fillColor: m.fillColor !== 'transparent' ? m.fillColor : undefined,
            strokeWidth: m.strokeWidth,
          });
        } else if (m.type === 'textbox' && m.text) {
          const { x, y, width: tw, height: th } = m.boxRect;
          compoundPaths.push({
            type: 'text',
            rect: { x, y, width: tw, height: th },
            strokeColor: m.textColor || m.strokeColor || mainStroke,
            strokeWidth: 1,
            text: m.text,
            fontSize: Math.max(5, Math.min(24, m.fontSize || 9)),
            textAlign: m.textAlign || 'left',
          });
        }
      }

      const first = members[0];
      const cleanGroupContents =
        first.contents &&
        groupName &&
        first.contents.trim() === groupName.trim()
          ? ''
          : (first.contents || '');
      const groupedMarkup: PolylineMarkup = {
        id: first.id,
        docId,
        type: 'polyline',
        pageIndex,
        author: first.author,
        subject: groupName || 'Simbolo Gruppo CAD',
        contents: cleanGroupContents,
        creationDate: first.creationDate,
        modificationDate: first.modificationDate,
        status: first.status,
        strokeColor: mainStroke,
        fillColor: mainFill,
        strokeWidth: mainWidth,
        opacity: first.opacity,
        isGroup: true,
        isSymbol: true,
        boxRect: { x: minX, y: minY, width, height },
        points: [
          { x: minX, y: minY },
          { x: minX + width, y: minY },
          { x: minX + width, y: minY + height },
          { x: minX, y: minY + height },
        ],
        compoundPaths,
      };
      result.push(groupedMarkup);
    }

    return result;
  }

  /**
   * Inietta tutti i markup nel PDF e genera il buffer compatibile con Bluebeam Revu, Adobe Acrobat e lettori browser.
   * Aggiorna/rimuove anche le annotazioni preesistenti modificate o eliminate dall'utente.
   */
  public static async exportMarkupsToPDF(
    originalPdfBytes: Uint8Array,
    markups: AnyMarkup[],
    bookmarks?: Array<{ title: string; pageNumber: number }>
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    const helvFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const page = pages[pageIdx];
      const crop = page.getCropBox();
      const pageTransform: PDFPageTransform = {
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
        rotation: page.getRotation().angle,
      };
      const pageMarkups = markups.filter((m) => m.pageIndex === pageIdx);

      // Mappa di eventuali /Stamp preesistenti che l'utente non ha eliminato, così da preservarne l'/AP /N originale (es. #clipboard valvole/firme)
      const activeStampByObjNum = new Map<number, StampMarkup>();
      for (const m of pageMarkups) {
        if (m.type === 'stamp' && m.id.startsWith(`pdf_annot_${pageIdx}_`)) {
          const objNum = parseInt(m.id.replace(`pdf_annot_${pageIdx}_`, ''), 10);
          if (!isNaN(objNum) && objNum > 0) {
            activeStampByObjNum.set(objNum, m as StampMarkup);
          }
        }
      }

      const existingAnnots = page.node.Annots();
      const keptRefs: any[] = [];
      const preservedStampIds = new Set<string>();
      if (existingAnnots) {
        for (let i = 0; i < existingAnnots.size(); i++) {
          const ref = existingAnnots.get(i);
          const dict = existingAnnots.lookup(i);
          if (dict instanceof PDFDict) {
            const titleObj = dict.get(PDFName.of('T'));
            const titleStr = titleObj ? titleObj.toString() : '';
            if (titleStr.includes('AutoCAD SHX Text')) {
              keptRefs.push(ref);
              continue;
            }
            if (ref instanceof PDFRef && activeStampByObjNum.has(ref.objectNumber)) {
              const sm = activeStampByObjNum.get(ref.objectNumber)!;
              const bl = CoordinateTransformer.pageToPDFStandard(
                { x: sm.boxRect.x, y: sm.boxRect.y + sm.boxRect.height },
                pageTransform
              );
              const tr = CoordinateTransformer.pageToPDFStandard(
                { x: sm.boxRect.x + sm.boxRect.width, y: sm.boxRect.y },
                pageTransform
              );
              dict.set(
                PDFName.of('Rect'),
                pdfDoc.context.obj([
                  Math.min(bl.x, tr.x),
                  Math.min(bl.y, tr.y),
                  Math.max(bl.x, tr.x),
                  Math.max(bl.y, tr.y),
                ])
              );
              if (sm.contents) dict.set(PDFName.of('Contents'), PDFString.of(sm.contents));
              keptRefs.push(ref);
              preservedStampIds.add(sm.id);
            }
          }
        }
      }

      const newAnnotsArray = pdfDoc.context.obj(keptRefs) as PDFArray;
      page.node.set(PDFName.of('Annots'), newAnnotsArray);

      if (pageMarkups.length === 0) continue;

      for (const markup of pageMarkups) {
        if (preservedStampIds.has(markup.id)) continue;
        try {
          const annotDicts = this.createAnnotationDicts(pdfDoc, page, helvFont, markup, pageTransform);
          for (const annotDict of annotDicts) {
            if (markup.type === 'stamp' && (markup as StampMarkup).imageDataUrl) {
              await this.attachImageStampAppearance(pdfDoc, annotDict, markup as StampMarkup, pageTransform);
            }
            const annotRef = pdfDoc.context.register(annotDict);
            newAnnotsArray.push(annotRef);
          }
        } catch (err) {
          console.warn('Errore serializzazione singolo markup:', markup.id, err);
        }
      }
    }

    if (bookmarks !== undefined) {
      this.writeOutlinesToPDF(pdfDoc, pages, bookmarks);
    }

    return await pdfDoc.save({ useObjectStreams: false });
  }

  /**
   * Scrive l'albero /Outlines nativo nel catalogo PDF secondo lo standard ISO 32000-1
   * in modo che i segnalibri siano visibili in Bluebeam Revu, Adobe Acrobat e browser.
   */
  private static writeOutlinesToPDF(
    pdfDoc: PDFDocument,
    pages: ReturnType<PDFDocument['getPages']>,
    bookmarks: Array<{ title: string; pageNumber: number }>
  ): void {
    const validItems = bookmarks.filter((b) => b.title && b.title.trim().length > 0);
    if (validItems.length === 0 || pages.length === 0) {
      pdfDoc.catalog.delete(PDFName.of('Outlines'));
      return;
    }

    const outlinesDict = pdfDoc.context.obj({
      Type: PDFName.of('Outlines'),
      Count: PDFNumber.of(validItems.length),
    });
    const outlinesRef = pdfDoc.context.register(outlinesDict);

    const itemRefs: PDFRef[] = [];
    const itemDicts: PDFDict[] = [];

    for (const item of validItems) {
      const targetIdx = Math.max(0, Math.min(pages.length - 1, Math.floor(item.pageNumber) - 1));
      const targetPage = pages[targetIdx];
      const itemDict = pdfDoc.context.obj({
        Title: PDFHexString.fromText(item.title.trim()),
        Parent: outlinesRef,
        Dest: pdfDoc.context.obj([targetPage.ref, PDFName.of('Fit')]),
      });
      const itemRef = pdfDoc.context.register(itemDict);
      itemRefs.push(itemRef);
      itemDicts.push(itemDict);
    }

    for (let i = 0; i < itemDicts.length; i++) {
      if (i > 0) {
        itemDicts[i].set(PDFName.of('Prev'), itemRefs[i - 1]);
      }
      if (i < itemDicts.length - 1) {
        itemDicts[i].set(PDFName.of('Next'), itemRefs[i + 1]);
      }
    }

    outlinesDict.set(PDFName.of('First'), itemRefs[0]);
    outlinesDict.set(PDFName.of('Last'), itemRefs[itemRefs.length - 1]);
    pdfDoc.catalog.set(PDFName.of('Outlines'), outlinesRef);
    if (!pdfDoc.catalog.has(PDFName.of('PageMode'))) {
      pdfDoc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
    }
  }

  private static getPdfDashArray(lineStyle?: string, strokeWidth: number = 1.5): number[] | null {
    const sw = Math.max(1, strokeWidth);
    switch (lineStyle) {
      case 'dashed':
        return [Math.round(sw * 4 + 2), Math.round(sw * 2.5 + 1)];
      case 'dotted':
        return [Math.max(1, Math.round(sw)), Math.round(sw * 2 + 1)];
      case 'dash_dot':
        return [Math.round(sw * 5 + 3), Math.round(sw * 2 + 1), Math.max(1, Math.round(sw)), Math.round(sw * 2 + 1)];
      case 'dash_dot_dot':
        return [Math.round(sw * 5 + 3), Math.round(sw * 2 + 1), Math.max(1, Math.round(sw)), Math.round(sw * 2 + 1), Math.max(1, Math.round(sw)), Math.round(sw * 2 + 1)];
      case 'long_dash':
        return [Math.round(sw * 8 + 4), Math.round(sw * 3 + 2)];
      default:
        return null;
    }
  }

  private static getPdfDashOperator(lineStyle?: string, strokeWidth: number = 1.5): string {
    const arr = this.getPdfDashArray(lineStyle, strokeWidth);
    return arr ? `[${arr.join(' ')}] 0 d\n` : '';
  }

  private static fillBaseAnnotationProps(
    pdfDoc: PDFDocument,
    dict: PDFDict,
    m: AnyMarkup,
    suffix: string = ''
  ) {
    dict.set(PDFName.of('Type'), PDFName.of('Annot'));
    dict.set(PDFName.of('NM'), PDFString.of((m.id || crypto.randomUUID()) + suffix));
    dict.set(PDFName.of('T'), PDFString.of(m.author || 'Utente'));
    dict.set(PDFName.of('Subj'), PDFString.of(m.subject || m.type));
    dict.set(PDFName.of('Contents'), PDFString.of(m.contents || (m as any).text || ''));
    dict.set(PDFName.of('CreationDate'), PDFString.of(this.formatPDFDate(new Date(m.creationDate))));
    dict.set(PDFName.of('M'), PDFString.of(this.formatPDFDate(new Date(m.modificationDate))));
    dict.set(PDFName.of('F'), PDFNumber.of(4)); // Print flag standard

    const [r, g, b] = this.hexToPdfRgb(m.strokeColor || '#ff0000');
    dict.set(PDFName.of('C'), pdfDoc.context.obj([r, g, b]));
    const hasFill = Boolean(m.fillColor && m.fillColor !== 'transparent');
    const strokeOp = m.opacity ?? 1;
    const fillOp = typeof (m as any).fillOpacity === 'number' ? (m as any).fillOpacity : strokeOp;
    const effectiveCa = hasFill && strokeOp >= 0.99 ? fillOp : strokeOp;
    dict.set(PDFName.of('CA'), PDFNumber.of(Math.max(0, Math.min(1, effectiveCa))));

    const dashArr = this.getPdfDashArray((m as any).lineStyle, m.strokeWidth ?? 1.5);
    const bsObj: Record<string, any> = {
      Type: PDFName.of('Border'),
      W: PDFNumber.of(Math.max(0, m.strokeWidth ?? 1.5)),
      S: PDFName.of(dashArr ? 'D' : 'S'),
    };
    if (dashArr) {
      bsObj.D = pdfDoc.context.obj(dashArr);
    }
    dict.set(PDFName.of('BS'), pdfDoc.context.obj(bsObj));
  }

  /**
   * Crea un Appearance Stream (/AP /N) per l'annotazione in modo che sia visibile
   * in qualsiasi visualizzatore PDF (Chrome, Edge, Acrobat, Bluebeam) e al tempo stesso
   * rimovibile/modificabile come vera annotazione PDF.
   */
  private static attachAppearanceStream(
    pdfDoc: PDFDocument,
    dict: PDFDict,
    bbox: [number, number, number, number],
    operators: string,
    alpha: number = 1,
    fillAlpha?: number
  ) {
    const minX = Math.min(bbox[0], bbox[2]);
    const minY = Math.min(bbox[1], bbox[3]);
    const maxX = Math.max(bbox[0], bbox[2]);
    const maxY = Math.max(bbox[1], bbox[3]);
    const effectiveFillAlpha = typeof fillAlpha === 'number' ? fillAlpha : alpha;

    const gsDict = pdfDoc.context.obj({
      Type: PDFName.of('ExtGState'),
      CA: PDFNumber.of(alpha),
      ca: PDFNumber.of(alpha),
    });

    const gsFillDict = pdfDoc.context.obj({
      Type: PDFName.of('ExtGState'),
      CA: PDFNumber.of(alpha),
      ca: PDFNumber.of(effectiveFillAlpha),
    });

    const resources = pdfDoc.context.obj({
      ExtGState: pdfDoc.context.obj({ GS1: gsDict, GSF: gsFillDict }),
      Font: pdfDoc.context.obj({
        F1: pdfDoc.context.obj({
          Type: PDFName.of('Font'),
          Subtype: PDFName.of('Type1'),
          BaseFont: PDFName.of('Helvetica'),
          Encoding: PDFName.of('WinAnsiEncoding'),
        }),
      }),
    });

    const fullOps = `q\n/GS1 gs\n${operators}\nQ\n`;
    const stream = pdfDoc.context.flateStream(fullOps, {
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Form'),
      FormType: PDFNumber.of(1),
      BBox: pdfDoc.context.obj([minX, minY, maxX, maxY]),
      Resources: resources,
    });
    const streamRef = pdfDoc.context.register(stream);
    dict.set(PDFName.of('AP'), pdfDoc.context.obj({ N: streamRef }));
  }

  private static escapePdfLiteral(str: string): string {
    return (str || '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
  }

  private static buildPdfHatchOps(
    clipPathOps: string,
    bbox: [number, number, number, number],
    hatchPattern?: string,
    hatchColorHex?: string,
    hatchScale: number = 1
  ): string {
    if (!hatchPattern || hatchPattern === 'none' || hatchPattern === 'solid') return '';
    const minX = Math.min(bbox[0], bbox[2]);
    const minY = Math.min(bbox[1], bbox[3]);
    const maxX = Math.max(bbox[0], bbox[2]);
    const maxY = Math.max(bbox[1], bbox[3]);
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 2 || h < 2) return '';

    const [hr, hg, hb] = this.hexToPdfRgb(hatchColorHex || '#ff0000');
    const step = Math.max(4, 10 * Math.max(0.25, hatchScale || 1));
    const maxLines = 450;
    let lines = '';
    let count = 0;

    const addLine = (x1: number, y1: number, x2: number, y2: number) => {
      if (count++ >= maxLines) return;
      lines += `${x1.toFixed(2)} ${y1.toFixed(2)} m\n${x2.toFixed(2)} ${y2.toFixed(2)} l\n`;
    };

    if (hatchPattern === 'horizontal' || hatchPattern === 'crosshatch' || hatchPattern === 'brick') {
      for (let y = minY; y <= maxY; y += step) {
        addLine(minX, y, maxX, y);
      }
    }
    if (hatchPattern === 'vertical' || hatchPattern === 'crosshatch') {
      for (let x = minX; x <= maxX; x += step) {
        addLine(x, minY, x, maxY);
      }
    }
    if (hatchPattern === 'diagonal_right') {
      for (let offset = -h; offset <= w; offset += step) {
        addLine(minX + offset, minY, minX + offset + h, maxY);
      }
    }
    if (hatchPattern === 'diagonal_left') {
      for (let offset = 0; offset <= w + h; offset += step) {
        addLine(minX + offset, minY, minX + offset - h, maxY);
      }
    }
    if (hatchPattern === 'brick') {
      let row = 0;
      const brickW = step * 2;
      for (let y = minY; y < maxY; y += step) {
        const xOff = (row % 2) * step;
        for (let x = minX + xOff; x <= maxX; x += brickW) {
          addLine(x, y, x, Math.min(maxY, y + step));
        }
        row++;
      }
    }
    if (hatchPattern === 'dots') {
      for (let y = minY + step / 2; y <= maxY; y += step) {
        for (let x = minX + step / 2; x <= maxX; x += step) {
          addLine(x - 0.6, y, x + 0.6, y);
        }
      }
    }
    if (hatchPattern === 'zigzag') {
      const amp = step * 0.45;
      for (let y = minY + amp; y <= maxY; y += step) {
        let up = true;
        for (let x = minX; x < maxX; x += step) {
          const xNext = Math.min(maxX, x + step);
          const y1 = up ? y - amp : y + amp;
          const y2 = up ? y + amp : y - amp;
          addLine(x, y1, xNext, y2);
          up = !up;
        }
      }
    }

    if (!lines) return '';
    return `q\n/GSF gs\n${clipPathOps}W\nn\n${hr} ${hg} ${hb} RG\n0.75 w\n${lines}S\nQ\n`;
  }

  private static buildPdfArrowHeadOps(
    tip: Point2D,
    from: Point2D,
    strokeWidth: number,
    rgb: [number, number, number]
  ): string {
    const dx = tip.x - from.x;
    const dy = tip.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return '';
    const angle = Math.atan2(dy, dx);
    const headLen = Math.max(9, strokeWidth * 3 + 6);
    const spread = 0.38; // ~22 gradi, stile ClosedArrow Bluebeam
    const ax1 = tip.x - headLen * Math.cos(angle - spread);
    const ay1 = tip.y - headLen * Math.sin(angle - spread);
    const ax2 = tip.x - headLen * Math.cos(angle + spread);
    const ay2 = tip.y - headLen * Math.sin(angle + spread);
    return `${rgb[0]} ${rgb[1]} ${rgb[2]} rg\n${tip.x.toFixed(2)} ${tip.y.toFixed(2)} m\n${ax1.toFixed(2)} ${ay1.toFixed(2)} l\n${ax2.toFixed(2)} ${ay2.toFixed(2)} l\nh\nf\n`;
  }

  private static buildCloudPdfPath(points: Point2D[], pageTransform: PDFPageTransform): { ops: string; rect: [number, number, number, number] } {
    const arcs = CloudGenerator.generateCloudArcs(points, 14);
    const pdfPts = points.map((p) => CoordinateTransformer.pageToPDFStandard(p, pageTransform));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pdfPts) {
      minX = Math.min(minX, p.x - 18);
      minY = Math.min(minY, p.y - 18);
      maxX = Math.max(maxX, p.x + 18);
      maxY = Math.max(maxY, p.y + 18);
    }
    if (!isFinite(minX)) {
      minX = 0; minY = 0; maxX = 100; maxY = 100;
    }

    let pathOps = '';
    if (arcs.length > 0) {
      for (let i = 0; i < arcs.length; i++) {
        const arc = arcs[i];
        const steps = 6;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const invT = 1 - t;
          const px = invT * invT * arc.p1.x + 2 * invT * t * arc.controlPoint.x + t * t * arc.p2.x;
          const py = invT * invT * arc.p1.y + 2 * invT * t * arc.controlPoint.y + t * t * arc.p2.y;
          const pdfPt = CoordinateTransformer.pageToPDFStandard({ x: px, y: py }, pageTransform);
          minX = Math.min(minX, pdfPt.x - 4);
          minY = Math.min(minY, pdfPt.y - 4);
          maxX = Math.max(maxX, pdfPt.x + 4);
          maxY = Math.max(maxY, pdfPt.y + 4);
          if (i === 0 && s === 0) {
            pathOps += `${pdfPt.x.toFixed(2)} ${pdfPt.y.toFixed(2)} m\n`;
          } else {
            pathOps += `${pdfPt.x.toFixed(2)} ${pdfPt.y.toFixed(2)} l\n`;
          }
        }
      }
      pathOps += 'h\n';
    } else if (pdfPts.length >= 2) {
      pathOps += `${pdfPts[0].x.toFixed(2)} ${pdfPts[0].y.toFixed(2)} m\n`;
      for (let i = 1; i < pdfPts.length; i++) {
        pathOps += `${pdfPts[i].x.toFixed(2)} ${pdfPts[i].y.toFixed(2)} l\n`;
      }
      pathOps += 'h\n';
    }

    return { ops: pathOps, rect: [minX, minY, maxX, maxY] };
  }

  private static createAnnotationDicts(
    pdfDoc: PDFDocument,
    _page: any,
    _helvFont: any,
    m: AnyMarkup,
    pageTransform: PDFPageTransform
  ): PDFDict[] {
    if (m.compoundPaths && m.compoundPaths.length > 0) {
      const results: PDFDict[] = [];
      m.compoundPaths.forEach((cp, idx) => {
        const baseSub: any = {
          ...m,
          id: `${m.id}-cp-${idx}`,
          compoundPaths: undefined,
          strokeColor: cp.strokeColor || m.strokeColor || '#ff0000',
          fillColor: cp.fillColor || 'transparent',
          strokeWidth: cp.strokeWidth || m.strokeWidth || 1,
        };
        let subMarkup: AnyMarkup | null = null;
        if ((cp.type === 'polygon' || cp.type === 'polyline') && cp.points && cp.points.length >= 2) {
          subMarkup = {
            ...baseSub,
            type: cp.type,
            points: cp.points,
          } as AnyMarkup;
        } else if (cp.type === 'line' && cp.points && cp.points.length >= 2) {
          subMarkup = {
            ...baseSub,
            type: 'line',
            startPoint: cp.points[0],
            endPoint: cp.points[cp.points.length - 1],
          } as AnyMarkup;
        } else if (cp.circle) {
          subMarkup = {
            ...baseSub,
            type: 'ellipse',
            boxRect: {
              x: cp.circle.cx - cp.circle.r,
              y: cp.circle.cy - cp.circle.r,
              width: cp.circle.r * 2,
              height: cp.circle.r * 2,
            },
          } as AnyMarkup;
        } else if (cp.ellipse) {
          subMarkup = {
            ...baseSub,
            type: 'ellipse',
            boxRect: {
              x: cp.ellipse.cx - cp.ellipse.rx,
              y: cp.ellipse.cy - cp.ellipse.ry,
              width: cp.ellipse.rx * 2,
              height: cp.ellipse.ry * 2,
            },
          } as AnyMarkup;
        } else if (cp.type === 'text' && cp.rect && cp.text) {
          subMarkup = {
            ...baseSub,
            type: 'textbox',
            text: cp.text,
            fontSize: cp.fontSize || 8,
            boxRect: cp.rect,
          } as AnyMarkup;
        } else if (cp.rect) {
          subMarkup = {
            ...baseSub,
            type: 'rectangle',
            boxRect: cp.rect,
          } as AnyMarkup;
        }
        if (subMarkup) {
          const d = this.createAnnotationDict(pdfDoc, subMarkup, pageTransform);
          if (d) results.push(d);
        }
      });
      if (results.length > 0) return results;
    }

    if (m.type === 'cloud_plus') {
      const cpm = m as CloudPlusMarkup;
      const results: PDFDict[] = [];

      if (cpm.cloudPoints && cpm.cloudPoints.length >= 3) {
        const cloudMarkup: CloudMarkup = {
          ...cpm,
          type: 'cloud',
          points: cpm.cloudPoints,
        };
        const cloudDict = this.createAnnotationDict(pdfDoc, cloudMarkup, pageTransform);
        if (cloudDict) results.push(cloudDict);
      }

      const calloutMarkup: CalloutMarkup = {
        ...cpm,
        type: 'callout',
        arrowPoint: cpm.leaderPoint,
        boxRect: cpm.boxRect,
        text: cpm.text || cpm.contents || '',
      };
      const calloutDict = this.createAnnotationDict(pdfDoc, calloutMarkup, pageTransform);
      if (calloutDict) results.push(calloutDict);
      return results;
    }

    const single = this.createAnnotationDict(pdfDoc, m, pageTransform);
    return single ? [single] : [];
  }

  private static createAnnotationDict(
    pdfDoc: PDFDocument,
    m: AnyMarkup,
    pageTransform: PDFPageTransform
  ): PDFDict | null {
    const dict = pdfDoc.context.obj({}) as PDFDict;
    this.fillBaseAnnotationProps(pdfDoc, dict, m);
    const [sr, sg, sb] = this.hexToPdfRgb(m.strokeColor || '#ff0000');
    const hasFill = Boolean(m.fillColor && m.fillColor !== 'transparent');
    const [fr, fg, fb] = this.hexToPdfRgb(m.fillColor || '#ffff00');
    const sw = Math.max(0.5, m.strokeWidth || 1.5);
    const dashOp = this.getPdfDashOperator((m as any).lineStyle, sw);

    switch (m.type) {
      case 'rectangle': {
        const rm = m as RectangleMarkup;
        const box = rm.boxRect;
        if (!box) return null;
        const bl = CoordinateTransformer.pageToPDFStandard({ x: box.x, y: box.y + box.height }, pageTransform);
        const tr = CoordinateTransformer.pageToPDFStandard({ x: box.x + box.width, y: box.y }, pageTransform);
        const x1 = Math.min(bl.x, tr.x);
        const y1 = Math.min(bl.y, tr.y);
        const x2 = Math.max(bl.x, tr.x);
        const y2 = Math.max(bl.y, tr.y);
        const w = Math.max(1, x2 - x1);
        const h = Math.max(1, y2 - y1);

        // Se è un Evidenziatore
        if (rm.subject === 'Evidenziatore') {
          dict.set(PDFName.of('Subtype'), PDFName.of('Highlight'));
          dict.set(PDFName.of('Rect'), pdfDoc.context.obj([x1, y1, x2, y2]));
          dict.set(
            PDFName.of('QuadPoints'),
            pdfDoc.context.obj([x1, y2, x2, y2, x1, y1, x2, y1])
          );
          const [hr, hg, hb] = this.hexToPdfRgb(rm.fillColor || rm.strokeColor || '#40aa55');
          dict.set(PDFName.of('C'), pdfDoc.context.obj([hr, hg, hb]));
          const ops = `${hr} ${hg} ${hb} rg\n${x1.toFixed(2)} ${y1.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re\nf\n`;
          this.attachAppearanceStream(pdfDoc, dict, [x1, y1, x2, y2], ops, rm.fillOpacity ?? 0.4);
          return dict;
        }

        // Se è una Nota / Sticky Note
        if (rm.subject === 'Nota / Commento' || rm.subject === 'Nota') {
          dict.set(PDFName.of('Subtype'), PDFName.of('Text'));
          dict.set(PDFName.of('Rect'), pdfDoc.context.obj([x1, y1, x2, y2]));
          const [nr, ng, nb] = this.hexToPdfRgb(rm.fillColor || '#ffc100');
          dict.set(PDFName.of('C'), pdfDoc.context.obj([nr, ng, nb]));
          const ops = `${nr} ${ng} ${nb} rg\n0.6 0.4 0 rg\n1.2 w\n${x1.toFixed(2)} ${y1.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re\nB\n`;
          this.attachAppearanceStream(pdfDoc, dict, [x1 - 2, y1 - 2, x2 + 2, y2 + 2], ops, 0.95);
          return dict;
        }

        // Rettangolo standard
        dict.set(PDFName.of('Subtype'), PDFName.of('Square'));
        dict.set(PDFName.of('Rect'), pdfDoc.context.obj([x1 - sw, y1 - sw, x2 + sw, y2 + sw]));
        if (hasFill) {
          dict.set(PDFName.of('IC'), pdfDoc.context.obj([fr, fg, fb]));
        }
        let ops = '';
        const rectPath = `${x1.toFixed(2)} ${y1.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re\n`;
        if (hasFill) {
          ops += `q\n/GSF gs\n${fr} ${fg} ${fb} rg\n${rectPath}f\nQ\n`;
        }
        ops += this.buildPdfHatchOps(rectPath, [x1, y1, x2, y2], (rm as any).hatchPattern, (rm as any).hatchColor || rm.strokeColor, (rm as any).hatchScale);
        if (rm.strokeWidth > 0 || !hasFill) {
          ops += `q\n/GS1 gs\n${sr} ${sg} ${sb} RG\n${sw.toFixed(2)} w\n${dashOp}${rectPath}S\nQ\n`;
        }
        this.attachAppearanceStream(pdfDoc, dict, [x1 - sw - 2, y1 - sw - 2, x2 + sw + 2, y2 + sw + 2], ops, rm.opacity ?? 1, rm.fillOpacity);
        return dict;
      }

      case 'ellipse': {
        const em = m as EllipseMarkup;
        const box = em.boxRect;
        if (!box) return null;
        dict.set(PDFName.of('Subtype'), PDFName.of('Circle'));
        const bl = CoordinateTransformer.pageToPDFStandard({ x: box.x, y: box.y + box.height }, pageTransform);
        const tr = CoordinateTransformer.pageToPDFStandard({ x: box.x + box.width, y: box.y }, pageTransform);
        const x1 = Math.min(bl.x, tr.x);
        const y1 = Math.min(bl.y, tr.y);
        const x2 = Math.max(bl.x, tr.x);
        const y2 = Math.max(bl.y, tr.y);
        dict.set(PDFName.of('Rect'), pdfDoc.context.obj([x1 - sw, y1 - sw, x2 + sw, y2 + sw]));
        if (hasFill) {
          dict.set(PDFName.of('IC'), pdfDoc.context.obj([fr, fg, fb]));
        }
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const rx = Math.max(1, (x2 - x1) / 2);
        const ry = Math.max(1, (y2 - y1) / 2);
        const k = 0.5522847498;
        const ox = rx * k;
        const oy = ry * k;
        const bezierPath =
          `${(cx - rx).toFixed(2)} ${cy.toFixed(2)} m\n` +
          `${(cx - rx).toFixed(2)} ${(cy + oy).toFixed(2)} ${(cx - ox).toFixed(2)} ${(cy + ry).toFixed(2)} ${cx.toFixed(2)} ${(cy + ry).toFixed(2)} c\n` +
          `${(cx + ox).toFixed(2)} ${(cy + ry).toFixed(2)} ${(cx + rx).toFixed(2)} ${(cy + oy).toFixed(2)} ${(cx + rx).toFixed(2)} ${cy.toFixed(2)} c\n` +
          `${(cx + rx).toFixed(2)} ${(cy - oy).toFixed(2)} ${(cx + ox).toFixed(2)} ${(cy - ry).toFixed(2)} ${cx.toFixed(2)} ${(cy - ry).toFixed(2)} c\n` +
          `${(cx - ox).toFixed(2)} ${(cy - ry).toFixed(2)} ${(cx - rx).toFixed(2)} ${(cy - oy).toFixed(2)} ${(cx - rx).toFixed(2)} ${cy.toFixed(2)} c\nh\n`;
        let ops = '';
        if (hasFill) {
          ops += `q\n/GSF gs\n${fr} ${fg} ${fb} rg\n${bezierPath}f\nQ\n`;
        }
        ops += this.buildPdfHatchOps(bezierPath, [x1, y1, x2, y2], (em as any).hatchPattern, (em as any).hatchColor || em.strokeColor, (em as any).hatchScale);
        if (em.strokeWidth > 0 || !hasFill) {
          ops += `q\n/GS1 gs\n${sr} ${sg} ${sb} RG\n${sw.toFixed(2)} w\n${dashOp}${bezierPath}S\nQ\n`;
        }
        this.attachAppearanceStream(pdfDoc, dict, [x1 - sw - 2, y1 - sw - 2, x2 + sw + 2, y2 + sw + 2], ops, em.opacity ?? 1, em.fillOpacity);
        return dict;
      }

      case 'cloud':
      case 'cloud_rect': {
        const cm = m as CloudMarkup;
        if (!cm.points || cm.points.length < 3) return null;
        dict.set(PDFName.of('Subtype'), PDFName.of('Polygon'));
        dict.set(PDFName.of('IT'), PDFName.of('PolygonCloud'));
        dict.set(
          PDFName.of('BE'),
          pdfDoc.context.obj({ S: PDFName.of('C'), I: PDFNumber.of(1) })
        );

        const vertArray: number[] = [];
        for (const pt of cm.points) {
          const pdfPt = CoordinateTransformer.pageToPDFStandard(pt, pageTransform);
          vertArray.push(pdfPt.x, pdfPt.y);
        }
        dict.set(PDFName.of('Vertices'), pdfDoc.context.obj(vertArray));
        if (hasFill) {
          dict.set(PDFName.of('IC'), pdfDoc.context.obj([fr, fg, fb]));
        }

        const { ops: cloudPath, rect } = this.buildCloudPdfPath(cm.points, pageTransform);
        dict.set(PDFName.of('Rect'), pdfDoc.context.obj(rect));
        let ops = '';
        if (hasFill) {
          ops += `q\n/GSF gs\n${fr} ${fg} ${fb} rg\n${cloudPath}f\nQ\n`;
        }
        ops += this.buildPdfHatchOps(cloudPath, rect, (cm as any).hatchPattern, (cm as any).hatchColor || cm.strokeColor, (cm as any).hatchScale);
        if (cm.strokeWidth > 0 || !hasFill) {
          ops += `q\n/GS1 gs\n${sr} ${sg} ${sb} RG\n${sw.toFixed(2)} w\n${cloudPath}S\nQ\n`;
        }
        this.attachAppearanceStream(pdfDoc, dict, rect, ops, cm.opacity ?? 1, cm.fillOpacity);
        return dict;
      }

      case 'callout': {
        const com = m as CalloutMarkup;
        const box = com.boxRect;
        if (!box) return null;
        dict.set(PDFName.of('Subtype'), PDFName.of('FreeText'));
        dict.set(PDFName.of('IT'), PDFName.of('FreeTextCallout'));
        const calloutAnnotRot = (((pageTransform.rotation || 0) + ((com as any).rotation || 0)) % 360 + 360) % 360;
        if (calloutAnnotRot !== 0) {
          dict.set(PDFName.of('Rotate'), PDFNumber.of(calloutAnnotRot));
        }

        const bl = CoordinateTransformer.pageToPDFStandard({ x: box.x, y: box.y + box.height }, pageTransform);
        const tr = CoordinateTransformer.pageToPDFStandard({ x: box.x + box.width, y: box.y }, pageTransform);
        const bx1 = Math.min(bl.x, tr.x);
        const by1 = Math.min(bl.y, tr.y);
        const bx2 = Math.max(bl.x, tr.x);
        const by2 = Math.max(bl.y, tr.y);
        const arrowPtVp = com.arrowPoint || { x: box.x, y: box.y };
        const arrowPdf = CoordinateTransformer.pageToPDFStandard(arrowPtVp, pageTransform);
        const anchorVp = {
          x: arrowPtVp.x < box.x + box.width / 2 ? box.x : box.x + box.width,
          y: box.y + box.height / 2,
        };
        const anchorPdf = CoordinateTransformer.pageToPDFStandard(anchorVp, pageTransform);
        const anchorX = anchorPdf.x;
        const anchorY = anchorPdf.y;

        const minX = Math.min(bx1, arrowPdf.x) - 10;
        const minY = Math.min(by1, arrowPdf.y) - 10;
        const maxX = Math.max(bx2, arrowPdf.x) + 10;
        const maxY = Math.max(by2, arrowPdf.y) + 10;

        dict.set(PDFName.of('Rect'), pdfDoc.context.obj([minX, minY, maxX, maxY]));
        dict.set(PDFName.of('CL'), pdfDoc.context.obj([arrowPdf.x, arrowPdf.y, anchorX, anchorY]));
        dict.set(PDFName.of('LE'), pdfDoc.context.obj([PDFName.of('ClosedArrow')]));

        const fontSize = com.fontSize || 11;
        const [trCol, tgCol, tbCol] = this.hexToPdfRgb(com.textColor || com.strokeColor || '#db3125');
        dict.set(PDFName.of('DA'), PDFString.of(`${trCol} ${tgCol} ${tbCol} rg /Helv ${fontSize} Tf`));
        dict.set(PDFName.of('Contents'), PDFString.of(com.text || com.contents || ''));

        let ops = `${sr} ${sg} ${sb} RG\n1 1 1 rg\n${sw.toFixed(2)} w\n`;
        // Linea freccia + punta chiusa stile Bluebeam
        ops += `${arrowPdf.x.toFixed(2)} ${arrowPdf.y.toFixed(2)} m\n${anchorX.toFixed(2)} ${anchorY.toFixed(2)} l\nS\n`;
        ops += this.buildPdfArrowHeadOps(arrowPdf, { x: anchorX, y: anchorY }, sw, [sr, sg, sb]);
        // Box callout
        ops += `${bx1.toFixed(2)} ${by1.toFixed(2)} ${(bx2 - bx1).toFixed(2)} ${(by2 - by1).toFixed(2)} re\nB\n`;
        // Testo multi-riga (compensando /Rotate della pagina)
        const lines = (com.text || com.contents || '').split(/\r?\n/);
        const [ta, tb, tc, td] = CoordinateTransformer.getTextMatrixForPageRotation(pageTransform);
        ops += `BT\n/F1 ${fontSize} Tf\n${trCol} ${tgCol} ${tbCol} rg\n`;
        let currYVp = box.y + fontSize + 4;
        for (const line of lines) {
          if (currYVp > box.y + box.height - 2) break;
          const tPos = CoordinateTransformer.pageToPDFStandard({ x: box.x + 5, y: currYVp }, pageTransform);
          ops += `${ta} ${tb} ${tc} ${td} ${tPos.x.toFixed(2)} ${tPos.y.toFixed(2)} Tm\n(${this.escapePdfLiteral(line)}) Tj\n`;
          currYVp += fontSize * 1.25;
        }
        ops += 'ET\n';

        this.attachAppearanceStream(pdfDoc, dict, [minX, minY, maxX, maxY], ops, com.opacity ?? 1);
        return dict;
      }

      case 'textbox': {
        const tm = m as TextMarkup;
        const box = tm.boxRect;
        if (!box) return null;
        dict.set(PDFName.of('Subtype'), PDFName.of('FreeText'));
        const textAnnotRot = (((pageTransform.rotation || 0) + ((tm as any).rotation || 0)) % 360 + 360) % 360;
        if (textAnnotRot !== 0) {
          dict.set(PDFName.of('Rotate'), PDFNumber.of(textAnnotRot));
        }
        const bl = CoordinateTransformer.pageToPDFStandard({ x: box.x, y: box.y + box.height }, pageTransform);
        const tr = CoordinateTransformer.pageToPDFStandard({ x: box.x + box.width, y: box.y }, pageTransform);
        const bx1 = Math.min(bl.x, tr.x);
        const by1 = Math.min(bl.y, tr.y);
        const bx2 = Math.max(bl.x, tr.x);
        const by2 = Math.max(bl.y, tr.y);
        dict.set(PDFName.of('Rect'), pdfDoc.context.obj([bx1 - 2, by1 - 2, bx2 + 2, by2 + 2]));

        const fontSize = tm.fontSize || 12;
        const [trCol, tgCol, tbCol] = this.hexToPdfRgb(tm.textColor || tm.strokeColor || '#db3125');
        dict.set(PDFName.of('DA'), PDFString.of(`${trCol} ${tgCol} ${tbCol} rg /Helv ${fontSize} Tf`));
        dict.set(PDFName.of('Contents'), PDFString.of(tm.text || tm.contents || ''));

        let ops = '';
        if (hasFill) {
          ops += `q\n/GSF gs\n${fr} ${fg} ${fb} rg\n${bx1.toFixed(2)} ${by1.toFixed(2)} ${(bx2 - bx1).toFixed(2)} ${(by2 - by1).toFixed(2)} re\nf\nQ\n`;
        }
        if ((tm.strokeWidth || 0) > 0) {
          ops += `${sr} ${sg} ${sb} RG\n${tm.strokeWidth.toFixed(2)} w\n${bx1.toFixed(2)} ${by1.toFixed(2)} ${(bx2 - bx1).toFixed(2)} ${(by2 - by1).toFixed(2)} re\nS\n`;
        }
        const lines = (tm.text || tm.contents || '').split(/\r?\n/);
        const [ta, tb, tc, td] = CoordinateTransformer.getTextMatrixForPageRotation(pageTransform);
        ops += `BT\n/F1 ${fontSize} Tf\n${trCol} ${tgCol} ${tbCol} rg\n`;
        let currYVp = box.y + fontSize + 3;
        for (const line of lines) {
          if (currYVp > box.y + box.height + 4) break;
          const tPos = CoordinateTransformer.pageToPDFStandard({ x: box.x + 4, y: currYVp }, pageTransform);
          ops += `${ta} ${tb} ${tc} ${td} ${tPos.x.toFixed(2)} ${tPos.y.toFixed(2)} Tm\n(${this.escapePdfLiteral(line)}) Tj\n`;
          currYVp += fontSize * 1.25;
        }
        ops += 'ET\n';

        this.attachAppearanceStream(pdfDoc, dict, [bx1 - 4, by1 - 4, bx2 + 4, by2 + 4], ops, tm.opacity ?? 1, tm.fillOpacity);
        return dict;
      }

      case 'line':
      case 'arrow':
      case 'measure_length': {
        const lm = m as LineMarkup | MeasureLengthMarkup;
        if (!lm.startPoint || !lm.endPoint) return null;
        dict.set(PDFName.of('Subtype'), PDFName.of('Line'));
        if (m.type === 'measure_length') {
          dict.set(PDFName.of('IT'), PDFName.of('LineDimension'));
        }
        const p1 = CoordinateTransformer.pageToPDFStandard(lm.startPoint, pageTransform);
        const p2 = CoordinateTransformer.pageToPDFStandard(lm.endPoint, pageTransform);
        dict.set(PDFName.of('L'), pdfDoc.context.obj([p1.x, p1.y, p2.x, p2.y]));
        const hasEndArrow = m.type === 'arrow' || lm.endHead === 'arrow';
        const hasStartArrow = lm.startHead === 'arrow';
        if (hasStartArrow || hasEndArrow) {
          dict.set(
            PDFName.of('LE'),
            pdfDoc.context.obj([
              PDFName.of(hasStartArrow ? 'ClosedArrow' : 'None'),
              PDFName.of(hasEndArrow ? 'ClosedArrow' : 'None'),
            ])
          );
        }
        const rect = CoordinateTransformer.computePDFRect([lm.startPoint, lm.endPoint], pageTransform);
        const padRect: [number, number, number, number] = [rect[0] - 35, rect[1] - 35, rect[2] + 35, rect[3] + 35];
        dict.set(PDFName.of('Rect'), pdfDoc.context.obj(padRect));

        let ops = `q\n${sr} ${sg} ${sb} RG\n${sw.toFixed(2)} w\n${dashOp}${p1.x.toFixed(2)} ${p1.y.toFixed(2)} m\n${p2.x.toFixed(2)} ${p2.y.toFixed(2)} l\nS\nQ\n`;
        if (hasEndArrow) {
          ops += this.buildPdfArrowHeadOps(p2, p1, sw, [sr, sg, sb]);
        }
        if (hasStartArrow) {
          ops += this.buildPdfArrowHeadOps(p1, p2, sw, [sr, sg, sb]);
        }
        if (m.type === 'measure_length') {
          const mlm = m as MeasureLengthMarkup;
          const dist = ScaleManager.calculateDistance(mlm.startPoint, mlm.endPoint);
          const label = mlm.customText || `${(mlm.realLength || dist).toFixed(1)} ${mlm.unit || 'pt'}`;
          const [ta, tb, tc, td] = CoordinateTransformer.getTextMatrixForPageRotation(pageTransform);
          const mPos = CoordinateTransformer.pageToPDFStandard(
            { x: (lm.startPoint.x + lm.endPoint.x) / 2, y: (lm.startPoint.y + lm.endPoint.y) / 2 - 6 },
            pageTransform
          );
          ops += `BT\n/F1 10 Tf\n${sr} ${sg} ${sb} rg\n${ta} ${tb} ${tc} ${td} ${mPos.x.toFixed(2)} ${mPos.y.toFixed(2)} Tm\n(${this.escapePdfLiteral(label)}) Tj\nET\n`;
        }
        this.attachAppearanceStream(pdfDoc, dict, padRect, ops, lm.opacity ?? 1);
        return dict;
      }

      case 'polyline':
      case 'measure_polyline':
      case 'polygon':
      case 'measure_area':
      case 'measure_area_rect': {
        const pm = m as PolylineMarkup | PolygonMarkup | MeasureAreaMarkup;
        if (!pm.points || pm.points.length < 2) return null;
        const isClosed = m.type === 'polygon' || m.type === 'measure_area' || m.type === 'measure_area_rect';
        dict.set(PDFName.of('Subtype'), PDFName.of(isClosed ? 'Polygon' : 'PolyLine'));

        const vertArray: number[] = [];
        const pdfPts: Point2D[] = [];
        for (const pt of pm.points) {
          const pdfPt = CoordinateTransformer.pageToPDFStandard(pt, pageTransform);
          vertArray.push(pdfPt.x, pdfPt.y);
          pdfPts.push(pdfPt);
        }
        dict.set(PDFName.of('Vertices'), pdfDoc.context.obj(vertArray));
        const rect = CoordinateTransformer.computePDFRect(pm.points, pageTransform);
        const padRect: [number, number, number, number] = [rect[0] - 20, rect[1] - 20, rect[2] + 20, rect[3] + 20];
        dict.set(PDFName.of('Rect'), pdfDoc.context.obj(padRect));

        let polyPath = `${pdfPts[0].x.toFixed(2)} ${pdfPts[0].y.toFixed(2)} m\n`;
        for (let i = 1; i < pdfPts.length; i++) {
          polyPath += `${pdfPts[i].x.toFixed(2)} ${pdfPts[i].y.toFixed(2)} l\n`;
        }
        if (isClosed) polyPath += 'h\n';

        let ops = '';
        if (isClosed && hasFill) {
          ops += `q\n/GSF gs\n${fr} ${fg} ${fb} rg\n${polyPath}f\nQ\n`;
        }
        if (isClosed) {
          ops += this.buildPdfHatchOps(polyPath, rect, (pm as any).hatchPattern, (pm as any).hatchColor || pm.strokeColor, (pm as any).hatchScale);
        }
        if (pm.strokeWidth > 0 || !isClosed || !hasFill) {
          ops += `q\n/GS1 gs\n${sr} ${sg} ${sb} RG\n${sw.toFixed(2)} w\n${dashOp}${polyPath}S\nQ\n`;
        }
        this.attachAppearanceStream(pdfDoc, dict, padRect, ops, pm.opacity ?? 1, pm.fillOpacity);
        return dict;
      }

      case 'pen':
      case 'highlighter': {
        const pen = m as PenMarkup;
        if (!pen.points || pen.points.length < 2) return null;
        dict.set(PDFName.of('Subtype'), PDFName.of('Ink'));
        const strokeArr: number[] = [];
        const pdfPts: Point2D[] = [];
        for (const pt of pen.points) {
          const pdfPt = CoordinateTransformer.pageToPDFStandard(pt, pageTransform);
          strokeArr.push(pdfPt.x, pdfPt.y);
          pdfPts.push(pdfPt);
        }
        dict.set(PDFName.of('InkList'), pdfDoc.context.obj([pdfDoc.context.obj(strokeArr)]));
        const rect = CoordinateTransformer.computePDFRect(pen.points, pageTransform);
        const pad = Math.max(10, sw * 2);
        const padRect: [number, number, number, number] = [rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad];
        dict.set(PDFName.of('Rect'), pdfDoc.context.obj(padRect));

        let ops = `${sr} ${sg} ${sb} RG\n${sw.toFixed(2)} w\n1 J\n1 j\n`;
        ops += `${pdfPts[0].x.toFixed(2)} ${pdfPts[0].y.toFixed(2)} m\n`;
        for (let i = 1; i < pdfPts.length; i++) {
          ops += `${pdfPts[i].x.toFixed(2)} ${pdfPts[i].y.toFixed(2)} l\n`;
        }
        ops += 'S\n';
        this.attachAppearanceStream(
          pdfDoc,
          dict,
          padRect,
          ops,
          m.type === 'highlighter' ? 0.38 : (pen.opacity ?? 1)
        );
        return dict;
      }

      case 'stamp': {
        const sm = m as StampMarkup;
        const box = sm.boxRect;
        if (!box) return null;
        dict.set(PDFName.of('Subtype'), PDFName.of('Stamp'));
        const stampAnnotRot = (((pageTransform.rotation || 0) + ((sm as any).rotation || 0)) % 360 + 360) % 360;
        if (stampAnnotRot !== 0) {
          dict.set(PDFName.of('Rotate'), PDFNumber.of(stampAnnotRot));
        }
        const bl = CoordinateTransformer.pageToPDFStandard({ x: box.x, y: box.y + box.height }, pageTransform);
        const tr = CoordinateTransformer.pageToPDFStandard({ x: box.x + box.width, y: box.y }, pageTransform);
        const x1 = Math.min(bl.x, tr.x);
        const y1 = Math.min(bl.y, tr.y);
        const x2 = Math.max(bl.x, tr.x);
        const y2 = Math.max(bl.y, tr.y);
        dict.set(PDFName.of('Rect'), pdfDoc.context.obj([x1 - 4, y1 - 4, x2 + 4, y2 + 4]));
        const title = sm.stampTitle || 'APPROVATO';
        const fontSize = Math.max(7, Math.min(16, box.height * 0.38));
        const [ta, tb, tc, td] = CoordinateTransformer.getTextMatrixForPageRotation(pageTransform);
        const tPos = CoordinateTransformer.pageToPDFStandard(
          { x: box.x + 6, y: box.y + box.height / 2 + fontSize * 0.35 },
          pageTransform
        );
        const ops =
          `${sr} ${sg} ${sb} RG\n2 w\n${x1.toFixed(2)} ${y1.toFixed(2)} ${(x2 - x1).toFixed(2)} ${(y2 - y1).toFixed(2)} re\nS\n` +
          `BT\n/F1 ${fontSize.toFixed(1)} Tf\n${sr} ${sg} ${sb} rg\n${ta} ${tb} ${tc} ${td} ${tPos.x.toFixed(2)} ${tPos.y.toFixed(2)} Tm\n(${this.escapePdfLiteral(title)}) Tj\nET\n`;
        this.attachAppearanceStream(pdfDoc, dict, [x1 - 4, y1 - 4, x2 + 4, y2 + 4], ops, sm.opacity ?? 1);
        return dict;
      }

      case 'measure_count': {
        const cm = m as MeasureCountMarkup;
        if (!cm.locations || cm.locations.length === 0) return null;
        dict.set(PDFName.of('Subtype'), PDFName.of('Polygon'));
        const rect = CoordinateTransformer.computePDFRect(cm.locations, pageTransform);
        const padRect: [number, number, number, number] = [rect[0] - 20, rect[1] - 20, rect[2] + 20, rect[3] + 20];
        dict.set(PDFName.of('Rect'), pdfDoc.context.obj(padRect));
        const [ta, tb, tc, td] = CoordinateTransformer.getTextMatrixForPageRotation(pageTransform);
        let ops = '';
        cm.locations.forEach((loc, idx) => {
          const p = CoordinateTransformer.pageToPDFStandard(loc, pageTransform);
          const tPos = CoordinateTransformer.pageToPDFStandard({ x: loc.x - 3, y: loc.y + 3 }, pageTransform);
          ops += `${sr} ${sg} ${sb} rg\n${(p.x - 8).toFixed(2)} ${(p.y - 8).toFixed(2)} 16 16 re\nf\n`;
          ops += `BT\n/F1 9 Tf\n1 1 1 rg\n${ta} ${tb} ${tc} ${td} ${tPos.x.toFixed(2)} ${tPos.y.toFixed(2)} Tm\n(${idx + 1}) Tj\nET\n`;
        });
        this.attachAppearanceStream(pdfDoc, dict, padRect, ops, cm.opacity ?? 1);
        return dict;
      }

      case 'hyperlink': {
        const hm = m as any;
        const box = hm.boxRect;
        if (!box) return null;
        dict.set(PDFName.of('Subtype'), PDFName.of('Link'));
        const bl = CoordinateTransformer.pageToPDFStandard({ x: box.x, y: box.y + box.height }, pageTransform);
        const tr = CoordinateTransformer.pageToPDFStandard({ x: box.x + box.width, y: box.y }, pageTransform);
        const x1 = Math.min(bl.x, tr.x);
        const y1 = Math.min(bl.y, tr.y);
        const x2 = Math.max(bl.x, tr.x);
        const y2 = Math.max(bl.y, tr.y);
        dict.set(PDFName.of('Rect'), pdfDoc.context.obj([x1, y1, x2, y2]));
        dict.set(PDFName.of('Border'), pdfDoc.context.obj([0, 0, 1]));
        dict.set(PDFName.of('C'), pdfDoc.context.obj([0.23, 0.51, 0.96]));

        if (hm.actionType === 'url' && hm.targetUrl) {
          dict.set(
            PDFName.of('A'),
            pdfDoc.context.obj({
              Type: PDFName.of('Action'),
              S: PDFName.of('URI'),
              URI: PDFString.of(hm.targetUrl),
            })
          );
        } else if (hm.actionType === 'open_file' && hm.targetFilePath) {
          dict.set(
            PDFName.of('A'),
            pdfDoc.context.obj({
              Type: PDFName.of('Action'),
              S: PDFName.of('Launch'),
              F: PDFString.of(hm.targetFilePath),
            })
          );
        } else if (hm.actionType === 'goto_page') {
          const pages = pdfDoc.getPages();
          const targetIdx = Math.max(0, Math.min(pages.length - 1, (hm.targetPage || 1) - 1));
          const targetPageRef = pages[targetIdx]?.ref;
          if (targetPageRef) {
            dict.set(
              PDFName.of('A'),
              pdfDoc.context.obj({
                Type: PDFName.of('Action'),
                S: PDFName.of('GoTo'),
                D: pdfDoc.context.obj([targetPageRef, PDFName.of('Fit')]),
              })
            );
          }
        }
        return dict;
      }

      default:
        return null;
    }
  }

  private static async attachImageStampAppearance(
    pdfDoc: PDFDocument,
    dict: PDFDict,
    sm: StampMarkup,
    pageTransform: PDFPageTransform
  ): Promise<void> {
    if (!sm.imageDataUrl || !sm.boxRect) return;
    try {
      const dataUrl = sm.imageDataUrl;
      const rotDeg = ((sm.rotation || 0) % 360 + 360) % 360;
      const isPng = dataUrl.startsWith('data:image/png');
      const isJpg = dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg');
      let imgBytes: Uint8Array;
      let embedAsJpg = isJpg;
      if ((isPng || isJpg) && rotDeg === 0) {
        const base64 = dataUrl.split(',')[1] || '';
        const bin = atob(base64);
        imgBytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) imgBytes[i] = bin.charCodeAt(i);
      } else {
        // Rasterizza altri formati (WebP, SVG, GIF) o immagini ruotate in PNG tramite Canvas offscreen
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Image load failed'));
          img.src = dataUrl;
        });
        const natW = Math.max(1, img.naturalWidth || Math.round(sm.boxRect.width * 2));
        const natH = Math.max(1, img.naturalHeight || Math.round(sm.boxRect.height * 2));
        const rad = (rotDeg * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(natW * cos + natH * sin));
        c.height = Math.max(1, Math.round(natW * sin + natH * cos));
        const cx = c.getContext('2d');
        if (!cx) return;
        cx.translate(c.width / 2, c.height / 2);
        cx.rotate(rad);
        cx.drawImage(img, -natW / 2, -natH / 2, natW, natH);
        const pngData = c.toDataURL('image/png').split(',')[1] || '';
        const bin = atob(pngData);
        imgBytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) imgBytes[i] = bin.charCodeAt(i);
        embedAsJpg = false;
      }

      const embedded = embedAsJpg ? await pdfDoc.embedJpg(imgBytes) : await pdfDoc.embedPng(imgBytes);
      const bl = CoordinateTransformer.pageToPDFStandard(
        { x: sm.boxRect.x, y: sm.boxRect.y + sm.boxRect.height },
        pageTransform
      );
      const tr = CoordinateTransformer.pageToPDFStandard(
        { x: sm.boxRect.x + sm.boxRect.width, y: sm.boxRect.y },
        pageTransform
      );
      const x1 = Math.min(bl.x, tr.x);
      const y1 = Math.min(bl.y, tr.y);
      const w = Math.max(1, Math.abs(tr.x - bl.x));
      const h = Math.max(1, Math.abs(tr.y - bl.y));
      dict.set(PDFName.of('Rect'), pdfDoc.context.obj([x1, y1, x1 + w, y1 + h]));

      const ops = `q\n${CoordinateTransformer.getImageMatrixForPageRotation(sm.boxRect, pageTransform).map((n) => n.toFixed(2)).join(' ')} cm\n/Im1 Do\nQ\n`;
      const xObjects = pdfDoc.context.obj({ Im1: embedded.ref });
      const resources = pdfDoc.context.obj({ XObject: xObjects });
      const formDict = pdfDoc.context.obj({
        Type: PDFName.of('XObject'),
        Subtype: PDFName.of('Form'),
        FormType: 1,
        BBox: pdfDoc.context.obj([x1, y1, x1 + w, y1 + h]),
        Resources: resources,
      });
      const formStream = pdfDoc.context.stream(ops, formDict as any);
      const formRef = pdfDoc.context.register(formStream);
      dict.set(PDFName.of('AP'), pdfDoc.context.obj({ N: formRef }));
    } catch (err) {
      console.warn('Impossibile incorporare immagine timbro nel PDF:', err);
    }
  }
}
