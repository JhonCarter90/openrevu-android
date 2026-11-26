import pako from 'pako';
import { AnyMarkup, LineStyle, Point2D, PolylineMarkup } from '../../types/markup';

export interface CompoundSubPath {
  type: 'polyline' | 'polygon' | 'circle' | 'ellipse' | 'line' | 'rect' | 'text';
  points?: Point2D[];
  circle?: { cx: number; cy: number; r: number };
  ellipse?: { cx: number; cy: number; rx: number; ry: number };
  rect?: { x: number; y: number; width: number; height: number };
  text?: string;
  fontSize?: number;
  strokeColor: string;
  strokeWidth: number;
  fillColor?: string;
  closed?: boolean;
  lineStyle?: LineStyle;
}

export interface BtxSymbolTool {
  id: string;
  name: string;
  subject: string;
  category: string;
  type: 'polyline' | 'polygon' | 'rectangle' | 'ellipse' | 'cloud' | 'callout' | 'stamp_symbol';
  strokeColor: string;
  fillColor?: string;
  strokeWidth: number;
  opacity: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted' | 'dash_dot';
  /** Normalized 0..1 subpaths for crisp CAD symbol preview and placement */
  compoundPaths: CompoundSubPath[];
  /** Native aspect ratio (width / height) */
  aspectRatio: number;
  /** Default placement width in PDF points */
  defaultWidth: number;
  /** Default placement height in PDF points */
  defaultHeight: number;
}

export interface BtxToolSet {
  id: string;
  title: string;
  fileName: string;
  tools: BtxSymbolTool[];
}

function tryDecompressHex(hexStr: string): string | null {
  const clean = hexStr.trim().replace(/\s+/g, '');
  if (!clean || clean.length < 4 || clean.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(clean)) return null;
  if (!clean.toLowerCase().startsWith('78')) return null;

  try {
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
    }
    const inflated = pako.inflate(bytes);
    if (inflated.length >= 2 && inflated[0] === 0xff && inflated[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(inflated.subarray(2));
    }
    if (inflated.length >= 3 && inflated[0] === 0xef && inflated[1] === 0xbb && inflated[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(inflated.subarray(3));
    }
    const hasNullBytes = inflated.length >= 4 && inflated[1] === 0 && inflated[3] === 0;
    if (hasNullBytes) {
      return new TextDecoder('utf-16le').decode(inflated);
    }
    return new TextDecoder('utf-8').decode(inflated);
  } catch {
    return null;
  }
}

function decodeTitleIfNeeded(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const decompressed = tryDecompressHex(trimmed);
  if (decompressed) {
    return decompressed.replace(/\0/g, '').trim() || fallback;
  }
  return trimmed;
}

function rgbFloatsToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parsePdfColor(rawStr: string, key: string = '/C'): string | undefined {
  const regex = new RegExp(`${key}\\s*\\[\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\]`);
  const match = rawStr.match(regex);
  if (match) {
    return rgbFloatsToHex(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]));
  }
  return undefined;
}

