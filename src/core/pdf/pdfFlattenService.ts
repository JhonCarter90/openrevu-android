import { PDFDocument, degrees } from 'pdf-lib';
import { AnyMarkup, ScaleCalibration } from '@/types/markup';
import { PDFPageInfo } from '@/types/pdf';
import { MarkupRenderer } from '@/core/markup/markupRenderer';
import { useAppStore } from '@/store/useAppStore';
import { PDFManager } from '@/core/pdf/pdfManager';

/**
 * Fonde permanentemente (Flatten / Unisci livelli) i markup specificati
 * dentro il contenuto statico delle pagine PDF, rendendoli non più modificabili.
 */
export async function flattenMarkupsIntoPdfBytes(
  fileBytes: Uint8Array,
  pagesInfo: PDFPageInfo[],
  markupsToFlatten: AnyMarkup[],
  scaleCalibration?: ScaleCalibration | null
): Promise<Uint8Array> {
  if (markupsToFlatten.length === 0) return fileBytes;

  const pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  // Raggruppa per pagina
  const byPage = new Map<number, AnyMarkup[]>();
  for (const m of markupsToFlatten) {
    const pIdx = m.pageIndex ?? 0;
    if (!byPage.has(pIdx)) byPage.set(pIdx, []);
    byPage.get(pIdx)!.push(m);
  }

  const renderScale = 2; // 144 DPI per nitidezza elevata su linee e testi

  for (const [pageIdx, list] of byPage.entries()) {
    const page = pages[pageIdx];
    if (!page || list.length === 0) continue;

    const crop = page.getCropBox();
    const rot = ((page.getRotation().angle || 0) % 360 + 360) % 360;
    const isQuarter = rot === 90 || rot === 270;
    const infoW = pagesInfo[pageIdx]?.width || (isQuarter ? crop.height : crop.width);
    const infoH = pagesInfo[pageIdx]?.height || (isQuarter ? crop.width : crop.height);

    // Cap sicuro per tavole A0/A1 (evita overflow GPU/RAM in fase di Flatten)
    const safeScale = Math.min(renderScale, 4096 / Math.max(infoW, infoH, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(infoW * safeScale));
    canvas.height = Math.max(1, Math.round(infoH * safeScale));
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(safeScale, safeScale);
    for (const m of list) {
      MarkupRenderer.renderMarkup(ctx, m, false, scaleCalibration);
    }

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1] || '';
    const bin = atob(base64);
    const pngBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) pngBytes[i] = bin.charCodeAt(i);

    const pngImage = await pdfDoc.embedPng(pngBytes);
    if (rot === 90) {
      page.drawImage(pngImage, {
        x: crop.x + crop.width,
        y: crop.y,
        width: crop.height,
        height: crop.width,
        rotate: degrees(90),
      });
    } else if (rot === 180) {
      page.drawImage(pngImage, {
        x: crop.x + crop.width,
        y: crop.y + crop.height,
        width: crop.width,
        height: crop.height,
        rotate: degrees(180),
      });
    } else if (rot === 270) {
      page.drawImage(pngImage, {
        x: crop.x,
        y: crop.y + crop.height,
        width: crop.height,
        height: crop.width,
        rotate: degrees(270),
      });
    } else {
      page.drawImage(pngImage, {
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
      });
    }
  }

  return await pdfDoc.save({ useObjectStreams: false });
}

export async function triggerFlattenActiveDocument(): Promise<void> {
  const st = useAppStore.getState();
  const docId = st.activeDocumentId;
  if (!st.fileBytes || docId === 'home') {
    alert('Nessun documento PDF attivo.');
    return;
  }
  if (st.markups.length === 0) {
    alert('Non ci sono commenti o marcature da unire nel documento.');
    return;
  }
  const ok = window.confirm(
    `Vuoi unire i livelli (appiattire ${st.markups.length} marcature nel PDF)?\nUna volta uniti, i commenti e le marcature diventeranno parte fissa del PDF e non saranno più modificabili.`
  );
  if (!ok) return;

  try {
    const flattenedBytes = await flattenMarkupsIntoPdfBytes(
      st.fileBytes,
      st.pagesInfo,
      st.markups,
      st.scaleCalibration
    );
    await PDFManager.getInstance().loadDocument(flattenedBytes, docId);
    st.applyFlattenedDocument(docId, flattenedBytes, []);
  } catch (err) {
    console.error('Errore unione livelli:', err);
    alert("Errore durante l'unione dei livelli (Flatten).");
  }
}
