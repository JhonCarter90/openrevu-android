import { Point2D } from '@/types/markup';

export interface PDFPageTransform {
  x?: number;
  y?: number;
  width: number;
  height: number;
  rotation?: number;
}

export class CoordinateTransformer {
  /**
   * Converte un punto da coordinate Schermo (pixel relativi al canvas container)
   * a coordinate PDF (punti 72 DPI, origine TOP-LEFT della pagina)
   */
  public static screenToPage(
    screenPt: Point2D,
    panX: number,
    panY: number,
    zoom: number
  ): Point2D {
    return {
      x: (screenPt.x - panX) / zoom,
      y: (screenPt.y - panY) / zoom,
    };
  }

  /**
   * Converte un punto da coordinate Pagina (top-left)
   * a coordinate Schermo
   */
  public static pageToScreen(
    pagePt: Point2D,
    panX: number,
    panY: number,
    zoom: number
  ): Point2D {
    return {
      x: pagePt.x * zoom + panX,
      y: pagePt.y * zoom + panY,
    };
  }

  /**
   * Converte coordinate Pagina/Viewport (Top-Left, già ruotate secondo /Rotate)
   * nello standard ISO 32000 PDF (Bottom-Left, non ruotate rispetto a CropBox/MediaBox)
   */
  public static pageToPDFStandard(
    pagePt: Point2D,
    pageHeightOrTransform: number | PDFPageTransform
  ): Point2D {
    if (typeof pageHeightOrTransform === 'number') {
      return {
        x: pagePt.x,
        y: pageHeightOrTransform - pagePt.y,
      };
    }

    const x0 = pageHeightOrTransform.x || 0;
    const y0 = pageHeightOrTransform.y || 0;
    const w = pageHeightOrTransform.width;
    const h = pageHeightOrTransform.height;
    const rot = ((pageHeightOrTransform.rotation || 0) % 360 + 360) % 360;

    switch (rot) {
      case 90:
        return { x: x0 + pagePt.y, y: y0 + pagePt.x };
      case 180:
        return { x: x0 + w - pagePt.x, y: y0 + pagePt.y };
      case 270:
        return { x: x0 + w - pagePt.y, y: y0 + h - pagePt.x };
      case 0:
      default:
        return { x: x0 + pagePt.x, y: y0 + h - pagePt.y };
    }
  }

  /**
   * Restituisce i coefficienti [a, b, c, d] della matrice Tm per compensare
   * la rotazione /Rotate della pagina negli Appearance Stream (/AP /N).
   */
  public static getTextMatrixForPageRotation(
    pageHeightOrTransform: number | PDFPageTransform
  ): [number, number, number, number] {
    if (typeof pageHeightOrTransform === 'number') {
      return [1, 0, 0, 1];
    }
    const rot = ((pageHeightOrTransform.rotation || 0) % 360 + 360) % 360;
    switch (rot) {
      case 90:
        return [0, 1, -1, 0];
      case 180:
        return [-1, 0, 0, -1];
      case 270:
        return [0, -1, 1, 0];
      case 0:
      default:
        return [1, 0, 0, 1];
    }
  }

  /**
   * Restituisce la matrice PDF `cm` [a, b, c, d, e, f] per disegnare un'immagine
   * (origine [0,0]..[1,1]) orientata correttamente rispetto a /Rotate della pagina.
   */
  public static getImageMatrixForPageRotation(
    box: { x: number; y: number; width: number; height: number },
    pageTransform: PDFPageTransform
  ): [number, number, number, number, number, number] {
    const bl = this.pageToPDFStandard({ x: box.x, y: box.y + box.height }, pageTransform);
    const tr = this.pageToPDFStandard({ x: box.x + box.width, y: box.y }, pageTransform);
    const x1 = Math.min(bl.x, tr.x);
    const y1 = Math.min(bl.y, tr.y);
    const x2 = Math.max(bl.x, tr.x);
    const y2 = Math.max(bl.y, tr.y);
    const w = Math.max(1, x2 - x1);
    const h = Math.max(1, y2 - y1);
    const rot = ((pageTransform.rotation || 0) % 360 + 360) % 360;

    switch (rot) {
      case 90:
        return [0, box.width, -box.height, 0, x2, y1];
      case 180:
        return [-w, 0, 0, -h, x2, y2];
      case 270:
        return [0, -box.width, box.height, 0, x1, y2];
      case 0:
      default:
        return [w, 0, 0, h, x1, y1];
    }
  }

  /**
   * Converte coordinate standard PDF (Bottom-Left) in coordinate Pagina (Top-Left)
   */
  public static pdfStandardToPage(pdfPt: Point2D, pageHeight: number): Point2D {
    return {
      x: pdfPt.x,
      y: pageHeight - pdfPt.y,
    };
  }

  /**
   * Calcola il nuovo pan in modo che lo zoom rimanga ancorato sul cursore del mouse
   */
  public static zoomAtPoint(
    oldZoom: number,
    newZoom: number,
    panX: number,
    panY: number,
    pivotPoint: Point2D
  ): { panX: number; panY: number; zoom: number } {
    const scaleFactor = newZoom / oldZoom;
    const newPanX = pivotPoint.x - (pivotPoint.x - panX) * scaleFactor;
    const newPanY = pivotPoint.y - (pivotPoint.y - panY) * scaleFactor;

    return {
      panX: newPanX,
      panY: newPanY,
      zoom: newZoom,
    };
  }

  /**
   * Calcola il rettangolo di bounding box standard PDF [minX, minY, maxX, maxY]
   */
  public static computePDFRect(
    points: Point2D[],
    pageHeightOrTransform: number | PDFPageTransform
  ): [number, number, number, number] {
    if (points.length === 0) return [0, 0, 0, 0];

    const pdfPoints = points.map((p) => this.pageToPDFStandard(p, pageHeightOrTransform));
    let minX = pdfPoints[0].x;
    let maxX = pdfPoints[0].x;
    let minY = pdfPoints[0].y;
    let maxY = pdfPoints[0].y;

    for (let i = 1; i < pdfPoints.length; i++) {
      const p = pdfPoints[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    return [minX, minY, maxX, maxY];
  }
}
