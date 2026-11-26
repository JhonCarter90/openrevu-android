import { Point2D, ScaleCalibration, UnitType } from '@/types/markup';

export class ScaleManager {
  /**
   * Calcola la distanza euclidea tra due punti in coordinate PDF
   */
  public static calculateDistance(p1: Point2D, p2: Point2D): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.hypot(dx, dy);
  }

  /**
   * Calcola la lunghezza cumulativa di una polilinea in coordinate PDF
   */
  public static calculatePolylineLength(points: Point2D[]): number {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      total += this.calculateDistance(points[i], points[i + 1]);
    }
    return total;
  }

  /**
   * Calcola l'area di un poligono con la formula dell'area di Gauss (Shoelace Formula)
   */
  public static calculatePolygonArea(points: Point2D[]): number {
    if (points.length < 3) return 0;
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  }

  /**
   * Crea una calibrazione scala a partire da 2 punti e dal valore reale inserito
   */
  public static calibrate(
    p1: Point2D,
    p2: Point2D,
    realDistance: number,
    unit: UnitType
  ): ScaleCalibration {
    const pixelDistance = this.calculateDistance(p1, p2);
    if (pixelDistance <= 0.0001 || realDistance <= 0) {
      throw new Error('Distanza di calibrazione non valida');
    }

    const scaleRatio = realDistance / pixelDistance;
    const formattedText = `1 pt = ${scaleRatio.toFixed(4)} ${unit}`;

    return {
      pixelDistance,
      realDistance,
      unit,
      scaleRatio,
      formattedText,
    };
  }

  /**
   * Converte una misura in punti PDF in misura reale formattata
   */
  public static formatLength(pointsDistance: number, scale?: ScaleCalibration | null): string {
    if (!scale) {
      // In assenza di calibrazione mostra punti o mm approssimati (1 pt = 0.352778 mm)
      const mm = pointsDistance * (25.4 / 72);
      return `${mm.toFixed(1)} mm (1:1)`;
    }
    const realVal = pointsDistance * scale.scaleRatio;
    return `${realVal.toFixed(2)} ${scale.unit}`;
  }

  /**
   * Converte un'area in punti PDF² in area reale formattata
   */
  public static formatArea(pointsArea: number, scale?: ScaleCalibration | null): string {
    if (!scale) {
      const mm2 = pointsArea * Math.pow(25.4 / 72, 2);
      const m2 = mm2 / 1_000_000;
      return `${m2.toFixed(3)} m² (1:1)`;
    }
    // Area reale = punti * scaleRatio²
    const realArea = pointsArea * Math.pow(scale.scaleRatio, 2);
    return `${realArea.toFixed(3)} ${scale.unit}²`;
  }
}