function parseHtmlHexColor(rawStr: string): string | undefined {
  const match = rawStr.match(/color:\s*(#[0-9a-fA-F]{6})/i);
  return match ? match[1] : undefined;
}

function parseLineWidth(rawStr: string): number {
  const wZero = rawStr.match(/\/W\s+0(?:\.0+)?(?:\b|\/|>|\s)/);
  if (wZero) return 0;
  const match = rawStr.match(/\/W\s+([\d.]+)/);
  if (match) {
    const w = parseFloat(match[1]);
    if (!isNaN(w)) return w === 0 ? 0 : Math.max(0.5, Math.min(12, w));
  }
  return 1.5;
}

function parseOpacity(rawStr: string): number {
  const match = rawStr.match(/\/CA\s+([\d.]+)/);
  if (match) {
    const ca = parseFloat(match[1]);
    if (!isNaN(ca) && ca > 0) return Math.max(0.1, Math.min(1, ca));
  }
  return 1;
}

function decodePdfString(str: string): string {
  if (!str) return '';
  const cleaned = str.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  const hexAttempt = tryDecompressHex(cleaned);
  if (hexAttempt) return hexAttempt.replace(/\0/g, '').trim();
  return cleaned
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .trim();
}

interface ParsedFormXObject {
  bbox: [number, number, number, number];
  matrix: [number, number, number, number, number, number];
  stream: string;
  xObjects: Record<string, string>;
}

function tryInflateHexToBytes(hexStr: string): Uint8Array | null {
  const clean = hexStr.trim().replace(/\s+/g, '');
  if (!clean || clean.length < 4 || clean.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(clean)) return null;
  if (!clean.toLowerCase().startsWith('78')) return null;
  try {
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
    }
    return pako.inflate(bytes);
  } catch {
    return null;
  }
}

function extractFormResources(rawXml: string): Map<string, ParsedFormXObject> {
  const map = new Map<string, ParsedFormXObject>();
  const addResource = (key: string, hexBody: string) => {
    const buf = tryInflateHexToBytes(hexBody);
    if (!buf) return;

    const latin1 = new TextDecoder('latin1').decode(buf);
    if (!latin1.includes('/Form') && !latin1.includes('stream')) return;

    const bboxMatch = latin1.match(/\/BBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
    const matrixMatch = latin1.match(
      /\/Matrix\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/
    );

    const streamKwIdx = latin1.indexOf('stream');
    if (streamKwIdx < 0) return;
    let sStart = streamKwIdx + 6;
    if (latin1[sStart] === '\r') sStart++;
    if (latin1[sStart] === '\n') sStart++;
    const sEnd = latin1.lastIndexOf('endstream');
    if (sEnd <= sStart) return;

    const dictHeader = latin1.slice(0, streamKwIdx);
    let streamStr = '';
    if (/\/Filter\s*\/FlateDecode/i.test(dictHeader)) {
      try {
        const rawSlice = buf.subarray(sStart, sEnd);
        streamStr = new TextDecoder('utf-8').decode(pako.inflate(rawSlice));
      } catch {
        // Trim trailing CR/LF before endstream if needed
        try {
          let trimmedEnd = sEnd;
          while (trimmedEnd > sStart && (buf[trimmedEnd - 1] === 10 || buf[trimmedEnd - 1] === 13)) {
            trimmedEnd--;
          }
          streamStr = new TextDecoder('utf-8').decode(pako.inflate(buf.subarray(sStart, trimmedEnd)));
        } catch {
          return;
        }
      }
    } else {
      streamStr = latin1.slice(sStart, sEnd);
    }

    const xObjects: Record<string, string> = {};
    const xobjDictMatch = dictHeader.match(/\/XObject\s*<<([^>]*)>>/);
    if (xobjDictMatch) {
      const pairRegex = /\/([A-Za-z0-9_.-]+)\s*\/([A-Za-z0-9_.-]+)/g;
      let pm: RegExpExecArray | null;
      while ((pm = pairRegex.exec(xobjDictMatch[1])) !== null) {
        xObjects[pm[1]] = pm[2];
      }
    }

    const bbox: [number, number, number, number] = bboxMatch
      ? [
          parseFloat(bboxMatch[1]),
          parseFloat(bboxMatch[2]),
          parseFloat(bboxMatch[3]),
          parseFloat(bboxMatch[4]),
        ]
      : [0, 0, 100, 100];

    const matrix: [number, number, number, number, number, number] = matrixMatch
      ? [
          parseFloat(matrixMatch[1]),
          parseFloat(matrixMatch[2]),
          parseFloat(matrixMatch[3]),
          parseFloat(matrixMatch[4]),
          parseFloat(matrixMatch[5]),
          parseFloat(matrixMatch[6]),
        ]
      : [1, 0, 0, 1, 0, 0];

    const obj: ParsedFormXObject = {
      bbox,
      matrix,
      stream: streamStr,
      xObjects,
    };
    map.set(key, obj);
    map.set(`BBObjPtr_${key}`, obj);
  };

  // Format 1: <ID>hex</ID> <Data>hex</Data> (Bluebeam ToolChestItem Resources)
  const idDataRegex = /<ID>([\s\S]*?)<\/ID>\s*<Data>([\s\S]*?)<\/Data>/gi;
  let m: RegExpExecArray | null;
  while ((m = idDataRegex.exec(rawXml)) !== null) {
    const k = decodeTitleIfNeeded(m[1], m[1].trim());
    addResource(k, m[2].trim());
  }

  // Format 2: <Resource><Key>...</Key><Raw|Value|Data>...</Raw|Value|Data></Resource>
  const resBlockRegex = /<Resource\b[^>]*>([\s\S]*?)<\/Resource>/gi;
  while ((m = resBlockRegex.exec(rawXml)) !== null) {
    const block = m[1];
    const keyTag = block.match(/<Key>([\s\S]*?)<\/Key>/i);
    const rawTag = block.match(/<(?:Raw|Value|Data)>([\s\S]*?)<\/(?:Raw|Value|Data)>/i);
    if (keyTag) {
      const k = decodeTitleIfNeeded(keyTag[1], keyTag[1].trim());
      const body = rawTag ? rawTag[1].trim() : block.replace(/<Key>[\s\S]*?<\/Key>/i, '').trim();
      addResource(k, body);
    }
  }

  // Format 3: <Resource Key="...">...</Resource>
  const resAttrRegex = /<Resource\b[^>]*\bKey="([^"]+)"[^>]*>([\s\S]*?)<\/Resource>/gi;
  while ((m = resAttrRegex.exec(rawXml)) !== null) {
    addResource(m[1].trim(), m[2].trim());
  }

  return map;
}

function applyMatrix(
  m: [number, number, number, number, number, number],
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

function multiplyMatrix(
  m1: [number, number, number, number, number, number],
  m2: [number, number, number, number, number, number]
): [number, number, number, number, number, number] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function sampleCubicBezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  steps = 8
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x =
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x;
    const y =
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y;
    pts.push({ x, y });
  }
  return pts;
}

/**
 * Parses PDF Form XObject vector content stream into target Rect coordinates.
 */
