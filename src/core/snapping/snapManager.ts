import { Point2D, AnyMarkup } from '@/types/markup';

export type SnapType = 'endpoint' | 'midpoint' | 'center';

export interface SnapTarget {
  point: Point2D;
  type: SnapType;
  label: string;
}

export interface SnapResult {
  point: Point2D;
  target: SnapTarget;
}

export class SnapManager {
  private static readonly SNAP_TOLERANCE = 14; // Raggio di cattura magnetica in pixel a schermo

  /**
   * Estrae i punti notevoli di un rettangolo / box (4 vertici, 4 punti medi, 1 centro)
   */
  public static extractBoxTargets(
    b: { x: number; y: number; width: number; height: number },
    targets: SnapTarget[]
  ) {
    const topLeft = { x: b.x, y: b.y };
    const topRight = { x: b.x + b.width, y: b.y };
    const bottomRight = { x: b.x + b.width, y: b.y + b.height };
    const bottomLeft = { x: b.x, y: b.y + b.height };

    targets.push({ point: topLeft, type: 'endpoint', label: 'Vertice' });
    targets.push({ point: topRight, type: 'endpoint', label: 'Vertice' });
    targets.push({ point: bottomRight, type: 'endpoint', label: 'Vertice' });
    targets.push({ point: bottomLeft, type: 'endpoint', label: 'Vertice' });

    // Punti medi dei 4 lati
    targets.push({
      point: { x: b.x + b.width / 2, y: b.y },
      type: 'midpoint',
      label: 'Punto Medio',
    });
    targets.push({
      point: { x: b.x + b.width, y: b.y + b.height / 2 },
      type: 'midpoint',
      label: 'Punto Medio',
    });
    targets.push({
      point: { x: b.x + b.width / 2, y: b.y + b.height },
      type: 'midpoint',
      label: 'Punto Medio',
    });
    targets.push({
      point: { x: b.x, y: b.y + b.height / 2 },
      type: 'midpoint',
      label: 'Punto Medio',
    });

    // Centro box
    targets.push({
      point: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      type: 'center',
      label: 'Centro',
    });
  }

  /**
   * Estrae i punti notevoli da una serie di punti poligonali (vertici e punti medi)
   */
  public static extractPolygonTargets(
    pts: Point2D[],
    isClosed: boolean,
    targets: SnapTarget[]
  ) {
    const count = pts.length;
    for (let i = 0; i < count; i++) {
      targets.push({ point: pts[i], type: 'endpoint', label: 'Vertice' });

      if (i < count - 1 || isClosed) {
        const nextPt = pts[(i + 1) % count];
        targets.push({
          point: { x: (pts[i].x + nextPt.x) / 2, y: (pts[i].y + nextPt.y) / 2 },
          type: 'midpoint',
          label: 'Punto Medio',
        });
      }
    }
  }

  /**
   * Estrae tutti i punti notevoli (inizio, centro/punto medio, fine, vertici)
   * da tutti i markup presenti sulla pagina (Linee, Rettangoli, Poligoni, Nuvolette, Callout, Cloud+)
   */
  public static extractSnapTargets(markups: AnyMarkup[], pageIndex: number): SnapTarget[] {
    const targets: SnapTarget[] = [];
    const pageMarkups = markups.filter((m) => m.pageIndex === pageIndex);

    for (const m of pageMarkups) {
      if (m.type === 'callout') {
        const cm = m as any;
        if (cm.arrowPoint) {
          targets.push({ point: cm.arrowPoint, type: 'endpoint', label: 'Punta Freccia' });
        }
        if (cm.elbowPoint) {
          targets.push({ point: cm.elbowPoint, type: 'endpoint', label: 'Gomito' });
        }
        if (cm.boxRect) {
          this.extractBoxTargets(cm.boxRect, targets);
        }
      } else if (m.type === 'cloud_plus') {
        const cpm = m as any;
        if (cpm.leaderPoint) {
          targets.push({ point: cpm.leaderPoint, type: 'endpoint', label: 'Ancoraggio' });
        }
        if (cpm.cloudPoints && Array.isArray(cpm.cloudPoints)) {
          this.extractPolygonTargets(cpm.cloudPoints, true, targets);
        }
        if (cpm.boxRect) {
          this.extractBoxTargets(cpm.boxRect, targets);
        }
      } else if (m.type === 'line' || m.type === 'arrow' || m.type === 'measure_length') {
        const lm = m as any;
        const p1: Point2D = lm.startPoint;
        const p2: Point2D = lm.endPoint;

        targets.push({ point: p1, type: 'endpoint', label: 'Inizio' });
        targets.push({ point: p2, type: 'endpoint', label: 'Fine' });
        targets.push({
          point: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
          type: 'midpoint',
          label: 'Punto Medio',
        });
      } else if ('points' in m && Array.isArray((m as any).points)) {
        const pts: Point2D[] = (m as any).points;
        const isClosed =
          m.type === 'polygon' ||
          m.type === 'cloud' ||
          m.type === 'cloud_rect' ||
          m.type === 'measure_area' ||
          m.type === 'measure_area_rect';
        this.extractPolygonTargets(pts, isClosed, targets);
      } else if ('boxRect' in m) {
        this.extractBoxTargets((m as any).boxRect, targets);
      }
    }

    return targets;
  }

