import { PDFDocument, PDFName, PDFNumber, PDFString, degrees } from 'pdf-lib';
import { AnyMarkup, Point2D } from '@/types/markup';
import { PDFManager } from '@/core/pdf/pdfManager';
import { useAppStore } from '@/store/useAppStore';

export interface InsertPageSource {
  id: string;
  fileName: string;
  filePath?: string;
  bytes: Uint8Array;
  numPages: number;
  pageRange?: string; // es. "Tutte" o "1-3, 5"
}

/**
 * Scrive il dizionario standard ISO 32000 /PageLabels nel Catalog del PDF,
 * così le etichette delle pagine sono visibili in OpenRevu, Bluebeam Revu e Adobe Acrobat.
 */
function writePageLabelsToCatalog(pdfDoc: PDFDocument, labels: (string | undefined)[]) {
  const hasAnyCustom = labels.some((l, idx) => Boolean(l && l.trim() && l.trim() !== String(idx + 1)));
  if (!hasAnyCustom) {
    pdfDoc.catalog.delete(PDFName.of('PageLabels'));
    return;
  }

  const numsArray: any[] = [];
  for (let i = 0; i < labels.length; i++) {
    const custom = labels[i]?.trim();
    numsArray.push(PDFNumber.of(i));
    if (custom) {
      numsArray.push(
        pdfDoc.context.obj({
          P: PDFString.of(custom),
        })
      );
    } else {
      numsArray.push(
        pdfDoc.context.obj({
          S: PDFName.of('D'),
          St: PDFNumber.of(i + 1),
        })
      );
    }
  }

  const pageLabelsDict = pdfDoc.context.obj({
    Nums: pdfDoc.context.obj(numsArray),
  });
  pdfDoc.catalog.set(PDFName.of('PageLabels'), pageLabelsDict);
}

/**
 * Ruota un punto viewport (Top-Left) di deltaDegrees (90, -90/270, 180)
 * quando la pagina viene ruotata permanentemente.
 */
function rotateViewportPoint(pt: Point2D, oldW: number, oldH: number, deltaDeg: number): Point2D {
  const norm = ((deltaDeg % 360) + 360) % 360;
  if (norm === 90) {
    return { x: oldH - pt.y, y: pt.x };
  }
  if (norm === 180) {
    return { x: oldW - pt.x, y: oldH - pt.y };
  }
  if (norm === 270) {
    return { x: pt.y, y: oldW - pt.x };
  }
  return pt;
}