function parseFormStreamToCompoundPaths(
  res: ParsedFormXObject,
  targetRect: [number, number, number, number],
  defaultStroke: string,
  formResources?: Map<string, ParsedFormXObject>,
  depth = 0
): { paths: CompoundSubPath[]; strokeColor: string; strokeWidth: number } {
  const paths: CompoundSubPath[] = [];

  const [bx1, by1, bx2, by2] = res.bbox;
  const p1 = applyMatrix(res.matrix, bx1, by1);
  const p2 = applyMatrix(res.matrix, bx2, by2);
  const formMinX = Math.min(p1.x, p2.x);
  const formMaxX = Math.max(p1.x, p2.x);
  const formMinY = Math.min(p1.y, p2.y);
  const formMaxY = Math.max(p1.y, p2.y);
  const formW = Math.max(0.001, formMaxX - formMinX);
  const formH = Math.max(0.001, formMaxY - formMinY);

  const [rx1, ry1, rx2, ry2] = targetRect;
  const rMinX = Math.min(rx1, rx2);
  const rMinY = Math.min(ry1, ry2);
  const rW = Math.max(0.001, Math.abs(rx2 - rx1));
  const rH = Math.max(0.001, Math.abs(ry2 - ry1));

  type GState = {
    ctm: [number, number, number, number, number, number];
    strokeColor: string;
    fillColor: string;
    lineWidth: number;
    dash: boolean;
  };

  let state: GState = {
    ctm: [1, 0, 0, 1, 0, 0],
    strokeColor: defaultStroke,
    fillColor: defaultStroke,
    lineWidth: 1.5,
    dash: false,
  };
  const stack: GState[] = [];

  const mapPt = (rawX: number, rawY: number): { x: number; y: number } => {
    const ctmPt = applyMatrix(state.ctm, rawX, rawY);
    const formPt = applyMatrix(res.matrix, ctmPt.x, ctmPt.y);
    const nx = (formPt.x - formMinX) / formW;
    const ny = (formPt.y - formMinY) / formH;
    return {
      x: rMinX + nx * rW,
      y: rMinY + ny * rH,
    };
  };

  let subpaths: { pts: { x: number; y: number }[]; closed: boolean }[] = [];
  let currentPts: { x: number; y: number }[] = [];
  let inTextBlock = false;
  let lastValidStrokeColor = defaultStroke;
  let lastValidLineWidth = 1.5;
  let lastPdfName = '';

  // Match PDF names (/oc9, /GT255, /F1) and arrays ([3 3]) BEFORE numbers so digits inside names are never parsed as coordinates!
  const tokens = res.stream.match(/\/[A-Za-z0-9_.-]+|\[[^\]]*\]|\([^)]*\)|[-\d.]+|[a-zA-Z*]+/g) || [];
  const args: number[] = [];
  let lastDashArray = false;

  const flushSubpaths = (doStroke: boolean, doFill: boolean, closeFirst: boolean) => {
    if (currentPts.length > 0) {
      subpaths.push({ pts: currentPts, closed: closeFirst });
      currentPts = [];
    }
    for (const sp of subpaths) {
      if (sp.pts.length < 2) continue;
      const isClosed = sp.closed || closeFirst || doFill;
      paths.push({
        type: isClosed ? 'polygon' : 'polyline',
        points: sp.pts,
        closed: isClosed,
        strokeColor: doStroke ? state.strokeColor : 'transparent',
        fillColor: doFill ? state.fillColor : undefined,
        strokeWidth: state.lineWidth,
        lineStyle: state.dash ? 'dashed' : 'solid',
      });
    }
    subpaths = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === 'BT') {
      inTextBlock = true;
      args.length = 0;
      continue;
    }
    if (tok === 'ET') {
      inTextBlock = false;
      args.length = 0;
      continue;
    }
    if (inTextBlock) {
      args.length = 0;
      continue;
    }
    if (tok.startsWith('[')) {
      const inner = tok.slice(1, -1).trim();
      lastDashArray = inner.length > 0 && /[1-9]/.test(inner);
      continue;
    }
    if (tok.startsWith('/')) {
      lastPdfName = tok.slice(1);
      continue;
    }
    if (tok.startsWith('(')) {
      continue;
    }
    const num = Number(tok);
    if (!isNaN(num) && /^[-\d.]+$/.test(tok)) {
      args.push(num);
      continue;
    }

    switch (tok) {
      case 'q':
        stack.push({
          ctm: [...state.ctm] as [number, number, number, number, number, number],
          strokeColor: state.strokeColor,
          fillColor: state.fillColor,
          lineWidth: state.lineWidth,
          dash: state.dash,
        });
        args.length = 0;
        break;
      case 'Q':
        if (stack.length > 0) state = stack.pop()!;
        args.length = 0;
        break;
      case 'cm':
        if (args.length >= 6) {
          const m2: [number, number, number, number, number, number] = [
            args[args.length - 6],
            args[args.length - 5],
            args[args.length - 4],
            args[args.length - 3],
            args[args.length - 2],
            args[args.length - 1],
          ];
          state.ctm = multiplyMatrix(state.ctm, m2);
        }
        args.length = 0;
        break;
      case 'RG':
        if (args.length >= 3) {
          state.strokeColor = rgbFloatsToHex(
            args[args.length - 3],
            args[args.length - 2],
            args[args.length - 1]
          );
          lastValidStrokeColor = state.strokeColor;
        }
        args.length = 0;
        break;
      case 'rg':
        if (args.length >= 3) {
          state.fillColor = rgbFloatsToHex(
            args[args.length - 3],
            args[args.length - 2],
            args[args.length - 1]
          );
        }
        args.length = 0;
        break;
      case 'G':
        if (args.length >= 1) {
          const g = args[args.length - 1];
          state.strokeColor = rgbFloatsToHex(g, g, g);
          lastValidStrokeColor = state.strokeColor;
        }
        args.length = 0;
        break;
      case 'g':
        if (args.length >= 1) {
          const g = args[args.length - 1];
          state.fillColor = rgbFloatsToHex(g, g, g);
        }
        args.length = 0;
        break;
      case 'w':
        if (args.length >= 1) {
          const rawW = args[args.length - 1];
          const scale = Math.hypot(state.ctm[0], state.ctm[1]) * Math.hypot(res.matrix[0], res.matrix[1]);
          state.lineWidth = Math.max(0.8, Math.min(6, rawW * (scale || 1)));
          lastValidLineWidth = state.lineWidth;
        }
        args.length = 0;
        break;
      case 'd':
        state.dash = lastDashArray;
        lastDashArray = false;
        args.length = 0;
        break;
      case 'm':
        if (args.length >= 2) {
          if (currentPts.length > 0) {
            subpaths.push({ pts: currentPts, closed: false });
          }
          currentPts = [mapPt(args[args.length - 2], args[args.length - 1])];
        }
        args.length = 0;
        break;
      case 'l':
        if (args.length >= 2) {
          currentPts.push(mapPt(args[args.length - 2], args[args.length - 1]));
        }
        args.length = 0;
        break;
      case 'c':
        if (args.length >= 6 && currentPts.length > 0) {
          const p0 = currentPts[currentPts.length - 1];
          const p1 = mapPt(args[args.length - 6], args[args.length - 5]);
          const p2 = mapPt(args[args.length - 4], args[args.length - 3]);
          const p3 = mapPt(args[args.length - 2], args[args.length - 1]);
          currentPts.push(...sampleCubicBezier(p0, p1, p2, p3));
        }
        args.length = 0;
        break;
      case 'v':
        if (args.length >= 4 && currentPts.length > 0) {
          const p0 = currentPts[currentPts.length - 1];
          const p2 = mapPt(args[args.length - 4], args[args.length - 3]);
          const p3 = mapPt(args[args.length - 2], args[args.length - 1]);
          currentPts.push(...sampleCubicBezier(p0, p0, p2, p3));
        }
        args.length = 0;
        break;
      case 'y':
        if (args.length >= 4 && currentPts.length > 0) {
          const p0 = currentPts[currentPts.length - 1];
          const p1 = mapPt(args[args.length - 4], args[args.length - 3]);
          const p3 = mapPt(args[args.length - 2], args[args.length - 1]);
          currentPts.push(...sampleCubicBezier(p0, p1, p3, p3));
        }
        args.length = 0;
        break;
      case 're':
        if (args.length >= 4) {
          if (currentPts.length > 0) {
            subpaths.push({ pts: currentPts, closed: false });
            currentPts = [];
          }
          const rx = args[args.length - 4];
          const ry = args[args.length - 3];
          const rw = args[args.length - 2];
          const rh = args[args.length - 1];
          subpaths.push({
            pts: [
              mapPt(rx, ry),
              mapPt(rx + rw, ry),
              mapPt(rx + rw, ry + rh),
              mapPt(rx, ry + rh),
            ],
            closed: true,
          });
        }
        args.length = 0;
        break;
      case 'h':
        if (currentPts.length > 0) {
          subpaths.push({ pts: currentPts, closed: true });
          currentPts = [];
        }
        args.length = 0;
        break;
      case 'S':
        flushSubpaths(true, false, false);
        args.length = 0;
        break;
      case 's':
        flushSubpaths(true, false, true);
        args.length = 0;
        break;
      case 'f':
      case 'F':
      case 'f*':
        flushSubpaths(false, true, true);
        args.length = 0;
        break;
      case 'B':
      case 'B*':
        flushSubpaths(true, true, false);
        args.length = 0;
        break;
      case 'b':
      case 'b*':
        flushSubpaths(true, true, true);
        args.length = 0;
        break;
      case 'W':
      case 'W*':
        // Clipping path operator: do not flush, next 'n' will discard clipping path
        args.length = 0;
        break;
      case 'n':
        subpaths = [];
        currentPts = [];
        args.length = 0;
        break;
      case 'Do':
        if (depth < 4 && formResources && lastPdfName) {
          const targetKey = res.xObjects?.[lastPdfName] || lastPdfName;
          const nestedRes = formResources.get(targetKey);
          if (nestedRes) {
            const [nbx1, nby1, nbx2, nby2] = nestedRes.bbox;
            const np1 = applyMatrix(nestedRes.matrix, nbx1, nby1);
            const np2 = applyMatrix(nestedRes.matrix, nbx2, nby2);
            const tp1 = mapPt(np1.x, np1.y);
            const tp2 = mapPt(np2.x, np2.y);
            const nestedParsed = parseFormStreamToCompoundPaths(
              nestedRes,
              [tp1.x, tp1.y, tp2.x, tp2.y],
              state.strokeColor,
              formResources,
              depth + 1
            );
            paths.push(...nestedParsed.paths);
          }
        }
        args.length = 0;
        break;
      default:
        args.length = 0;
        break;
    }
  }

  return {
    paths,
    strokeColor: lastValidStrokeColor,
    strokeWidth: lastValidLineWidth,
  };
}

