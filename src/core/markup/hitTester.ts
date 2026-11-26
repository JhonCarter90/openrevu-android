import { Point2D, AnyMarkup, CalloutMarkup, CloudPlusMarkup } from '@/types/markup';
import { MarkupRenderer } from './markupRenderer';

export interface HandleHit {
  markupId: string;
  handleIndex: number;
  handleType: 'vertex' | 'start' | 'end' | 'arrow' | 'elbow' | 'rect_corner' | 'rect_edge' | 'dim_offset' | 'rotate';
  point: Point2D;
}

export class HitTester {
  /**
   * Distanza minima tra un punto P e un segmento AB
   */
  public static distanceToSegment(p: Point2D, a: Point2D, b: Point2D): number {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = a.x + t * (b.x - a.x);
    const projY = a.y + t * (b.y - a.y);
    return Math.hypot(p.x - projX, p.y - projY);
  }

  /**
   * Verifica se un punto cade all'interno di un poligono (Ray Casting)
   */
  public static isPointInPolygon(p: Point2D, points: Point2D[]): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Hit-testing generale di un markup
   */
  public static hitTestMarkup(p: Point2D, m: AnyMarkup, tolerance: number = 8): boolean {
    if (m.type === 'cloud_plus') {
      const cpm = m as any;
      const b = cpm.boxRect;
      // 1. Box testo
      if (b && p.x >= b.x - tolerance && p.x <= b.x + b.width + tolerance &&
               p.y >= b.y - tolerance && p.y <= b.y + b.height + tolerance) {
        return true;
      }
      // 2. Nuvoletta (poligono o contorno)
      if (cpm.cloudPoints && cpm.cloudPoints.length >= 3) {
        if (this.isPointInPolygon(p, cpm.cloudPoints)) return true;
        for (let i = 0; i < cpm.cloudPoints.length; i++) {
          const next = cpm.cloudPoints[(i + 1) % cpm.cloudPoints.length];
          if (this.distanceToSegment(p, cpm.cloudPoints[i], next) <= tolerance + 6) return true;
        }
      }
      // 3. Linea direttrice
      if (cpm.leaderPoint && b) {
        const boxCenterX = b.x + b.width / 2;
        const boxCenterY = b.y + b.height / 2;
        const targetX = boxCenterX >= cpm.leaderPoint.x ? b.x : b.x + b.width;
        const elbowX = boxCenterX >= cpm.leaderPoint.x ? Math.max(cpm.leaderPoint.x, b.x - 16) : Math.min(cpm.leaderPoint.x, b.x + b.width + 16);
        const elbowY = boxCenterY;
        if (this.distanceToSegment(p, cpm.leaderPoint, { x: elbowX, y: elbowY }) <= tolerance) return true;
        if (this.distanceToSegment(p, { x: elbowX, y: elbowY }, { x: targetX, y: elbowY }) <= tolerance) return true;
      }
      return false;
    }

    if ('boxRect' in m && (m as any).boxRect) {
      const b = (m as any).boxRect;
      const rotDeg = (m as any).rotation || 0;
      let tp = p;
      if (rotDeg) {
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const rad = (-rotDeg * Math.PI) / 180;
        const dx = p.x - cx;
        const dy = p.y - cy;
        tp = {
          x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
          y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
        };
      }
      // Per forme con riempimento o box di testo, cliccare dentro seleziona
      const inside = tp.x >= b.x - tolerance && tp.x <= b.x + b.width + tolerance &&
                     tp.y >= b.y - tolerance && tp.y <= b.y + b.height + tolerance;
      if (inside) return true;

      // Se è un callout, controlla anche tutte le linee direttrici verso le frecce
      if (m.type === 'callout') {
        const cm = m as CalloutMarkup;
        const { targetX, targetY, elbowX, elbowY, arrows } = MarkupRenderer.getCalloutGeometry(cm);
        if (this.distanceToSegment(p, { x: targetX, y: targetY }, { x: elbowX, y: elbowY }) <= tolerance) {
          return true;
        }
        for (const tip of arrows) {
          if (this.distanceToSegment(p, { x: elbowX, y: elbowY }, tip) <= tolerance) {
            return true;
          }
        }
      }
    }

    if (m.type === 'measure_length') {
      const ml = m as any;
      if (!ml.startPoint || !ml.endPoint) return false;
      const p1 = ml.startPoint;
      const p2 = ml.endPoint;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const nx = -dy / len;
        const ny = dx / len;
        const offset = ml.extensionOffset !== undefined ? ml.extensionOffset : 24;
        const dim1 = { x: p1.x + nx * offset, y: p1.y + ny * offset };
        const dim2 = { x: p2.x + nx * offset, y: p2.y + ny * offset };
        const dimMid = { x: (dim1.x + dim2.x) / 2, y: (dim1.y + dim2.y) / 2 };
        if (Math.hypot(p.x - dimMid.x, p.y - dimMid.y) <= tolerance + 20) return true;
        if (this.distanceToSegment(p, dim1, dim2) <= tolerance + 6) return true;
        if (this.distanceToSegment(p, p1, dim1) <= tolerance + 4) return true;
        if (this.distanceToSegment(p, p2, dim2) <= tolerance + 4) return true;
        if (this.distanceToSegment(p, p1, p2) <= tolerance + 4) return true;
        return false;
      }
    }

