import { Point2D } from '@/types/markup';

export type RecognizedShape =
  | { kind: 'line'; startPoint: Point2D; endPoint: Point2D }
  | { kind: 'circle'; boxRect: { x: number; y: number; width: number; height: number } }
  | { kind: 'rectangle'; boxRect: { x: number; y: number; width: number; height: number }; isSquare: boolean }
  | { kind: 'triangle'; points: Point2D[] };

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function ramerDouglasPeucker(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = ramerDouglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = ramerDouglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function getBoundingBox(points: Point2D[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Riconosce automaticamente linee dritte, cerchi/ellissi, triangoli e quadrati/rettangoli
 * da un tratto a mano libera disegnato con la penna o con il dito.
 */
export function recognizeFreehandShape(rawPoints: Point2D[]): RecognizedShape | null {
  if (rawPoints.length < 4) return null;

  const box = getBoundingBox(rawPoints);
  const diag = Math.hypot(box.width, box.height);
  if (diag < 16) return null;

  const start = rawPoints[0];
  const end = rawPoints[rawPoints.length - 1];
  const endToEnd = dist(start, end);

  // Calcola lunghezza totale del percorso
  let pathLen = 0;
  for (let i = 1; i < rawPoints.length; i++) {
    pathLen += dist(rawPoints[i - 1], rawPoints[i]);
  }

  // 1. LINEA DRITTA: tratto aperto dove i punti stanno vicini alla retta start->end
  if (endToEnd >= 16 && pathLen <= endToEnd * 1.18) {
    let maxDev = 0;
    for (const p of rawPoints) {
      const d = pointToSegmentDistance(p, start, end);
      if (d > maxDev) maxDev = d;
    }
    if (maxDev <= Math.max(6, endToEnd * 0.08)) {
      return { kind: 'line', startPoint: start, endPoint: end };
    }
  }

  // 2. FORME CHIUSE (Cerchio, Triangolo, Quadrato/Rettangolo)
  const isClosed = endToEnd <= Math.max(24, diag * 0.32);
  if (!isClosed || rawPoints.length < 8) return null;

  // Test CERCHIO / ELLISSE tramite uniformità dei raggi normalizzati sul bounding box
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = box.width / 2;
  const ry = box.height / 2;
  if (rx > 6 && ry > 6) {
    const normRadii = rawPoints.map((p) => Math.hypot((p.x - cx) / rx, (p.y - cy) / ry));
    const meanR = normRadii.reduce((a, b) => a + b, 0) / normRadii.length;
    const variance = normRadii.reduce((a, r) => a + (r - meanR) ** 2, 0) / normRadii.length;
    const stdR = Math.sqrt(variance);
    if (stdR / Math.max(0.1, meanR) < 0.16 && Math.abs(meanR - 1) < 0.22) {
      const aspect = box.width / box.height;
      if (aspect >= 0.78 && aspect <= 1.28) {
        const size = (box.width + box.height) / 2;
        return {
          kind: 'circle',
          boxRect: { x: cx - size / 2, y: cy - size / 2, width: size, height: size },
        };
      }
      return { kind: 'circle', boxRect: box };
    }
  }

  // Semplificazione poligonale Ramer-Douglas-Peucker su percorso chiuso
  const closedPts = [...rawPoints, rawPoints[0]];
  const simplified = ramerDouglasPeucker(closedPts, Math.max(7, diag * 0.065));
  // Rimuovi l'ultimo vertice duplicato di chiusura
  const vertices =
    simplified.length > 1 && dist(simplified[0], simplified[simplified.length - 1]) < Math.max(12, diag * 0.12)
      ? simplified.slice(0, -1)
      : simplified;

  // 3. TRIANGOLO (3 vertici netti)
  if (vertices.length === 3) {
    return { kind: 'triangle', points: vertices };
  }

  // 4. QUADRATO / RETTANGOLO (4 vertici con angoli vicini a 90°)
  if (vertices.length === 4) {
    let allRightish = true;
    for (let i = 0; i < 4; i++) {
      const prev = vertices[(i + 3) % 4];
      const curr = vertices[i];
      const next = vertices[(i + 1) % 4];
      const v1x = prev.x - curr.x;
      const v1y = prev.y - curr.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 < 8 || l2 < 8) {
        allRightish = false;
        break;
      }
      const cosA = Math.abs((v1x * v2x + v1y * v2y) / (l1 * l2));
      if (cosA > 0.45) {
        // Oltre ~26° di errore da 90°
        allRightish = false;
        break;
      }
    }
    if (allRightish) {
      const aspect = box.width / box.height;
      const isSquare = aspect >= 0.8 && aspect <= 1.25;
      if (isSquare) {
        const size = (box.width + box.height) / 2;
        return {
          kind: 'rectangle',
          boxRect: { x: cx - size / 2, y: cy - size / 2, width: size, height: size },
          isSquare: true,
        };
      }
      return { kind: 'rectangle', boxRect: box, isSquare: false };
    }
  }

  return null;
}
