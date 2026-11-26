import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { AnyMarkup } from '@/types/markup';
import { PDFPageInfo } from '@/types/pdf';

function sanitizeCsvField(val: string | number | undefined | null): string {
  const s = String(val ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `"${s}"`;
}

function getMarkupMeasureText(m: AnyMarkup): string {
  const anyM = m as any;
  if (m.type === 'measure_length' && typeof anyM.realLength === 'number') {
    return `${anyM.realLength.toFixed(2)} ${anyM.unit || 'm'}`;
  }
  if ((m.type === 'measure_area' || m.type === 'measure_area_rect') && typeof anyM.realArea === 'number') {
    return `${anyM.realArea.toFixed(2)} ${anyM.unit || 'm'}²`;
  }
  if (m.type === 'measure_count' && Array.isArray(anyM.locations)) {
    return `${anyM.locations.length} pz`;
  }
  return '';
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Esporta l'Elenco Marcature in formato CSV compatibile con Microsoft Excel italiano (UTF-8 BOM + separatore ';').
 */
export function exportMarkupsSummaryCSV(
  fileName: string,
  markups: AnyMarkup[],
  pagesInfo: PDFPageInfo[]
): void {
  if (markups.length === 0) {
    alert('Nessuna marcatura da esportare.');
    return;
  }

  const headers = [
    'Pagina',
    'Etichetta Pagina',
    'Oggetto',
    'Tipo',
    'Commento / Testo',
    'Autore',
    'Stato',
    'Colore',
    'Misura / Quantità',
    'Data Creazione',
    'Ultima Modifica',
  ];

  const rows = markups.map((m) => {
    const pIdx = m.pageIndex ?? 0;
    const pInfo = pagesInfo[pIdx];
    const comment = (m as any).text || m.contents || '';
    return [
      pIdx + 1,
      pInfo?.label || `Pagina ${pIdx + 1}`,
      m.subject || m.type,
      m.type,
      comment,
      m.author || '',
      m.status || 'None',
      m.strokeColor || '',
      getMarkupMeasureText(m),
      m.creationDate ? new Date(m.creationDate).toLocaleString('it-IT') : '',
      m.modificationDate ? new Date(m.modificationDate).toLocaleString('it-IT') : '',
    ]
      .map(sanitizeCsvField)
      .join(';');
  });

  const csvContent = '\uFEFF' + [headers.map(sanitizeCsvField).join(';'), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const baseName = (fileName || 'documento').replace(/\.pdf$/i, '');
  downloadBlob(blob, `${baseName}_Riepilogo_Marcature.csv`);
}

function safePdfAscii(s: string): string {
  return (s || '')
    .replace(/\r?\n/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .trim();
}

/**
 * Genera un Report PDF Riepilogativo professionale con la tabella di tutte le marcature, autori, stati e misure.
 */
export async function exportMarkupsSummaryPDF(
  fileName: string,
  markups: AnyMarkup[],
  pagesInfo: PDFPageInfo[]
): Promise<void> {
  if (markups.length === 0) {
    alert('Nessuna marcatura da esportare nel riepilogo PDF.');
    return;
  }

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 842; // A4 Landscape
  const pageH = 595;
  const margin = 36;
  const rowH = 20;

  const cols = [
    { label: 'Pag.', x: margin, w: 46 },
    { label: 'Oggetto', x: margin + 48, w: 125 },
    { label: 'Commento / Testo', x: margin + 175, w: 280 },
    { label: 'Autore', x: margin + 457, w: 115 },
    { label: 'Stato', x: margin + 574, w: 80 },
    { label: 'Misura', x: margin + 656, w: 110 },
  ];

  const addReportPage = (pageNum: number) => {
    const page = pdfDoc.addPage([pageW, pageH]);
    // Intestazione
    page.drawRectangle({
      x: 0,
      y: pageH - 54,
      width: pageW,
      height: 54,
      color: rgb(0.11, 0.14, 0.2),
    });
    page.drawText('OpenRevu CAD — Riepilogo Marcature & Revisione', {
      x: margin,
      y: pageH - 25,
      size: 13,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    page.drawText(
      `Documento: ${safePdfAscii(fileName)}   |   Totale marcature: ${markups.length}   |   Data: ${new Date().toLocaleDateString('it-IT')}   |   Foglio ${pageNum}`,
      {
        x: margin,
        y: pageH - 43,
        size: 8.5,
        font: fontRegular,
        color: rgb(0.78, 0.85, 0.94),
      }
    );

    // Header tabella
    const headerY = pageH - 78;
    page.drawRectangle({
      x: margin - 4,
      y: headerY - 5,
      width: pageW - margin * 2 + 8,
      height: 20,
      color: rgb(0.91, 0.93, 0.96),
    });
    cols.forEach((c) => {
      page.drawText(c.label, {
        x: c.x,
        y: headerY,
        size: 8.5,
        font: fontBold,
        color: rgb(0.15, 0.18, 0.25),
      });
    });

    return { page, startY: headerY - 22 };
  };

  let reportPageNum = 1;
  let { page, startY: curY } = addReportPage(reportPageNum);

  const truncate = (s: string, maxChars: number) =>
    s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s;

  markups.forEach((m, idx) => {
    if (curY < margin + 16) {
      reportPageNum++;
      const next = addReportPage(reportPageNum);
      page = next.page;
      curY = next.startY;
    }

    if (idx % 2 === 1) {
      page.drawRectangle({
        x: margin - 4,
        y: curY - 5,
        width: pageW - margin * 2 + 8,
        height: rowH,
        color: rgb(0.97, 0.98, 0.99),
      });
    }

    const pIdx = m.pageIndex ?? 0;
    const pLabel = pagesInfo[pIdx]?.label || String(pIdx + 1);
    const values = [
      truncate(safePdfAscii(pLabel), 8),
      truncate(safePdfAscii(m.subject || m.type), 24),
      truncate(safePdfAscii((m as any).text || m.contents || '-'), 58),
      truncate(safePdfAscii(m.author || '-'), 22),
      truncate(safePdfAscii(m.status || 'Nessuno'), 14),
      truncate(safePdfAscii(getMarkupMeasureText(m) || '-'), 20),
    ];

    cols.forEach((c, ci) => {
      page.drawText(values[ci], {
        x: c.x,
        y: curY,
        size: 8,
        font: fontRegular,
        color: rgb(0.15, 0.15, 0.17),
      });
    });

    curY -= rowH;
  });

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const baseName = (fileName || 'documento').replace(/\.pdf$/i, '');
  downloadBlob(blob, `${baseName}_Riepilogo_Marcature.pdf`);
}