    if ('startPoint' in m && 'endPoint' in m && (m as any).startPoint && (m as any).endPoint) {
      const lm = m as any;
      if (this.distanceToSegment(p, lm.startPoint, lm.endPoint) <= tolerance) {
        return true;
      }
    }

    if (m.compoundPaths && m.compoundPaths.length > 0) {
      const b = this.getMarkupBoundingBox(m);
      if (b) {
        if (
          p.x >= b.x - tolerance &&
          p.x <= b.x + b.width + tolerance &&
          p.y >= b.y - tolerance &&
          p.y <= b.y + b.height + tolerance
        ) {
          return true;
        }
      }
    }

    if ('points' in m && Array.isArray((m as any).points)) {
      const pts: Point2D[] = (m as any).points;
      const isClosed = m.type === 'polygon' || m.type === 'cloud' || m.type === 'cloud_rect' || m.type === 'measure_area' || m.type === 'measure_area_rect';

      if (isClosed && this.isPointInPolygon(p, pts)) {
        return true;
      }

      for (let i = 0; i < pts.length; i++) {
        if (i < pts.length - 1 || isClosed) {
          const next = pts[(i + 1) % pts.length];
          if (this.distanceToSegment(p, pts[i], next) <= tolerance + 4) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Calcola il bounding box unificato di qualsiasi markup o simbolo composto
   */
  public static getMarkupBoundingBox(
    m: AnyMarkup
  ): { x: number; y: number; width: number; height: number } | null {
    if (m.boxRect && m.boxRect.width > 0 && m.boxRect.height > 0) {
      const x = Math.min(m.boxRect.x, m.boxRect.x + m.boxRect.width);
      const y = Math.min(m.boxRect.y, m.boxRect.y + m.boxRect.height);
      return {
        x,
        y,
        width: Math.abs(m.boxRect.width),
        height: Math.abs(m.boxRect.height),
      };
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const expand = (px: number, py: number) => {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    };

    if (m.compoundPaths && m.compoundPaths.length > 0) {
      for (const cp of m.compoundPaths) {
        if (cp.points) cp.points.forEach((pt) => expand(pt.x, pt.y));
        if (cp.circle) {
          expand(cp.circle.cx - cp.circle.r, cp.circle.cy - cp.circle.r);
          expand(cp.circle.cx + cp.circle.r, cp.circle.cy + cp.circle.r);
        }
        if (cp.ellipse) {
          expand(cp.ellipse.cx - cp.ellipse.rx, cp.ellipse.cy - cp.ellipse.ry);
          expand(cp.ellipse.cx + cp.ellipse.rx, cp.ellipse.cy + cp.ellipse.ry);
        }
        if (cp.rect) {
          expand(cp.rect.x, cp.rect.y);
          expand(cp.rect.x + cp.rect.width, cp.rect.y + cp.rect.height);
        }
      }
    }

    if ('points' in m && Array.isArray((m as any).points)) {
      (m as any).points.forEach((pt: Point2D) => expand(pt.x, pt.y));
    }
    if ('cloudPoints' in m && Array.isArray((m as any).cloudPoints)) {
      (m as any).cloudPoints.forEach((pt: Point2D) => expand(pt.x, pt.y));
    }
    if ('locations' in m && Array.isArray((m as any).locations)) {
      (m as any).locations.forEach((pt: Point2D) => {
        expand(pt.x - 10, pt.y - 10);
        expand(pt.x + 10, pt.y + 10);
      });
    }
    if ('startPoint' in m && 'endPoint' in m && (m as any).startPoint && (m as any).endPoint) {
      expand((m as any).startPoint.x, (m as any).startPoint.y);
      expand((m as any).endPoint.x, (m as any).endPoint.y);
    }
    if ('arrowPoint' in m && (m as any).arrowPoint) {
      expand((m as any).arrowPoint.x, (m as any).arrowPoint.y);
    }

    if (!isFinite(minX) || !isFinite(minY)) return null;
    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  /**
   * Verifica se un markup cade dentro o interseca una Fence Rettangolare
   */
  public static isMarkupInRectFence(
    m: AnyMarkup,
    fence: { x: number; y: number; width: number; height: number },
    crossing: boolean = true
  ): boolean {
    const b = this.getMarkupBoundingBox(m);
    if (!b) return false;
    const fx1 = Math.min(fence.x, fence.x + fence.width);
    const fy1 = Math.min(fence.y, fence.y + fence.height);
    const fx2 = Math.max(fence.x, fence.x + fence.width);
    const fy2 = Math.max(fence.y, fence.y + fence.height);

    if (!crossing) {
      return b.x >= fx1 && b.y >= fy1 && b.x + b.width <= fx2 && b.y + b.height <= fy2;
    }
    // Intersezione / Crossing
    return !(b.x + b.width < fx1 || b.x > fx2 || b.y + b.height < fy1 || b.y > fy2);
  }

  /**
   * Verifica se un markup cade dentro o interseca una Fence Lazo (Poligono a mano libera)
   */
  public static isMarkupInLassoFence(m: AnyMarkup, lassoPoints: Point2D[]): boolean {
    if (lassoPoints.length < 3) return false;
    const b = this.getMarkupBoundingBox(m);
    if (!b) return false;

    const samplePoints: Point2D[] = [
      { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
      { x: b.x, y: b.y + b.height },
    ];

    if ('points' in m && Array.isArray((m as any).points)) {
      samplePoints.push(...(m as any).points);
    }
    if ('startPoint' in m && 'endPoint' in m && (m as any).startPoint && (m as any).endPoint) {
      const p1 = (m as any).startPoint;
      const p2 = (m as any).endPoint;
      samplePoints.push(p1, p2, { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
    }

    return samplePoints.some((pt) => this.isPointInPolygon(pt, lassoPoints));
  }

  /**
   * Hit-testing dei punti di presa (maniglie / handles) di un markup selezionato
   */
  public static hitTestHandles(p: Point2D, m: AnyMarkup, tolerance: number = 8): HandleHit | null {
    if (m.type === 'cloud_plus') {
      const cpm = m as CloudPlusMarkup;
      const { elbowX, elbowY } = MarkupRenderer.getCloudPlusGeometry(cpm);
      if (cpm.leaderPoint && Math.hypot(p.x - cpm.leaderPoint.x, p.y - cpm.leaderPoint.y) <= tolerance) {
        return { markupId: m.id, handleIndex: 100, handleType: 'arrow', point: cpm.leaderPoint };
      }
      if (Math.hypot(p.x - elbowX, p.y - elbowY) <= tolerance) {
        return { markupId: m.id, handleIndex: 0, handleType: 'elbow', point: { x: elbowX, y: elbowY } };
      }
      if (cpm.cloudPoints && Array.isArray(cpm.cloudPoints)) {
        for (let i = 0; i < cpm.cloudPoints.length; i++) {
          if (Math.hypot(p.x - cpm.cloudPoints[i].x, p.y - cpm.cloudPoints[i].y) <= tolerance) {
            return { markupId: m.id, handleIndex: i, handleType: 'vertex', point: cpm.cloudPoints[i] };
          }
        }
      }
      if (cpm.boxRect) {
        const b = cpm.boxRect;
        const corners = [
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y },
          { x: b.x + b.width, y: b.y + b.height },
          { x: b.x, y: b.y + b.height },
        ];
        for (let i = 0; i < corners.length; i++) {
          if (Math.hypot(p.x - corners[i].x, p.y - corners[i].y) <= tolerance) {
            return { markupId: m.id, handleIndex: i, handleType: 'rect_corner', point: corners[i] };
          }
        }
        const edges = [
          { x: b.x + b.width / 2, y: b.y },
          { x: b.x + b.width, y: b.y + b.height / 2 },
          { x: b.x + b.width / 2, y: b.y + b.height },
          { x: b.x, y: b.y + b.height / 2 },
        ];
        for (let i = 0; i < edges.length; i++) {
          if (Math.hypot(p.x - edges[i].x, p.y - edges[i].y) <= tolerance) {
            return { markupId: m.id, handleIndex: i, handleType: 'rect_edge', point: edges[i] };
          }
        }
      }
      return null;
    }

    // Per simboli composti (BTX / Gruppi) usa i 4 angoli del boxRect e la maniglia di rotazione
    if (m.compoundPaths && m.compoundPaths.length > 0 && m.boxRect) {
      const b = m.boxRect;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rad = (((m as any).rotation || 0) * Math.PI) / 180;
      const rotPt = (px: number, py: number): Point2D => {
        if (!rad) return { x: px, y: py };
        const dx = px - cx;
        const dy = py - cy;
        return {
          x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
          y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
        };
      };
      const rotHandle = rotPt(cx, b.y - 20);
      if (Math.hypot(p.x - rotHandle.x, p.y - rotHandle.y) <= tolerance + 2) {
        return { markupId: m.id, handleIndex: 0, handleType: 'rotate', point: rotHandle };
      }
      const corners = [
        rotPt(b.x, b.y),
        rotPt(b.x + b.width, b.y),
        rotPt(b.x + b.width, b.y + b.height),
        rotPt(b.x, b.y + b.height),
      ];
      for (let i = 0; i < corners.length; i++) {
        if (Math.hypot(p.x - corners[i].x, p.y - corners[i].y) <= tolerance) {
          return { markupId: m.id, handleIndex: i, handleType: 'rect_corner', point: corners[i] };
        }
      }
      return null;
    }

    if ('points' in m && Array.isArray((m as any).points)) {
      const pts: Point2D[] = (m as any).points;
      if (pts.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity;
        for (const pt of pts) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
        }
        const rotHandle = { x: (minX + maxX) / 2, y: minY - 20 };
        if (Math.hypot(p.x - rotHandle.x, p.y - rotHandle.y) <= tolerance + 2) {
          return { markupId: m.id, handleIndex: 0, handleType: 'rotate', point: rotHandle };
        }
      }
      for (let i = 0; i < pts.length; i++) {
        if (Math.hypot(p.x - pts[i].x, p.y - pts[i].y) <= tolerance) {
          return { markupId: m.id, handleIndex: i, handleType: 'vertex', point: pts[i] };
        }
      }
    }

    if (m.type === 'measure_length') {
      const ml = m as any;
      if (Math.hypot(p.x - ml.startPoint.x, p.y - ml.startPoint.y) <= tolerance + 2) {
        return { markupId: m.id, handleIndex: 0, handleType: 'start', point: ml.startPoint };
      }
      if (Math.hypot(p.x - ml.endPoint.x, p.y - ml.endPoint.y) <= tolerance + 2) {
        return { markupId: m.id, handleIndex: 1, handleType: 'end', point: ml.endPoint };
      }
      const dx = ml.endPoint.x - ml.startPoint.x;
      const dy = ml.endPoint.y - ml.startPoint.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const nx = -dy / len;
        const ny = dx / len;
        const offset = ml.extensionOffset !== undefined ? ml.extensionOffset : 24;
        const dimMid = {
          x: (ml.startPoint.x + ml.endPoint.x) / 2 + nx * offset,
          y: (ml.startPoint.y + ml.endPoint.y) / 2 + ny * offset,
        };
        if (Math.hypot(p.x - dimMid.x, p.y - dimMid.y) <= tolerance + 4) {
          return { markupId: m.id, handleIndex: 2, handleType: 'dim_offset', point: dimMid };
        }
      }
      return null;
    }

    if ('startPoint' in m && 'endPoint' in m && (m as any).startPoint && (m as any).endPoint) {
      const lm = m as any;
      const minX = Math.min(lm.startPoint.x, lm.endPoint.x);
      const maxX = Math.max(lm.startPoint.x, lm.endPoint.x);
      const minY = Math.min(lm.startPoint.y, lm.endPoint.y);
      const rotHandle = { x: (minX + maxX) / 2, y: minY - 20 };
      if (Math.hypot(p.x - rotHandle.x, p.y - rotHandle.y) <= tolerance + 2) {
        return { markupId: m.id, handleIndex: 0, handleType: 'rotate', point: rotHandle };
      }
      if (Math.hypot(p.x - lm.startPoint.x, p.y - lm.startPoint.y) <= tolerance) {
        return { markupId: m.id, handleIndex: 0, handleType: 'start', point: lm.startPoint };
      }
      if (Math.hypot(p.x - lm.endPoint.x, p.y - lm.endPoint.y) <= tolerance) {
        return { markupId: m.id, handleIndex: 1, handleType: 'end', point: lm.endPoint };
      }
    }

    if (m.type === 'callout') {
      const cm = m as CalloutMarkup;
      const { elbowX, elbowY, arrows } = MarkupRenderer.getCalloutGeometry(cm);
      for (let i = 0; i < arrows.length; i++) {
        if (Math.hypot(p.x - arrows[i].x, p.y - arrows[i].y) <= tolerance) {
          return { markupId: m.id, handleIndex: i, handleType: 'arrow', point: arrows[i] };
        }
      }
      if (Math.hypot(p.x - elbowX, p.y - elbowY) <= tolerance) {
        return { markupId: m.id, handleIndex: 0, handleType: 'elbow', point: { x: elbowX, y: elbowY } };
      }
      const b = cm.boxRect;
      const edges = [
        { x: b.x + b.width / 2, y: b.y },
        { x: b.x + b.width, y: b.y + b.height / 2 },
        { x: b.x + b.width / 2, y: b.y + b.height },
        { x: b.x, y: b.y + b.height / 2 },
      ];
      for (let i = 0; i < edges.length; i++) {
        if (Math.hypot(p.x - edges[i].x, p.y - edges[i].y) <= tolerance) {
          return { markupId: m.id, handleIndex: i, handleType: 'rect_edge', point: edges[i] };
        }
      }
    }

    if ('boxRect' in m && (m as any).boxRect) {
      const sm = m as any;
      const b = sm.boxRect;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rad = ((sm.rotation || 0) * Math.PI) / 180;
      const rotPt = (px: number, py: number): Point2D => {
        if (!rad) return { x: px, y: py };
        const dx = px - cx;
        const dy = py - cy;
        return {
          x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
          y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
        };
      };
      const rotHandle = rotPt(cx, b.y - 20);
      if (Math.hypot(p.x - rotHandle.x, p.y - rotHandle.y) <= tolerance + 2) {
        return { markupId: m.id, handleIndex: 0, handleType: 'rotate', point: rotHandle };
      }
      const corners = [
        rotPt(b.x, b.y),
        rotPt(b.x + b.width, b.y),
        rotPt(b.x + b.width, b.y + b.height),
        rotPt(b.x, b.y + b.height),
      ];
      for (let i = 0; i < corners.length; i++) {
        if (Math.hypot(p.x - corners[i].x, p.y - corners[i].y) <= tolerance) {
          return { markupId: m.id, handleIndex: i, handleType: 'rect_corner', point: corners[i] };
        }
      }
      return null;
    }

    return null;
  }
}