/**
 * Parses an raw Annotation string (which may be a Group containing multiple sub-annotations,
 * or a single Polyline/Polygon/Circle/Square/BRXStamp) into normalized 0..1 CompoundSubPath[].
 */
function parseAnnotationGeometry(
  rawStr: string,
  index: number,
  categoryTitle: string,
  formResources: Map<string, ParsedFormXObject>
): BtxSymbolTool | null {
  let subject = '';
  const subjRegex = /\/Subj\s*\(([^)]*)\)/g;
  let sm: RegExpExecArray | null;
  while ((sm = subjRegex.exec(rawStr)) !== null) {
    const decoded = decodePdfString(sm[1]);
    if (
      decoded &&
      decoded !== 'Gruppo' &&
      decoded !== 'Group' &&
      decoded !== 'Polilinea' &&
      decoded !== ' Raggruppa'
    ) {
      subject = decoded;
      break;
    }
    if (!subject && decoded) subject = decoded;
  }
  if (!subject) {
    const nmMatch = rawStr.match(/\/Contents\s*\(([^)]+)\)/);
    if (nmMatch) {
      const c = decodePdfString(nmMatch[1]);
      if (c && c !== 'XXX') subject = c;
    }
  }
  if (!subject) {
    subject = `${categoryTitle} #${index + 1}`;
  }

  const rawTokens = rawStr.split(/(?=<<\/)/g).filter((s) => s.includes('<<'));
  const subAnnots = rawTokens.length > 0 ? rawTokens : [rawStr];

  interface RawElement {
    kind: 'polyline' | 'polygon' | 'circle' | 'rect' | 'text';
    points: { x: number; y: number }[];
    closed?: boolean;
    rect?: [number, number, number, number];
    text?: string;
    fontSize?: number;
    strokeColor: string;
    fillColor?: string;
    strokeWidth: number;
    lineStyle?: 'solid' | 'dashed' | 'dotted';
    isTypeWriterLabel?: boolean;
  }

  const elements: RawElement[] = [];
  let mainStrokeColor = '#ef4444';
  let mainFillColor: string | undefined = undefined;
  let mainStrokeWidth = 1.5;
  const mainOpacity = parseOpacity(rawStr);

  for (const sub of subAnnots) {
    const elStroke =
      parsePdfColor(sub, '/C') ||
      parseHtmlHexColor(sub) ||
      parsePdfColor(rawStr, '/C') ||
      '#ef4444';
    const elFill = parsePdfColor(sub, '/IC');
    const elStrokeWidth = parseLineWidth(sub);
    const isDashed = /\/S\s*\/D\b/.test(sub) || /\/D\s*\[/.test(sub);

    // 1. Check for Form XObject appearance stream (/AP<</N/BBObjPtr_...>>)
    const apMatch = sub.match(/\/AP\s*<<[^>]*\/N\s*\/([A-Za-z0-9_]+)/);
    const rectMatch = sub.match(
      /\/Rect\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/
    );

    if (apMatch && formResources.has(apMatch[1])) {
      const res = formResources.get(apMatch[1])!;
      const targetRect: [number, number, number, number] = rectMatch
        ? [
            parseFloat(rectMatch[1]),
            parseFloat(rectMatch[2]),
            parseFloat(rectMatch[3]),
            parseFloat(rectMatch[4]),
          ]
        : res.bbox;

      const parsedForm = parseFormStreamToCompoundPaths(res, targetRect, elStroke, formResources);
      if (parsedForm.paths.length > 0) {
        mainStrokeColor = parsedForm.strokeColor;
        mainStrokeWidth = parsedForm.strokeWidth;
        for (const p of parsedForm.paths) {
          elements.push({
            kind: p.closed ? 'polygon' : 'polyline',
            points: p.points || [],
            closed: p.closed,
            strokeColor: p.strokeColor,
            fillColor: p.fillColor,
            strokeWidth: p.strokeWidth || 1.5,
            lineStyle: p.lineStyle === 'dashed' ? 'dashed' : 'solid',
          });
        }
        continue;
      }
    }

    // 2. Vertices (/Vertices[x1 y1 x2 y2 ...])
    const vertMatch = sub.match(/\/Vertices\s*\[\s*([-\d.\s]+)\s*\]/);
    if (vertMatch) {
      const nums = vertMatch[1]
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => !isNaN(n));
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        pts.push({ x: nums[i], y: nums[i + 1] });
      }
      if (pts.length >= 2) {
        const typeMatch = sub.match(/<Type>\s*([^<\s]+)\s*<\/Type>/);
        const tStr = typeMatch ? typeMatch[1] : '';
        // IMPORTANT: Never use Boolean(elFill) to decide if a PolyLine is a Polygon!
        // In Bluebeam, AnnotationPolyline has /IC[1 0 0] for line-ending fills, not interior polygon fill.
        const isPoly =
          tStr.includes('Polygon') ||
          sub.includes('/Subtype/Polygon') ||
          sub.includes('AnnotationPolygon');
        elements.push({
          kind: isPoly ? 'polygon' : 'polyline',
          points: pts,
          closed: isPoly,
          strokeColor: elStroke,
          fillColor: isPoly ? elFill : undefined,
          strokeWidth: elStrokeWidth || 1.5,
          lineStyle: isDashed ? 'dashed' : 'solid',
        });
        mainStrokeColor = elStroke;
        if (isPoly && elFill) mainFillColor = elFill;
        if (elStrokeWidth > 0) mainStrokeWidth = elStrokeWidth;
        continue;
      }
    }

    // 3. Line (/L[x1 y1 x2 y2])
    const lineMatch = sub.match(
      /\/L\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/
    );
    if (lineMatch) {
      elements.push({
        kind: 'polyline',
        points: [
          { x: parseFloat(lineMatch[1]), y: parseFloat(lineMatch[2]) },
          { x: parseFloat(lineMatch[3]), y: parseFloat(lineMatch[4]) },
        ],
        strokeColor: elStroke,
        strokeWidth: elStrokeWidth || 1.5,
        lineStyle: isDashed ? 'dashed' : 'solid',
      });
      mainStrokeColor = elStroke;
      continue;
    }

    // 4. Circle / Square / FreeText using /Rect[x1 y1 x2 y2]
    if (rectMatch) {
      const r: [number, number, number, number] = [
        parseFloat(rectMatch[1]),
        parseFloat(rectMatch[2]),
        parseFloat(rectMatch[3]),
        parseFloat(rectMatch[4]),
      ];
      if (
        sub.includes('/Circle') ||
        sub.includes('AnnotationCircle')
      ) {
        let rd: [number, number, number, number] = [0, 0, 0, 0];
        const rdMatch = sub.match(
          /\/RD\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/
        );
        if (rdMatch) {
          rd = [
            parseFloat(rdMatch[1]),
            parseFloat(rdMatch[2]),
            parseFloat(rdMatch[3]),
            parseFloat(rdMatch[4]),
          ];
        }
        const x1 = Math.min(r[0], r[2]) + rd[0];
        const y1 = Math.min(r[1], r[3]) + rd[1];
        const x2 = Math.max(r[0], r[2]) - rd[2];
        const y2 = Math.max(r[1], r[3]) - rd[3];
        elements.push({
          kind: 'circle',
          points: [],
          rect: [x1, y1, x2, y2],
          strokeColor: elStroke,
          fillColor: elFill,
          strokeWidth: elStrokeWidth || 1.5,
          lineStyle: isDashed ? 'dashed' : 'solid',
        });
        mainStrokeColor = elStroke;
        if (elFill) mainFillColor = elFill;
      } else if (sub.includes('/FreeText') || sub.includes('AnnotationFreeText')) {
        const contentsMatch = sub.match(/\/Contents\s*\(([^)]*)\)/);
        const textVal = contentsMatch ? decodePdfString(contentsMatch[1]) : '';
        const isTypeWriter = /FreeTextTypeWriter/i.test(sub);
        if (textVal) {
          elements.push({
            kind: 'text',
            points: [],
            rect: r,
            text: textVal,
            fontSize: isTypeWriter ? 6.5 : 8,
            strokeColor: elStroke,
            strokeWidth: elStrokeWidth,
            isTypeWriterLabel: isTypeWriter,
          });
        }
        // Only draw a box border for FreeTextCallout or when /W > 0 and non-TypeWriter
        if (sub.includes('FreeTextCallout') || (!isTypeWriter && elStrokeWidth > 0)) {
          elements.push({
            kind: 'rect',
            points: [],
            rect: r,
            strokeColor: elStroke,
            fillColor: elFill,
            strokeWidth: elStrokeWidth || 1,
          });
        }
      } else if (
        sub.includes('/Square') ||
        sub.includes('AnnotationSquare')
      ) {
        elements.push({
          kind: 'rect',
          points: [],
          rect: r,
          strokeColor: elStroke,
          fillColor: elFill,
          strokeWidth: elStrokeWidth || 1.5,
          lineStyle: isDashed ? 'dashed' : 'solid',
        });
        mainStrokeColor = elStroke;
        if (elFill) mainFillColor = elFill;
      }
    }
  }

  if (elements.length === 0) {
    return null;
  }

  // Compute overall bounding box from graphical elements first (excluding borderless TypeWriter labels)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const hasGraphicalElements = elements.some((el) => !el.isTypeWriterLabel);

  for (const el of elements) {
    if (hasGraphicalElements && el.isTypeWriterLabel) continue;
    for (const p of el.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (el.rect) {
      const [x1, y1, x2, y2] = el.rect;
      if (Math.min(x1, x2) < minX) minX = Math.min(x1, x2);
      if (Math.min(y1, y2) < minY) minY = Math.min(y1, y2);
      if (Math.max(x1, x2) > maxX) maxX = Math.max(x1, x2);
      if (Math.max(y1, y2) > maxY) maxY = Math.max(y1, y2);
    }
  }

  if (!isFinite(minX) || !isFinite(minY)) return null;

  const rawWidth = Math.max(1, maxX - minX);
  const rawHeight = Math.max(1, maxY - minY);
  const aspectRatio = Math.max(0.15, Math.min(6, rawWidth / rawHeight));

  // Normalize all subpaths into 0..1 space (flipping Y because PDF Y goes up while Canvas Y goes down)
  const compoundPaths: CompoundSubPath[] = [];
  const typeWriterEls = elements.filter((e) => e.isTypeWriterLabel);
  let typeWriterIdx = 0;

  for (const el of elements) {
    if (el.kind === 'polyline' || el.kind === 'polygon') {
      const isClosed = el.closed ?? el.kind === 'polygon';
      compoundPaths.push({
        type: isClosed ? 'polygon' : 'polyline',
        points: el.points.map((p) => ({
          x: (p.x - minX) / rawWidth,
          y: 1 - (p.y - minY) / rawHeight,
        })),
        closed: isClosed,
        strokeColor: el.strokeColor,
        fillColor: el.fillColor,
        strokeWidth: el.strokeWidth,
        lineStyle: el.lineStyle,
      });
    } else if (el.kind === 'circle' && el.rect) {
      const [x1, y1, x2, y2] = el.rect;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      compoundPaths.push({
        type: 'ellipse',
        ellipse: {
          cx: (cx - minX) / rawWidth,
          cy: 1 - (cy - minY) / rawHeight,
          rx: rx / rawWidth,
          ry: ry / rawHeight,
        },
        strokeColor: el.strokeColor,
        fillColor: el.fillColor,
        strokeWidth: el.strokeWidth,
        lineStyle: el.lineStyle,
      });
    } else if (el.kind === 'rect' && el.rect) {
      const [x1, y1, x2, y2] = el.rect;
      const pts = [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
        { x: x1, y: y2 },
      ];
      compoundPaths.push({
        type: 'polygon',
        points: pts.map((p) => ({
          x: (p.x - minX) / rawWidth,
          y: 1 - (p.y - minY) / rawHeight,
        })),
        closed: true,
        strokeColor: el.strokeColor,
        fillColor: el.fillColor,
        strokeWidth: el.strokeWidth,
        lineStyle: el.lineStyle,
      });
    } else if (el.kind === 'text' && el.rect && el.text) {
      if (el.isTypeWriterLabel && hasGraphicalElements) {
        const totalLabels = typeWriterEls.length;
        const ny =
          totalLabels >= 2
            ? typeWriterIdx === 0
              ? 0.24
              : 0.58
            : 0.42;
        typeWriterIdx++;
        compoundPaths.push({
          type: 'text',
          rect: { x: 0.25, y: ny, width: 0.5, height: 0.2 },
          strokeColor: el.strokeColor,
          strokeWidth: 1,
          text: el.text,
          fontSize: el.fontSize || 6.5,
        });
      } else {
        const [x1, y1, x2, y2] = el.rect;
        const rx = Math.max(0.05, (Math.min(x1, x2) - minX) / rawWidth);
        const ry = Math.max(0.05, 1 - (Math.max(y1, y2) - minY) / rawHeight);
        const rw = Math.max(0.1, Math.abs(x2 - x1) / rawWidth);
        const rh = Math.max(0.1, Math.abs(y2 - y1) / rawHeight);
        compoundPaths.push({
          type: 'text',
          rect: { x: rx, y: ry, width: rw, height: rh },
          strokeColor: el.strokeColor,
          strokeWidth: el.strokeWidth,
          text: el.text,
          fontSize: el.fontSize || 8,
        });
      }
    }
  }

  const scaleFactor = Math.max(1, 36 / Math.max(rawWidth, rawHeight));
  const defaultWidth = Math.round(rawWidth * scaleFactor);
  const defaultHeight = Math.round(rawHeight * scaleFactor);

  return {
    id: `btx-${categoryTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${index}`,
    name: subject,
    subject,
    category: categoryTitle,
    type: 'stamp_symbol',
    strokeColor: mainStrokeColor,
    fillColor: mainFillColor,
    strokeWidth: mainStrokeWidth,
    opacity: mainOpacity,
    compoundPaths,
    aspectRatio,
    defaultWidth: Math.max(24, Math.min(180, defaultWidth)),
    defaultHeight: Math.max(24, Math.min(180, defaultHeight)),
  };
}

