import { Point2D, HatchPattern } from '@/types/markup';
import { HatchRenderer } from './hatchRenderer';

export interface ArcSegment {
  p1: Point2D;
  controlPoint: Point2D;
  p2: Point2D;
}

export class CloudGenerator {
  /**
   * Genera una serie di archi convessi attorno a un poligono (stile Bluebeam Revu / AutoCAD)
   * @param polygonPoints Vertici del poligono chiuso (in senso orario o antiorario)
   * @param targetArcLength Lunghezza desiderata per ogni archetto (default 24 pt)
   */
  public static generateCloudArcs(
    polygonPoints: Point2D[],
    targetArcLength: number = 24
  ): ArcSegment[] {
    if (polygonPoints.length < 3) return [];

    // Determina l'orientamento del poligono (orario vs antiorario)
    const isClockwise = this.isPolygonClockwise(polygonPoints);

    const arcs: ArcSegment[] = [];
    const n = polygonPoints.length;

    for (let i = 0; i < n; i++) {
      const pA = polygonPoints[i];
      const pB = polygonPoints[(i + 1) % n];

      const dx = pB.x - pA.x;
      const dy = pB.y - pA.y;
      const segLength = Math.hypot(dx, dy);

      if (segLength < 1) continue;

      // Quanti archetti inserire in questo segmento
      const numArcs = Math.max(1, Math.round(segLength / targetArcLength));
      const stepX = dx / numArcs;
      const stepY = dy / numArcs;

      for (let j = 0; j < numArcs; j++) {
        const startX = pA.x + stepX * j;
        const startY = pA.y + stepY * j;
        const endX = pA.x + stepX * (j + 1);
        const endY = pA.y + stepY * (j + 1);

        const subDx = endX - startX;
        const subDy = endY - startY;
        const subLen = Math.hypot(subDx, subDy);

        // Vettore normale perpendicolare verso l'esterno
        // Per poligoni orari, il vettore normale verso l'esterno è (-dy, dx)
        let nx = -subDy / subLen;
        let ny = subDx / subLen;

        if (!isClockwise) {
          nx = -nx;
          ny = -ny;
        }

        // Altezza della convessità (archetto bombato)
        const bulgeHeight = subLen * 0.55;

        // Punto medio
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;

        // Punto di controllo della curva di Bézier quadratica
        const cpX = midX + nx * bulgeHeight;
        const cpY = midY + ny * bulgeHeight;

        arcs.push({
          p1: { x: startX, y: startY },
          controlPoint: { x: cpX, y: cpY },
          p2: { x: endX, y: endY },
        });
      }
    }

    return arcs;
  }

  /**
   * Disegna la nuvoletta su un Canvas 2D
   */
  public static drawCloudOnCanvas(
    ctx: CanvasRenderingContext2D,
    arcs: ArcSegment[],
    strokeColor: string,
    strokeWidth: number,
    fillColor?: string,
    opacity: number = 1,
    fillOpacity: number = 0.2,
    hatchPattern?: HatchPattern,
    hatchColor?: string,
    hatchScale?: number
  ) {
    if (arcs.length === 0) return;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const buildPath = () => {
      ctx.beginPath();
      ctx.moveTo(arcs[0].p1.x, arcs[0].p1.y);
      for (let i = 0; i < arcs.length; i++) {
        const arc = arcs[i];
        ctx.quadraticCurveTo(
          arc.controlPoint.x,
          arc.controlPoint.y,
          arc.p2.x,
          arc.p2.y
        );
      }
      ctx.closePath();
    };

    // 1. Colore di riempimento pieno
    if (fillColor && fillColor !== 'transparent') {
      ctx.save();
      buildPath();
      ctx.globalAlpha = fillOpacity;
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.restore();
    }

    // 2. Retino / Campitura tecnica per la nuvoletta con ritaglio pulito
    if (hatchPattern && hatchPattern !== 'none' && hatchPattern !== 'solid') {
      ctx.save();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const a of arcs) {
        minX = Math.min(minX, a.p1.x, a.p2.x, a.controlPoint.x);
        minY = Math.min(minY, a.p1.y, a.p2.y, a.controlPoint.y);
        maxX = Math.max(maxX, a.p1.x, a.p2.x, a.controlPoint.x);
        maxY = Math.max(maxY, a.p1.y, a.p2.y, a.controlPoint.y);
      }
      const bounds = { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
      buildPath();
      ctx.clip();
      HatchRenderer.renderHatch(
        ctx,
        hatchPattern,
        bounds,
        hatchColor || strokeColor,
        hatchScale || 1,
        fillOpacity || 0.5
      );
      ctx.restore();
    }

    // 3. Tracciamento bordo a nuvoletta (solo se spessore > 0, colore non trasparente e opacità > 0)
    if (strokeWidth > 0 && strokeColor && strokeColor !== 'transparent' && opacity > 0) {
      buildPath();
      ctx.stroke();
    }
    ctx.restore();
  }

  private static isPolygonClockwise(points: Point2D[]): boolean {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      sum += (p2.x - p1.x) * (p2.y + p1.y);
    }
    return sum > 0;
  }
}
