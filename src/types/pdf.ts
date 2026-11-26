export interface PDFPageInfo {
  pageNumber: number; // 1-based
  pageIndex: number;  // 0-based
  width: number;      // Larghezza in punti (72 pt = 1 inch)
  height: number;     // Altezza in punti
  rotation: number;   // 0, 90, 180, 270
  label?: string;     // Etichetta pagina (/PageLabels standard PDF / Bluebeam)
}

export interface PDFDocumentState {
  file: File | null;
  fileName: string;
  fileBytes: Uint8Array | null;
  numPages: number;
  currentPage: number; // 1-based
  pagesInfo: PDFPageInfo[];
  isLoading: boolean;
  error: string | null;
}

export interface ViewportTransform {
  zoom: number;       // 1.0 = 100%
  panX: number;       // Offset X in pixel dello schermo
  panY: number;       // Offset Y in pixel dello schermo
  rotation: number;   // 0, 90, 180, 270
}