function rotateViewportBox(
  box: { x: number; y: number; width: number; height: number },
  oldW: number,
  oldH: number,
  deltaDeg: number
): { x: number; y: number; width: number; height: number } {
  const p1 = rotateViewportPoint({ x: box.x, y: box.y }, oldW, oldH, deltaDeg);
  const p2 = rotateViewportPoint({ x: box.x + box.width, y: box.y + box.height }, oldW, oldH, deltaDeg);
  const minX = Math.min(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  return {
    x: minX,
    y: minY,
    width: Math.abs(p2.x - p1.x),
    height: Math.abs(p2.y - p1.y),
  };
}

function rotateMarkupForPage(m: AnyMarkup, oldW: number, oldH: number, deltaDeg: number): AnyMarkup {
  const clone: any = { ...m };
  if (clone.boxRect) {
    clone.boxRect = rotateViewportBox(clone.boxRect, oldW, oldH, deltaDeg);
  }
  if (clone.startPoint) {
    clone.startPoint = rotateViewportPoint(clone.startPoint, oldW, oldH, deltaDeg);
  }
  if (clone.endPoint) {
    clone.endPoint = rotateViewportPoint(clone.endPoint, oldW, oldH, deltaDeg);
  }
  if (clone.arrowPoint) {
    clone.arrowPoint = rotateViewportPoint(clone.arrowPoint, oldW, oldH, deltaDeg);
  }
  if (clone.elbowPoint) {
    clone.elbowPoint = rotateViewportPoint(clone.elbowPoint, oldW, oldH, deltaDeg);
  }
  if (clone.leaderPoint) {
    clone.leaderPoint = rotateViewportPoint(clone.leaderPoint, oldW, oldH, deltaDeg);
  }
  if (Array.isArray(clone.points)) {
    clone.points = clone.points.map((p: Point2D) => rotateViewportPoint(p, oldW, oldH, deltaDeg));
  }
  if (Array.isArray(clone.cloudPoints)) {
    clone.cloudPoints = clone.cloudPoints.map((p: Point2D) => rotateViewportPoint(p, oldW, oldH, deltaDeg));
  }
  if (Array.isArray(clone.locations)) {
    clone.locations = clone.locations.map((p: Point2D) => rotateViewportPoint(p, oldW, oldH, deltaDeg));
  }
  if (Array.isArray(clone.compoundPaths)) {
    clone.compoundPaths = clone.compoundPaths.map((cp: any) => {
      const ncp = { ...cp };
      if (Array.isArray(ncp.points)) {
        ncp.points = ncp.points.map((p: Point2D) => rotateViewportPoint(p, oldW, oldH, deltaDeg));
      }
      if (ncp.rect) {
        ncp.rect = rotateViewportBox(ncp.rect, oldW, oldH, deltaDeg);
      }
      if (ncp.circle) {
        const c = rotateViewportPoint({ x: ncp.circle.cx, y: ncp.circle.cy }, oldW, oldH, deltaDeg);
        ncp.circle = { ...ncp.circle, cx: c.x, cy: c.y };
      }
      if (ncp.ellipse) {
        const c = rotateViewportPoint({ x: ncp.ellipse.cx, y: ncp.ellipse.cy }, oldW, oldH, deltaDeg);
        const norm = ((deltaDeg % 360) + 360) % 360;
        const swap = norm === 90 || norm === 270;
        ncp.ellipse = {
          cx: c.x,
          cy: c.y,
          rx: swap ? ncp.ellipse.ry : ncp.ellipse.rx,
          ry: swap ? ncp.ellipse.rx : ncp.ellipse.ry,
        };
      }
      return ncp;
    });
  }
  return clone as AnyMarkup;
}

/**
 * Ruota permanentemente nel PDF le pagine indicate (es. +90° orario o -90° antiorario).
 */
export async function rotatePagesInActiveDocument(
  pageIndices: number[],
  deltaDegrees: number
): Promise<void> {
  const st = useAppStore.getState();
  const docId = st.activeDocumentId;
  if (!st.fileBytes || docId === 'home' || pageIndices.length === 0) return;

  const uniqueIndices = Array.from(new Set(pageIndices)).filter(
    (idx) => idx >= 0 && idx < st.pagesInfo.length
  );
  if (uniqueIndices.length === 0) return;

  const pdfDoc = await PDFDocument.load(st.fileBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const rotatedSet = new Set(uniqueIndices);

  for (const idx of uniqueIndices) {
    const page = pages[idx];
    if (!page) continue;
    const curRot = page.getRotation().angle || 0;
    const nextRot = ((curRot + deltaDegrees) % 360 + 360) % 360;
    page.setRotation(degrees(nextRot));
  }

  const nextBytes = await pdfDoc.save({ useObjectStreams: false });
  const reloaded = await PDFManager.getInstance().loadDocument(nextBytes, docId);

  // Mantiene eventuali etichette personalizzate già presenti in pagesInfo
  const mergedPagesInfo = reloaded.pagesInfo.map((p, idx) => ({
    ...p,
    label: p.label || st.pagesInfo[idx]?.label,
  }));

  // Ruota anche le coordinate dei markup sulle pagine ruotate
  const updatedMarkups = st.markups.map((m) => {
    const pIdx = m.pageIndex ?? 0;
    if (!rotatedSet.has(pIdx)) return m;
    const oldInfo = st.pagesInfo[pIdx];
    if (!oldInfo) return m;
    return rotateMarkupForPage(m, oldInfo.width, oldInfo.height, deltaDegrees);
  });

  st.updateActiveDocumentStructure(nextBytes, mergedPagesInfo, updatedMarkups, st.currentPage);
}

/**
 * Elimina le pagine selezionate dal PDF attivo, aggiornando indici markup e /PageLabels.
 */
export async function deletePagesFromActiveDocument(pageIndices: number[]): Promise<void> {
  const st = useAppStore.getState();
  const docId = st.activeDocumentId;
  if (!st.fileBytes || docId === 'home' || pageIndices.length === 0) return;

  const uniqueDesc = Array.from(new Set(pageIndices))
    .filter((idx) => idx >= 0 && idx < st.pagesInfo.length)
    .sort((a, b) => b - a);

  if (uniqueDesc.length === 0) return;
  if (uniqueDesc.length >= st.pagesInfo.length) {
    alert('Impossibile eliminare tutte le pagine: il documento deve contenere almeno una pagina.');
    return;
  }

  const pdfDoc = await PDFDocument.load(st.fileBytes, { ignoreEncryption: true });
  const deleteSet = new Set(uniqueDesc);

  const remainingLabels = st.pagesInfo
    .filter((_, idx) => !deleteSet.has(idx))
    .map((p) => p.label);

  for (const idx of uniqueDesc) {
    pdfDoc.removePage(idx);
  }
  writePageLabelsToCatalog(pdfDoc, remainingLabels);

  const nextBytes = await pdfDoc.save({ useObjectStreams: false });
  const reloaded = await PDFManager.getInstance().loadDocument(nextBytes, docId);

  // Rimappa pageIndex dei markup sopravvissuti
  const indexMap = new Map<number, number>();
  let newIdx = 0;
  for (let oldIdx = 0; oldIdx < st.pagesInfo.length; oldIdx++) {
    if (!deleteSet.has(oldIdx)) {
      indexMap.set(oldIdx, newIdx++);
    }
  }
  const updatedMarkups = st.markups
    .filter((m) => !deleteSet.has(m.pageIndex ?? 0))
    .map((m) => ({
      ...m,
      pageIndex: indexMap.get(m.pageIndex ?? 0) ?? 0,
    }));

  const mergedPagesInfo = reloaded.pagesInfo.map((p, idx) => ({
    ...p,
    label: remainingLabels[idx] || p.label,
  }));

  const nextCurrent = Math.min(st.currentPage, mergedPagesInfo.length);
  st.updateActiveDocumentStructure(nextBytes, mergedPagesInfo, updatedMarkups, nextCurrent);
}

/**
 * Inserisce una pagina vuota (stesse dimensioni della pagina di riferimento) prima o dopo targetIndex.
 */
export async function insertBlankPageInActiveDocument(
  targetIndex: number,
  position: 'before' | 'after' = 'after'
): Promise<void> {
  const st = useAppStore.getState();
  const docId = st.activeDocumentId;
  if (!st.fileBytes || docId === 'home') return;

  const pdfDoc = await PDFDocument.load(st.fileBytes, { ignoreEncryption: true });
  const refPage = pdfDoc.getPage(Math.max(0, Math.min(pdfDoc.getPageCount() - 1, targetIndex)));
  const { width, height } = refPage.getSize();
  const insertAt = position === 'before' ? Math.max(0, targetIndex) : Math.min(pdfDoc.getPageCount(), targetIndex + 1);

  const newPage = pdfDoc.insertPage(insertAt, [width, height]);
  const refRot = refPage.getRotation().angle || 0;
  if (refRot !== 0) {
    newPage.setRotation(degrees(refRot));
  }

  const nextLabels = st.pagesInfo.map((p) => p.label);
  nextLabels.splice(insertAt, 0, undefined);
  writePageLabelsToCatalog(pdfDoc, nextLabels);

  const nextBytes = await pdfDoc.save({ useObjectStreams: false });
  const reloaded = await PDFManager.getInstance().loadDocument(nextBytes, docId);

  const updatedMarkups = st.markups.map((m) => {
    const pIdx = m.pageIndex ?? 0;
    return pIdx >= insertAt ? { ...m, pageIndex: pIdx + 1 } : m;
  });

  const mergedPagesInfo = reloaded.pagesInfo.map((p, idx) => ({
    ...p,
    label: nextLabels[idx] || p.label,
  }));

  st.updateActiveDocumentStructure(nextBytes, mergedPagesInfo, updatedMarkups, insertAt + 1);
}

/**
 * Inserisce pagine da uno o più documenti PDF (aperti o scelti dal disco) nella posizione indicata.
 */
export async function insertPagesFromSourcesInActiveDocument(
  sources: InsertPageSource[],
  insertAt: number,
  options: { useFileNameAsLabel: boolean }
): Promise<void> {
  const st = useAppStore.getState();
  const docId = st.activeDocumentId;
  if (!st.fileBytes || docId === 'home' || sources.length === 0) return;

  const pdfDoc = await PDFDocument.load(st.fileBytes, { ignoreEncryption: true });
  const clampedInsertAt = Math.max(0, Math.min(pdfDoc.getPageCount(), insertAt));

  const nextLabels = st.pagesInfo.map((p) => p.label);
  let totalInserted = 0;

  for (const src of sources) {
    const srcDoc = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
    const indices = srcDoc.getPageIndices();
    const copiedPages = await pdfDoc.copyPages(srcDoc, indices);
    const baseLabel = src.fileName.replace(/\.pdf$/i, '');

    copiedPages.forEach((copiedPage, i) => {
      const pos = clampedInsertAt + totalInserted;
      pdfDoc.insertPage(pos, copiedPage);
      const pageLabel = options.useFileNameAsLabel
        ? copiedPages.length > 1
          ? `${baseLabel} (${i + 1})`
          : baseLabel
        : undefined;
      nextLabels.splice(pos, 0, pageLabel);
      totalInserted++;
    });
  }

  writePageLabelsToCatalog(pdfDoc, nextLabels);

  const nextBytes = await pdfDoc.save({ useObjectStreams: false });
  const reloaded = await PDFManager.getInstance().loadDocument(nextBytes, docId);

  const updatedMarkups = st.markups.map((m) => {
    const pIdx = m.pageIndex ?? 0;
    return pIdx >= clampedInsertAt ? { ...m, pageIndex: pIdx + totalInserted } : m;
  });

  const mergedPagesInfo = reloaded.pagesInfo.map((p, idx) => ({
    ...p,
    label: nextLabels[idx] || p.label,
  }));

  st.updateActiveDocumentStructure(
    nextBytes,
    mergedPagesInfo,
    updatedMarkups,
    clampedInsertAt + 1
  );
}

/**
 * Rinomina l'etichetta di una singola pagina (scrivendo /PageLabels nel PDF).
 */
export async function renamePageLabelInActiveDocument(
  pageIndex: number,
  newLabel: string
): Promise<void> {
  const st = useAppStore.getState();
  const docId = st.activeDocumentId;
  if (!st.fileBytes || docId === 'home') return;
  if (pageIndex < 0 || pageIndex >= st.pagesInfo.length) return;

  const pdfDoc = await PDFDocument.load(st.fileBytes, { ignoreEncryption: true });
  const nextLabels = st.pagesInfo.map((p) => p.label);
  const trimmed = newLabel.trim();
  nextLabels[pageIndex] = trimmed.length > 0 ? trimmed : undefined;

  writePageLabelsToCatalog(pdfDoc, nextLabels);
  const nextBytes = await pdfDoc.save({ useObjectStreams: false });

  const mergedPagesInfo = st.pagesInfo.map((p, idx) => ({
    ...p,
    label: nextLabels[idx],
  }));

  st.updateActiveDocumentStructure(nextBytes, mergedPagesInfo, st.markups, st.currentPage);
}

/**
 * Ripristina tutte le etichette pagina alla numerazione standard (1, 2, 3...).
 */
export async function resetAllPageLabelsInActiveDocument(): Promise<void> {
  const st = useAppStore.getState();
  const docId = st.activeDocumentId;
  if (!st.fileBytes || docId === 'home') return;

  const pdfDoc = await PDFDocument.load(st.fileBytes, { ignoreEncryption: true });
  pdfDoc.catalog.delete(PDFName.of('PageLabels'));
  const nextBytes = await pdfDoc.save({ useObjectStreams: false });

  const mergedPagesInfo = st.pagesInfo.map((p) => ({
    ...p,
    label: undefined,
  }));

  st.updateActiveDocumentStructure(nextBytes, mergedPagesInfo, st.markups, st.currentPage);
}
