import { useAppStore } from '@/store/useAppStore';
import { Point2D, StampMarkup } from '@/types/markup';
import { MarkupRenderer } from '@/core/markup/markupRenderer';

let internalClipboardImageDataUrl: string | null = null;
let internalClipboardImageSize: { width: number; height: number } | null = null;

export function setClipboardImageDataUrl(
  dataUrl: string | null,
  size?: { width: number; height: number } | null
): void {
  internalClipboardImageDataUrl = dataUrl;
  internalClipboardImageSize = size || null;
}

export function getClipboardImageDataUrl(): string | null {
  return internalClipboardImageDataUrl;
}

export function getClipboardImageSize(): { width: number; height: number } | null {
  return internalClipboardImageSize;
}

/**
 * Inserisce una DataURL immagine (PNG/JPG/WebP/SVG/GIF) nella pagina PDF attiva
 * come markup immagine spostabile e ridimensionabile.
 */
export function insertImageDataUrlToPdf(
  dataUrl: string,
  name: string = 'Immagine',
  targetCenterPt?: Point2D | null,
  explicitSize?: { width: number; height: number } | null,
  targetPageIndex?: number
): void {
  const st = useAppStore.getState();
  const doc = st.openDocuments.find((d) => d.id === st.activeDocumentId);
  if (!doc) {
    alert("Apri prima un documento PDF per inserire un'immagine.");
    return;
  }

  const img = new Image();
  img.onload = () => {
    const curState = useAppStore.getState();
    const curDoc = curState.openDocuments.find((d) => d.id === curState.activeDocumentId);
    const pageIndex =
      typeof targetPageIndex === 'number'
        ? Math.max(0, Math.min((curDoc?.pagesInfo?.length || 1) - 1, targetPageIndex))
        : Math.max(0, (curDoc?.currentPage || 1) - 1);
    const pageSize = curDoc?.pagesInfo?.[pageIndex] || { width: 595, height: 842 };

    let w: number;
    let h: number;
    if (explicitSize && explicitSize.width > 4 && explicitSize.height > 4) {
      w = explicitSize.width;
      h = explicitSize.height;
    } else {
      const natW = Math.max(1, img.naturalWidth || 200);
      const natH = Math.max(1, img.naturalHeight || 200);
      const maxDim = Math.min(pageSize.width * 0.45, 280);
      const scale = Math.min(1, maxDim / Math.max(natW, natH));
      w = Math.max(24, natW * scale);
      h = Math.max(24, natH * scale);
    }

    const x = targetCenterPt
      ? targetCenterPt.x - w / 2
      : Math.max(20, (pageSize.width - w) / 2);
    const y = targetCenterPt
      ? targetCenterPt.y - h / 2
      : Math.max(20, (pageSize.height - h) / 2);

    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const imageMarkup: StampMarkup = {
      id,
      docId: 'primary',
      type: 'stamp',
      pageIndex,
      author: curState.currentUser || 'Utente',
      subject: name || 'Immagine',
      contents: '',
      creationDate: new Date().toISOString(),
      modificationDate: new Date().toISOString(),
      status: 'None',
      strokeColor: '#0078d4',
      strokeWidth: 1,
      opacity: 1,
      stampTitle: name || 'Immagine',
      dateStamp: '',
      imageDataUrl: dataUrl,
      boxRect: { x, y, width: w, height: h },
    };

    void MarkupRenderer.preloadStampImage(id, dataUrl).then(() => {
      const cur = useAppStore.getState();
      cur.addMarkup(imageMarkup);
      cur.selectMarkup(id);
      cur.setActiveTool('select');
    });
  };
  img.src = dataUrl;
}

/**
 * Apre il selettore file per importare un'immagine (PNG/JPG/WebP/SVG/GIF)
 * e la inserisce nella pagina PDF attiva come markup ridimensionabile e spostabile.
 */
export function triggerImageImportToPdf(): void {
  const state = useAppStore.getState();
  const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
  if (!activeDoc) {
    alert("Apri prima un documento PDF per inserire un'immagine.");
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/jpg,image/webp,image/svg+xml,image/gif';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl) return;
      const cleanName = file.name.replace(/\.[^.]+$/, '') || 'Immagine';
      insertImageDataUrlToPdf(dataUrl, cleanName);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}
