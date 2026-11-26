import { HatchPattern } from '@/types/markup';

export class HatchRenderer {
  /**
   * Disegna una campitura/retino tecnico all'interno del contesto Canvas già clippato,
   * rispettando esattamente la Scala del retino (passo tratteggio) e l'Angolo di inclinazione (Stile Bluebeam Revu).
   */
  public static renderHatch(
    ctx: CanvasRenderingContext2D,
    pattern: HatchPattern | undefined,
    bounds: { x: number; y: number; width: number; height: number },
    color: string = '#ff0000',
    scale: number = 1.0,
    opacity: number = 0.5,
    angleDeg: number = 0
  ) {
    if (!pattern || pattern === 'none' || pattern === 'solid') return;

    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0.05, opacity));
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, 1.2 * Math.min(2, scale || 1.0));
    ctx.setLineDash([]);

    const { x, y, width, height } = bounds;
    const cx = x + width / 2;
    const cy = y + height / 2;

    // Se c'è un angolo personalizzato (Bluebeam Hatch Angle), ruota il piano di campitura attorno al centro
    if (angleDeg !== 0) {
      ctx.translate(cx, cy);
      ctx.rotate((angleDeg * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    // Scala campitura (passo del tratteggio in pt)
    const hatchStep = Math.max(3, Math.floor(10 * (scale || 1.0)));
    const diag = Math.sqrt(width * width + height * height) * 1.5;
    const minD = -diag;
    const maxD = diag * 2;

    switch (pattern) {
      case 'diagonal_right': // ANSI31 (45° tratteggio standard)
        ctx.beginPath();
        for (let d = minD; d <= maxD; d += hatchStep) {
          ctx.moveTo(cx + d - diag, cy - diag);
          ctx.lineTo(cx + d + diag, cy + diag);
        }
        ctx.stroke();
        break;

      case 'diagonal_left': // 135° tratteggio inclinato opposto
        ctx.beginPath();
        for (let d = minD; d <= maxD; d += hatchStep) {
          ctx.moveTo(cx + d + diag, cy - diag);
          ctx.lineTo(cx + d - diag, cy + diag);
        }
        ctx.stroke();
        break;

      case 'crosshatch': // ANSI37 (Tratteggio incrociato a quadretti)
        ctx.beginPath();
        for (let d = minD; d <= maxD; d += hatchStep) {
          ctx.moveTo(cx + d - diag, cy - diag);
          ctx.lineTo(cx + d + diag, cy + diag);
          ctx.moveTo(cx + d + diag, cy - diag);
          ctx.lineTo(cx + d - diag, cy + diag);
        }
        ctx.stroke();
        break;

      case 'horizontal': // Linee orizzontali parallele
        ctx.beginPath();
        for (let curY = cy - diag; curY <= cy + diag; curY += hatchStep) {
          ctx.moveTo(cx - diag, curY);
          ctx.lineTo(cx + diag, curY);
        }
        ctx.stroke();
        break;

      case 'vertical': // Linee verticali parallele
        ctx.beginPath();
        for (let curX = cx - diag; curX <= cx + diag; curX += hatchStep) {
          ctx.moveTo(curX, cy - diag);
          ctx.lineTo(curX, cy + diag);
        }
        ctx.stroke();
        break;

      case 'brick': // Muratura / Mattoni sfalsati
        const rowH = Math.max(5, hatchStep * 0.8);
        const brickW = rowH * 2.2;
        let rowIdx = 0;
        ctx.beginPath();
        for (let curY = cy - diag; curY <= cy + diag; curY += rowH) {
          ctx.moveTo(cx - diag, curY);
          ctx.lineTo(cx + diag, curY);
          const offset = (rowIdx % 2) * (brickW / 2);
          for (let curX = cx - diag + offset; curX <= cx + diag; curX += brickW) {
            ctx.moveTo(curX, curY);
            ctx.lineTo(curX, curY + rowH);
          }
          rowIdx++;
        }
        ctx.stroke();
        break;

      case 'dots': // Calcestruzzo / Punti / Ghiaia
        const dotStep = Math.max(5, hatchStep * 0.9);
        for (let curY = cy - diag; curY <= cy + diag; curY += dotStep) {
          for (let curX = cx - diag; curX <= cx + diag; curX += dotStep) {
            ctx.fillRect(curX, curY, 1.4, 1.4);
          }
        }
        break;

      case 'zigzag': // Isolamento / Terreno
        const zzW = Math.max(6, hatchStep);
        ctx.beginPath();
        for (let curY = cy - diag; curY <= cy + diag; curY += hatchStep) {
          let up = true;
          ctx.moveTo(cx - diag, curY);
          for (let curX = cx - diag; curX <= cx + diag; curX += zzW) {
            ctx.lineTo(curX + zzW / 2, curY + (up ? -zzW / 3 : zzW / 3));
            up = !up;
          }
        }
        ctx.stroke();
        break;
    }

    ctx.restore();
  }
}
