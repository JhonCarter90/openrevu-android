import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export class SamplePdfGenerator {
  /**
   * Genera un disegno tecnico di esempio (Formato A3 Orizzontale: 1191 x 842 pt)
   * con squadratura, cartiglio ingegneristico, griglia di riferimento e layout impiantistico
   */
  public static async generateSampleDrawing(): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    // A3 Landscape: 1190.55 x 841.89 points
    const page = pdfDoc.addPage([1190.55, 841.89]);
    const { width, height } = page.getSize();

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // 1. Squadratura esterna e interna
    const margin = 28.35; // 10 mm
    page.drawRectangle({
      x: margin,
      y: margin,
      width: width - margin * 2,
      height: height - margin * 2,
      borderColor: rgb(0.1, 0.1, 0.1),
      borderWidth: 2,
    });

    // 2. Griglia di riferimento CAD (linee tenui ogni 100 pt)
    for (let x = margin + 50; x < width - margin; x += 100) {
      page.drawLine({
        start: { x, y: margin },
        end: { x, y: height - margin },
        color: rgb(0.9, 0.9, 0.92),
        thickness: 0.5,
      });
    }
    for (let y = margin + 50; y < height - margin; y += 100) {
      page.drawLine({
        start: { x: margin, y },
        end: { x: width - margin, y },
        color: rgb(0.9, 0.9, 0.92),
        thickness: 0.5,
      });
    }

    // 3. Cartiglio Tecnico Ingegneristico (Bottom-Right)
    const tbWidth = 360;
    const tbHeight = 120;
    const tbX = width - margin - tbWidth;
    const tbY = margin;

    page.drawRectangle({
      x: tbX,
      y: tbY,
      width: tbWidth,
      height: tbHeight,
      borderColor: rgb(0.1, 0.1, 0.1),
      borderWidth: 1.5,
      color: rgb(0.98, 0.98, 0.98),
    });

    page.drawLine({
      start: { x: tbX, y: tbY + 60 },
      end: { x: tbX + tbWidth, y: tbY + 60 },
      color: rgb(0.2, 0.2, 0.2),
      thickness: 1,
    });

    page.drawText('PROGETTO IMPIANTO INDUSTRIALE - BUCHARA SECT. 4', {
      x: tbX + 15,
      y: tbY + 95,
      size: 11,
      font: fontBold,
      color: rgb(0.05, 0.05, 0.05),
    });

    page.drawText('TAVOLA: SCHEMA P&ID - COMPRESSORI & CONDOTTE PIPING', {
      x: tbX + 15,
      y: tbY + 75,
      size: 10,
      font: font,
      color: rgb(0.2, 0.2, 0.2),
    });

    page.drawText('SCALA GRAFICA: 1:50 | FORMATO: ISO A3 | REVISIONE: 02', {
      x: tbX + 15,
      y: tbY + 40,
      size: 9,
      font: fontBold,
      color: rgb(0.0, 0.47, 0.83),
    });

    page.drawText('DISEGNATORE: F. FERRERI | DATA: 10/11/2026 | STATO: FOR CONSTRUCTION', {
      x: tbX + 15,
      y: tbY + 20,
      size: 8,
      font: font,
      color: rgb(0.3, 0.3, 0.3),
    });

    // 4. Geometrie CAD di Esempio (Piping, Serbatoi, Valvole)
    // Serbatoio / Colonna Verticale (Tanks/Vessels)
    page.drawRectangle({
      x: 180,
      y: 350,
      width: 140,
      height: 280,
      borderColor: rgb(0.1, 0.2, 0.4),
      borderWidth: 2,
      color: rgb(0.95, 0.97, 1.0),
    });
    page.drawText('VESSEL V-101', {
      x: 215,
      y: 490,
      size: 12,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4),
    });

    // Linee di piping principali
    page.drawLine({
      start: { x: 320, y: 550 },
      end: { x: 550, y: 550 },
      color: rgb(0.8, 0.1, 0.1),
      thickness: 3,
    });
    page.drawText('LINE 12"-P-401-CS', {
      x: 380,
      y: 560,
      size: 9,
      font: fontBold,
      color: rgb(0.8, 0.1, 0.1),
    });

    page.drawLine({
      start: { x: 550, y: 550 },
      end: { x: 550, y: 350 },
      color: rgb(0.8, 0.1, 0.1),
      thickness: 3,
    });

    // Compressore / Pompa
    page.drawCircle({
      x: 550,
      y: 300,
      size: 45,
      borderColor: rgb(0.1, 0.4, 0.1),
      borderWidth: 2,
      color: rgb(0.93, 0.98, 0.93),
    });
    page.drawText('PUMP P-102A', {
      x: 515,
      y: 295,
      size: 9,
      font: fontBold,
      color: rgb(0.1, 0.4, 0.1),
    });

    // Barra metrica di riferimento (per test calibrazione 200 mm = 200 pt)
    const barX = 180;
    const barY = 200;
    const barWidth = 283.46; // 100 mm esatti a 72 DPI (100 / 25.4 * 72)
    page.drawLine({
      start: { x: barX, y: barY },
      end: { x: barX + barWidth, y: barY },
      color: rgb(0, 0, 0),
      thickness: 2,
    });
    page.drawLine({
      start: { x: barX, y: barY - 6 },
      end: { x: barX, y: barY + 6 },
      color: rgb(0, 0, 0),
      thickness: 2,
    });
    page.drawLine({
      start: { x: barX + barWidth, y: barY - 6 },
      end: { x: barX + barWidth, y: barY + 6 },
      color: rgb(0, 0, 0),
      thickness: 2,
    });
    page.drawText('BARRA DI RIFERIMENTO CALIBRAZIONE: 100 mm', {
      x: barX + 35,
      y: barY + 8,
      size: 8,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    return await pdfDoc.save();
  }
}
