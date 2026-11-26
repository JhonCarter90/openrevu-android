import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export type PageFormat = 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'Letter' | 'Tabloid' | 'ArchD' | 'ArchE';
export type PageOrientation = 'landscape' | 'portrait';

export interface BlankPdfOptions {
  format: PageFormat;
  orientation: PageOrientation;
  pageCount: number;
  title?: string;
  author?: string;
  includeBorder?: boolean;
  includeTitleBlock?: boolean;
  gridStyle?: 'none' | 'cad_grid' | 'dots';
}

export class BlankPdfGenerator {
  // Dimensioni in punti (1 mm = 72 / 25.4 pt = ~2.83465 pt)
  private static MM_TO_PT = 72 / 25.4;

  public static readonly FORMAT_DIMENSIONS_MM: Record<PageFormat, { width: number; height: number; description: string }> = {
    A4: { width: 210, height: 297, description: '210 x 297 mm (Relazioni, Verbali)' },
    A3: { width: 297, height: 420, description: '297 x 420 mm (P&ID, Schemi, Planimetrie medie)' },
    A2: { width: 420, height: 594, description: '420 x 594 mm (Progetti esecutivi, Piping)' },
    A1: { width: 594, height: 841, description: '594 x 841 mm (Tavole di cantiere, Carpenterie)' },
    A0: { width: 841, height: 1189, description: '841 x 1189 mm (Planimetrie generali, Masterplan)' },
    Letter: { width: 215.9, height: 279.4, description: '8.5 x 11 pollici (Standard USA)' },
    Tabloid: { width: 279.4, height: 431.8, description: '11 x 17 pollici (Ledger)' },
    ArchD: { width: 609.6, height: 914.4, description: '24 x 36 pollici (Architettura USA)' },
    ArchE: { width: 914.4, height: 1219.2, description: '36 x 48 pollici (Grande formato USA)' },
  };

  public static async createBlankDocument(options: BlankPdfOptions): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const mmDim = this.FORMAT_DIMENSIONS_MM[options.format] || this.FORMAT_DIMENSIONS_MM.A3;

    let widthPt = mmDim.width * this.MM_TO_PT;
    let heightPt = mmDim.height * this.MM_TO_PT;

    if (options.orientation === 'landscape') {
      if (widthPt < heightPt) {
        const tmp = widthPt;
        widthPt = heightPt;
        heightPt = tmp;
      }
    } else {
      if (widthPt > heightPt) {
        const tmp = widthPt;
        widthPt = heightPt;
        heightPt = tmp;
      }
    }

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const margin = 10 * this.MM_TO_PT; // 10mm margine standard
    const bindingMargin = 20 * this.MM_TO_PT; // 20mm margine sinistro per archiviazione/rilegatura

    for (let i = 0; i < Math.max(1, options.pageCount); i++) {
      const page = pdfDoc.addPage([widthPt, heightPt]);

      // Griglia CAD leggera opzionale
      if (options.gridStyle === 'cad_grid') {
        const step = 50; // ogni 50 pt
        for (let x = bindingMargin; x < widthPt - margin; x += step) {
          page.drawLine({
            start: { x, y: margin },
            end: { x, y: heightPt - margin },
            color: rgb(0.92, 0.92, 0.94),
            thickness: 0.4,
          });
        }
        for (let y = margin; y < heightPt - margin; y += step) {
          page.drawLine({
            start: { x: bindingMargin, y },
            end: { x: widthPt - margin, y },
            color: rgb(0.92, 0.92, 0.94),
            thickness: 0.4,
          });
        }
      }

      // Squadratura tecnica (Border UNI / ISO)
      if (options.includeBorder) {
        page.drawRectangle({
          x: bindingMargin,
          y: margin,
          width: widthPt - bindingMargin - margin,
          height: heightPt - margin * 2,
          borderWidth: 1.5,
          borderColor: rgb(0.12, 0.12, 0.12),
        });

        // Cartiglio Tecnico Standard Ingegneria (in basso a destra)
        if (options.includeTitleBlock) {
          const tbWidth = Math.min(widthPt - bindingMargin - margin, 185 * this.MM_TO_PT); // 185 mm standard ISO
          const tbHeight = 45 * this.MM_TO_PT; // 45 mm altezza
          const tbX = widthPt - margin - tbWidth;
          const tbY = margin;

          page.drawRectangle({
            x: tbX,
            y: tbY,
            width: tbWidth,
            height: tbHeight,
            borderWidth: 1.2,
            borderColor: rgb(0.12, 0.12, 0.12),
            color: rgb(0.98, 0.98, 0.98),
          });

          // Divisione orizzontale cartiglio
          page.drawLine({
            start: { x: tbX, y: tbY + tbHeight * 0.55 },
            end: { x: tbX + tbWidth, y: tbY + tbHeight * 0.55 },
            thickness: 0.8,
            color: rgb(0.2, 0.2, 0.2),
          });

          // Testi cartiglio
          page.drawText(options.title || 'PROGETTO TECNICO ESECUTIVO', {
            x: tbX + 10,
            y: tbY + tbHeight - 16,
            size: 11,
            font: fontBold,
            color: rgb(0.1, 0.1, 0.1),
          });

          page.drawText(
            `FORMATO: ${options.format} (${options.orientation.toUpperCase()}) | SCALA: 1:1 | REV: 00`,
            {
              x: tbX + 10,
              y: tbY + tbHeight - 30,
              size: 8.5,
              font: font,
              color: rgb(0.3, 0.3, 0.3),
            }
          );

          page.drawText(
            `AUTORE: ${options.author || 'OpenRevu CAD'} | DATA: ${new Date().toLocaleDateString('it-IT')} | TAVOLA ${i + 1} DI ${options.pageCount}`,
            {
              x: tbX + 10,
              y: tbY + 8,
              size: 8,
              font: font,
              color: rgb(0.4, 0.4, 0.4),
            }
          );
        }
      }
    }

    return await pdfDoc.save();
  }
}
