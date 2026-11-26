import { LineStyle, Point2D } from '@/types/markup';

export class LineStyleHelper {
  /**
   * Applica il tratteggio o stile linea sul contesto Canvas 2D scalato per lineStyleScale (stile Bluebeam)
   */
  public static applyLineStyle(
    ctx: CanvasRenderingContext2D,
    style?: LineStyle,
    strokeWidth: number = 2,
    lineStyleScale: number = 1.0
  ) {
    if (!style || style === 'solid') {
      ctx.setLineDash([]);
      return;
    }

    const scale = Math.max(0.1, lineStyleScale || 1.0);
    const sw = Math.max(0.15, strokeWidth) * scale;

    switch (style) {
      case 'dashed':
        ctx.setLineDash([sw * 4, sw * 2.5]);
        break;
      case 'dotted':
        ctx.setLineDash([sw * 1.2, sw * 2]);
        break;
      case 'dash_dot':
        ctx.setLineDash([sw * 6, sw * 2.5, sw * 1.5, sw * 2.5]);
        break;
      case 'dash_dot_dot':
        ctx.setLineDash([sw * 6, sw * 2, sw * 1.5, sw * 1.5, sw * 1.5, sw * 2]);
        break;
      case 'long_dash':
        ctx.setLineDash([sw * 9, sw * 3]);
        break;
      case 'electric_signal':
        // Segnale elettrico ISA 5.1 (- - - -)
        ctx.setLineDash([sw * 3.5, sw * 2.5]);
        break;
      case 'electromagnetic':
        // Segnale elettromagnetico / sonico
        ctx.setLineDash([sw * 2, sw * 2]);
        break;
      case 'pneumatic':
      case 'hydraulic':
      case 'capillary':
      case 'data_link':
      case 'heat_traced':
        // Linea continua con marcatori ISA lungo il segmento
        ctx.setLineDash([]);
        break;
      case 'gas':
      case 'water':
      case 'hot_water':
      case 'steam':
      case 'drain':
        // Tratteggio per tubazioni industriali con etichetta centrata
        ctx.setLineDash([sw * 12, sw * 10]);
        break;
      default:
        ctx.setLineDash([]);
        break;
    }
  }

  /**
   * Disegna l'etichetta piping orientata lungo la linea per tubazioni P&ID
   */
  public static renderPipingLabel(
    ctx: CanvasRenderingContext2D,
    p1: Point2D,
    p2: Point2D,
    style?: LineStyle,
    color: string = '#0078d4',
    lineStyleScale: number = 1.0
  ) {
    if (!style) return;

    // Marcatori ripetuti per linee segnale ISA 5.1 (Pneumatico //, Idraulico L, Capillare x, Dati o, Tracciata T)
    const isaMarkers: Record<string, string> = {
      pneumatic: '//',
      hydraulic: 'L',
      capillary: '×',
      data_link: '○',
      heat_traced: 'T',
      electromagnetic: '~',
    };
    const marker = isaMarkers[style];
    if (marker) {
      const scale = Math.max(0.5, Math.min(2.5, lineStyleScale || 1.0));
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 16) return;
      const step = 42 * scale;
      const count = Math.max(1, Math.floor(dist / step));
      let angle = Math.atan2(dy, dx);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;

      ctx.save();
      ctx.font = `bold ${Math.round(9 * scale)}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 1; i <= count; i++) {
        const t = i / (count + 1);
        const mx = p1.x + dx * t;
        const my = p1.y + dy * t;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(angle);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-5 * scale, -5 * scale, 10 * scale, 10 * scale);
        ctx.fillStyle = color;
        ctx.fillText(marker, 0, 0);
        ctx.restore();
      }
      ctx.restore();
      return;
    }

    const labels: Record<string, string> = {
      gas: 'GAS',
      water: 'CW',
      hot_water: 'HW',
      steam: 'STEAM',
      drain: 'DRAIN',
    };
    const text = labels[style];
    if (!text) return;

    const scale = Math.max(0.4, Math.min(3, lineStyleScale || 1.0));
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 40 * scale) return; // Se la linea è troppo corta per l'etichetta, salta

    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    let angle = Math.atan2(dy, dx);

    // Evita testo capovolto
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
      angle += Math.PI;
    }

    ctx.save();
    ctx.translate(midX, midY);
    ctx.rotate(angle);
    ctx.font = `bold ${Math.round(8.5 * scale)}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textW = ctx.measureText(text).width + 8 * scale;
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(-textW / 2, -6 * scale, textW, 12 * scale);

    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}