/**
 * Parses a Bluebeam .btx file (ArrayBuffer or XML string) into a BtxToolSet.
 */
export function parseBtxFile(data: ArrayBuffer | string, fileName: string): BtxToolSet {
  let xmlText = '';
  if (typeof data === 'string') {
    xmlText = data;
  } else {
    const bytes = new Uint8Array(data);
    if (bytes.length >= 2 && bytes[0] === 0x78) {
      try {
        const inflated = pako.inflate(bytes);
        xmlText = new TextDecoder('utf-8').decode(inflated);
      } catch {
        xmlText = new TextDecoder('utf-8').decode(bytes);
      }
    } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      xmlText = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    } else {
      xmlText = new TextDecoder('utf-8').decode(bytes);
    }
  }

  const fallbackTitle = fileName.replace(/\.btx$/i, '');
  const titleMatch = xmlText.match(/<Title>([\s\S]*?)<\/Title>/i);
  const title = titleMatch ? decodeTitleIfNeeded(titleMatch[1], fallbackTitle) : fallbackTitle;

  const formResources = extractFormResources(xmlText);
  const tools: BtxSymbolTool[] = [];

  const itemBlocks: string[] = [];
  const toolChestItemRegex = /<ToolChestItem\b[^>]*>([\s\S]*?)<\/ToolChestItem>/gi;
  let m: RegExpExecArray | null;
  while ((m = toolChestItemRegex.exec(xmlText)) !== null) {
    itemBlocks.push(m[1]);
  }

  if (itemBlocks.length === 0) {
    const childRegex = /<Child\b[^>]*>([\s\S]*?)<\/Child>/gi;
    while ((m = childRegex.exec(xmlText)) !== null) {
      itemBlocks.push(m[1]);
    }
  }

  for (let idx = 0; idx < itemBlocks.length; idx++) {
    const itemBody = itemBlocks[idx];
    const rawMatch = itemBody.match(/<Raw>([\s\S]*?)<\/Raw>/i);
    let rawContent = '';

    if (rawMatch) {
      const rawText = rawMatch[1].trim();
      if (rawText.startsWith('<<') || rawText.includes('/Subj')) {
        rawContent = rawText;
      } else {
        const decompressed = tryDecompressHex(rawText);
        if (decompressed) {
          rawContent = decompressed;
        }
      }
    }

    const typeMatch = itemBody.match(/<Type>([\s\S]*?)<\/Type>/i);
    if (typeMatch) {
      const typeName = decodeTitleIfNeeded(typeMatch[1], '');
      if (typeName) {
        rawContent = `<Type>${typeName}</Type>\n` + rawContent;
      }
    }

    const subRawRegex = /<Raw>([\s\S]*?)<\/Raw>/gi;
    let sm: RegExpExecArray | null;
    const allSubRaws: string[] = [];
    while ((sm = subRawRegex.exec(itemBody)) !== null) {
      const candidate = sm[1].trim();
      const dec = candidate.startsWith('<<') ? candidate : tryDecompressHex(candidate);
      if (dec) {
        const startOffset = sm.index;
        const preceding = itemBody.slice(Math.max(0, startOffset - 220), startOffset);
        const xm = preceding.match(/<X>\s*([-\d.]+)\s*<\/X>/i);
        const ym = preceding.match(/<Y>\s*([-\d.]+)\s*<\/Y>/i);
        let modifiedDec = dec;
        if (xm && ym) {
          const dx = parseFloat(xm[1]);
          const dy = parseFloat(ym[1]);
          if (!isNaN(dx) && !isNaN(dy) && (dx !== 0 || dy !== 0)) {
            modifiedDec = modifiedDec.replace(
              /\/Rect\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g,
              (_, x1, y1, x2, y2) =>
                `/Rect[${parseFloat(x1) + dx} ${parseFloat(y1) - dy} ${parseFloat(x2) + dx} ${parseFloat(y2) - dy}]`
            );
          }
        }
        allSubRaws.push(modifiedDec);
      }
    }
    if (allSubRaws.length > 1) {
      rawContent = allSubRaws.join('\n');
    }

    if (!rawContent) continue;

    const parsedTool = parseAnnotationGeometry(rawContent, idx, title, formResources);
    if (parsedTool) {
      tools.push(parsedTool);
    }
  }

  return {
    id: `btx-set-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    fileName,
    tools,
  };
}

export async function loadBtxFromUrl(url: string, fileName: string): Promise<BtxToolSet> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Impossibile caricare ${fileName}: HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  return parseBtxFile(buf, fileName);
}

/**
 * Exports a toolset back to a Bluebeam-compatible .btx XML string
 */
export function exportBtxFile(toolSet: BtxToolSet): string {
  const itemsXml = toolSet.tools
    .map((tool) => {
      const w = tool.defaultWidth || 50;
      const h = tool.defaultHeight || 50;
      const subDicts = tool.compoundPaths
        .map((sp) => {
          if ((sp.type === 'ellipse' || sp.type === 'circle') && sp.ellipse) {
            const { cx, cy, rx, ry } = sp.ellipse;
            const x1 = ((cx - rx) * w).toFixed(2);
            const y1 = ((1 - cy - ry) * h).toFixed(2);
            const x2 = ((cx + rx) * w).toFixed(2);
            const y2 = ((1 - cy + ry) * h).toFixed(2);
            return `<</Subtype/Circle/Subj(${tool.subject})/Rect[${x1} ${y1} ${x2} ${y2}]/BS<</W ${sp.strokeWidth || 1.5}/S/S>>>>`;
          }
          const verts = (sp.points || [])
            .map((p: Point2D) => `${(p.x * w).toFixed(2)} ${((1 - p.y) * h).toFixed(2)}`)
            .join(' ');
          const subtype = sp.type === 'polygon' || sp.closed ? 'Polygon' : 'PolyLine';
          return `<</Subtype/${subtype}/Subj(${tool.subject})/Vertices[${verts}]/BS<</W ${sp.strokeWidth || 1.5}/S/S>>>>`;
        })
        .join('\n');

      return `  <ToolChestItem>
    <Type>${tool.type === 'polygon' ? 'AnnotationPolygon' : 'AnnotationGroup'}</Type>
    <Raw>${subDicts}</Raw>
  </ToolChestItem>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<BluebeamToolChest version="1">
  <Title>${toolSet.title}</Title>
${itemsXml}
</BluebeamToolChest>`;
}

export interface BTXToolSet {
  id?: string;
  title: string;
  items: AnyMarkup[];
}

export function symbolToolToMarkup(tool: BtxSymbolTool): PolylineMarkup {
  const w = tool.defaultWidth || 40;
  const h = tool.defaultHeight || 40;
  const scaledPaths = tool.compoundPaths.map((cp) => {
    const copy: CompoundSubPath = { ...cp };
    if (cp.points) {
      copy.points = cp.points.map((p) => ({ x: p.x * w, y: p.y * h }));
    }
    if (cp.ellipse) {
      copy.ellipse = {
        cx: cp.ellipse.cx * w,
        cy: cp.ellipse.cy * h,
        rx: cp.ellipse.rx * w,
        ry: cp.ellipse.ry * h,
      };
    }
    if (cp.rect) {
      copy.rect = {
        x: cp.rect.x * w,
        y: cp.rect.y * h,
        width: cp.rect.width * w,
        height: cp.rect.height * h,
      };
    }
    if (cp.type === 'text' && cp.fontSize && cp.fontSize < 1) {
      copy.fontSize = Math.max(3, cp.fontSize * h);
    }
    return copy;
  });
  return {
    id: tool.id,
    type: 'polyline',
    pageIndex: 0,
    author: 'Bluebeam BTX',
    subject: tool.subject || tool.name,
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: tool.strokeColor || '#ef4444',
    fillColor: tool.fillColor,
    strokeWidth: tool.strokeWidth || 1.5,
    lineStyle: tool.lineStyle || 'solid',
    opacity: tool.opacity ?? 1,
    isSymbol: true,
    isGroup: true,
    boxRect: { x: 0, y: 0, width: w, height: h },
    points: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    compoundPaths: scaledPaths,
  };
}

export class BTXParser {
  static parse(data: Uint8Array | ArrayBuffer | string, fileName: string): BTXToolSet {
    let input: string | ArrayBuffer;
    if (typeof data === 'string') {
      input = data;
    } else if (data instanceof Uint8Array) {
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      input = copy.buffer;
    } else {
      input = data;
    }
    const parsed = parseBtxFile(input, fileName);
    return {
      id: parsed.id,
      title: parsed.title,
      items: parsed.tools.map(symbolToolToMarkup),
    };
  }

  static markupToSymbolTool(markup: AnyMarkup, customName?: string): AnyMarkup {
    const cloned = JSON.parse(JSON.stringify(markup)) as AnyMarkup;
    cloned.id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sym-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (customName && customName.trim()) {
      cloned.subject = customName.trim();
    }
    if (
      cloned.type !== 'textbox' &&
      cloned.type !== 'callout' &&
      cloned.contents &&
      cloned.subject &&
      cloned.contents.trim() === cloned.subject.trim()
    ) {
      cloned.contents = '';
    }
    cloned.isSymbol = true;
    return cloned;
  }

  static exportToolSetToBTX(toolSet: BTXToolSet): Uint8Array<ArrayBuffer> {
    const converted: BtxToolSet = {
      id: toolSet.id || `btx-${Date.now()}`,
      title: toolSet.title,
      fileName: `${toolSet.title}.btx`,
      tools: toolSet.items.map((item, idx) => ({
        id: item.id || `tool-${idx}`,
        name: item.subject || `Simbolo ${idx + 1}`,
        subject: item.subject || `Simbolo ${idx + 1}`,
        category: toolSet.title,
        type: 'stamp_symbol',
        strokeColor: item.strokeColor || '#ef4444',
        fillColor: item.fillColor,
        strokeWidth: item.strokeWidth || 1.5,
        opacity: item.opacity ?? 1,
        compoundPaths: (item.compoundPaths || []) as CompoundSubPath[],
        aspectRatio: 1,
        defaultWidth: ('boxRect' in item && item.boxRect?.width) || 40,
        defaultHeight: ('boxRect' in item && item.boxRect?.height) || 40,
      })),
    };
    const encoded = new TextEncoder().encode(exportBtxFile(converted));
    const out = new Uint8Array(new ArrayBuffer(encoded.byteLength));
    out.set(encoded);
    return out;
  }

  static createSampleArchitectureSet(): BTXToolSet {
    return {
      id: `btx-arch-${Date.now()}`,
      title: 'Architettura & Impianti',
      items: [
        {
          id: 'arch-valve-sample',
          type: 'polyline',
          pageIndex: 0,
          author: 'OpenRevu',
          subject: 'Valvola Gate',
          contents: '',
          creationDate: '',
          modificationDate: '',
          status: 'None',
          strokeColor: '#ef4444',
          strokeWidth: 1.5,
          opacity: 1,
          isSymbol: true,
          isGroup: true,
          boxRect: { x: 0, y: 0, width: 40, height: 28 },
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 28 },
            { x: 0, y: 28 },
          ],
          compoundPaths: [
            {
              type: 'polygon',
              points: [
                { x: 0.1, y: 0.2 },
                { x: 0.9, y: 0.8 },
                { x: 0.9, y: 0.2 },
                { x: 0.1, y: 0.8 },
              ],
              strokeColor: '#ef4444',
              strokeWidth: 1.5,
            },
          ],
        },
      ],
    };
  }
}