  /**
   * Cerca il punto notevole più vicino al cursore entro la tolleranza
   */
  public static findSnap(
    cursorPt: Point2D,
    targets: SnapTarget[],
    zoom: number
  ): SnapResult | null {
    const tolerance = this.SNAP_TOLERANCE / zoom;
    let closestTarget: SnapTarget | null = null;
    let minDist = tolerance;

    for (const t of targets) {
      const dist = Math.hypot(t.point.x - cursorPt.x, t.point.y - cursorPt.y);
      if (dist < minDist) {
        minDist = dist;
        closestTarget = t;
      }
    }

    if (closestTarget) {
      return {
        point: { x: closestTarget.point.x, y: closestTarget.point.y },
        target: closestTarget,
      };
    }

    return null;
  }

  /**
   * Cerca uno snap magnetico per lo spostamento (Move) di entità già disegnate.
   * Controlla se uno dei punti notevoli delle entità in movimento si avvicina
   * a un punto notevole stazionario (endpoint, midpoint, center).
   */
  public static findSnapForTranslation(
    movingKeyPoints: SnapTarget[],
    currentDx: number,
    currentDy: number,
    stationaryTargets: SnapTarget[],
    zoom: number
  ): { deltaX: number; deltaY: number; target: SnapTarget } | null {
    const tolerance = this.SNAP_TOLERANCE / zoom;
    let bestDist = tolerance;
    let bestAdjustment: { deltaX: number; deltaY: number; target: SnapTarget } | null = null;

    for (const kp of movingKeyPoints) {
      const movedX = kp.point.x + currentDx;
      const movedY = kp.point.y + currentDy;

      for (const st of stationaryTargets) {
        const dist = Math.hypot(st.point.x - movedX, st.point.y - movedY);
        if (dist < bestDist) {
          bestDist = dist;
          bestAdjustment = {
            deltaX: currentDx + (st.point.x - movedX),
            deltaY: currentDy + (st.point.y - movedY),
            target: st,
          };
        }
      }
    }

    return bestAdjustment;
  }

  /**
   * Disegna l'icona di Snap stile Bluebeam/AutoCAD sul canvas:
   * - Endpoint (Inizio/Fine/Vertice): Quadratino verde
   * - Midpoint (Punto Medio): Triangolino ciano
   * - Center (Centro): Cerchietto con croce
   */
  public static drawSnapMarker(
    ctx: CanvasRenderingContext2D,
    target: SnapTarget,
    zoom: number = 1.0
  ) {
    const { x, y } = target.point;
    const safeZoom = Math.max(0.15, zoom);
    const invZoom = 1 / safeZoom;

    // Disegna in coordinate schermo costanti (pixel fissi) così lo Snap non diventa mai gigante ad alto zoom
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(invZoom, invZoom);

    const size = 6.5;
    ctx.lineWidth = 1.6;

    if (target.type === 'endpoint') {
      // Quadratino verde fluo stile Bluebeam CAD
      ctx.strokeStyle = '#00ff66';
      ctx.fillStyle = 'rgba(0, 255, 102, 0.25)';
      ctx.strokeRect(-size, -size, size * 2, size * 2);
      ctx.fillRect(-size, -size, size * 2, size * 2);
    } else if (target.type === 'midpoint') {
      // Triangolino ciano
      ctx.strokeStyle = '#00e5ff';
      ctx.fillStyle = 'rgba(0, 229, 255, 0.25)';
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.15);
      ctx.lineTo(size * 1.1, size * 0.9);
      ctx.lineTo(-size * 1.1, size * 0.9);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    } else if (target.type === 'center') {
      // Cerchio con croce
      ctx.strokeStyle = '#ffbb00';
      ctx.fillStyle = 'rgba(255, 187, 0, 0.25)';
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-size * 1.3, 0);
      ctx.lineTo(size * 1.3, 0);
      ctx.moveTo(0, -size * 1.3);
      ctx.lineTo(0, size * 1.3);
      ctx.stroke();
    }

    // Badge con etichetta a dimensione costante in pixel schermo
    const fontSize = 11;
    ctx.font = `bold ${fontSize}px Segoe UI, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const text = target.label;
    const paddingX = 5;
    const badgeHeight = 17;
    const metrics = ctx.measureText(text);
    const badgeWidth = metrics.width + paddingX * 2;
    const badgeX = size + 6;
    const badgeY = -badgeHeight / 2;

    ctx.fillStyle = 'rgba(15, 15, 17, 0.92)';
    ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
    ctx.strokeStyle = target.type === 'endpoint' ? '#00ff66' : target.type === 'midpoint' ? '#00e5ff' : '#ffbb00';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(badgeX, badgeY, badgeWidth, badgeHeight);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, badgeX + paddingX, 0);

    ctx.restore();
  }
}
