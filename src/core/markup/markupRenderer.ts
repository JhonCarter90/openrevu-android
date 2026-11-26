import { AnyMarkup, CloudMarkup, CloudPlusMarkup, RectangleMarkup, EllipseMarkup, CalloutMarkup, TextMarkup, LineMarkup, PolylineMarkup, PolygonMarkup, MeasureLengthMarkup, MeasurePolylineMarkup, MeasureAreaMarkup, MeasureCountMarkup, StampMarkup, ScaleCalibration, Point2D, LineEnding } from '@/types/markup';
import { CloudGenerator } from './cloudGenerator';
import { ScaleManager } from '../scale/scaleManager';
import { HatchRenderer } from './hatchRenderer';
import { LineStyleHelper } from './lineStyleHelper';
import { TextLayoutHelper } from './textLayoutHelper';

export class MarkupRenderer {
  public static renderMarkup(
    ctx: CanvasRenderingContext2D,
    markup: AnyMarkup,
    isSelected: boolean,
    scaleCalibration?: ScaleCalibration | null,
    zoom: number = 1.0
  ) {
    const rotDeg = (markup as any).rotation || 0;
    const boxForRot = (markup as any).boxRect as { x: number; y: number; width: number; height: number } | undefined;
    const shouldRotateCtx = Boolean(rotDeg && boxForRot && markup.type !== 'stamp');

    if (shouldRotateCtx && boxForRot) {
      const cx = boxForRot.x + boxForRot.width / 2;
      const cy = boxForRot.y + boxForRot.height / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rotDeg * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    // 0. Supporto simboli composti Bluebeam P&ID (BTX / Tool Chest)
    if (markup.compoundPaths && markup.compoundPaths.length > 0) {
      this.renderCompoundMarkup(ctx, markup);
      if (shouldRotateCtx) ctx.restore();
      if (isSelected) {
        this.renderSelectionHandles(ctx, markup, zoom);
      }
      return;
    }

    switch (markup.type) {
      case 'cloud':
      case 'cloud_rect':
        this.renderCloud(ctx, markup as CloudMarkup);
        break;
      case 'cloud_plus':
        this.renderCloudPlus(ctx, markup as CloudPlusMarkup);
        break;
      case 'rectangle':
        this.renderRectangle(ctx, markup as RectangleMarkup, isSelected);
        break;
      case 'ellipse':
        this.renderEllipse(ctx, markup as EllipseMarkup);
        break;
      case 'callout':
        this.renderCallout(ctx, markup as CalloutMarkup);
        break;
      case 'textbox':
        this.renderTextBox(ctx, markup as TextMarkup);
        break;
      case 'line':
      case 'arrow':
        this.renderLineOrArrow(ctx, markup as LineMarkup);
        break;
      case 'polyline':
        this.renderPolyline(ctx, markup as PolylineMarkup);
        break;
      case 'pen':
      case 'highlighter':
        this.renderPenOrHighlighter(ctx, markup as any);
        break;
      case 'polygon':
        this.renderPolygon(ctx, markup as PolygonMarkup);
        break;
      case 'measure_length':
        this.renderMeasureLength(ctx, markup as MeasureLengthMarkup, scaleCalibration);
        break;
      case 'measure_polyline':
        this.renderMeasurePolyline(ctx, markup as MeasurePolylineMarkup, scaleCalibration);
        break;
      case 'measure_area':
      case 'measure_area_rect':
        this.renderMeasureArea(ctx, markup as MeasureAreaMarkup, scaleCalibration);
        break;
      case 'measure_count':
        this.renderMeasureCount(ctx, markup as MeasureCountMarkup);
        break;
      case 'stamp':
        this.renderStamp(ctx, markup as StampMarkup);
        break;
      case 'hyperlink':
        this.renderHyperlink(ctx, markup as any, isSelected);
        break;
    }

    if (shouldRotateCtx) {
      ctx.restore();
    }

    if (isSelected) {
      this.renderSelectionHandles(ctx, markup, zoom);
    }
  }

  private static renderHyperlink(ctx: CanvasRenderingContext2D, m: any, isSelected: boolean = false) {
    if (!m.boxRect) return;
    const { x, y, width, height } = m.boxRect;
    ctx.save();
    ctx.fillStyle = m.fillColor || '#3b82f6';
    ctx.globalAlpha = isSelected ? 0.28 : (m.fillOpacity ?? 0.14);
    ctx.fillRect(x, y, width, height);

    ctx.globalAlpha = m.opacity ?? 0.9;
    ctx.strokeStyle = m.strokeColor || '#3b82f6';
    ctx.lineWidth = Math.max(1, m.strokeWidth || 1.2);
    ctx.strokeRect(x, y, width, height);

    // Piccolo badge discreto nell'angolo in alto a sinistra
    const label =
      m.actionType === 'goto_page' && m.targetPage
        ? `🔗 P.${m.targetPage}`
        : m.actionType === 'url'
        ? '🔗 URL'
        : '🔗 Link';
    ctx.font = 'bold 8px Segoe UI, Arial, sans-serif';
    const textW = ctx.measureText(label).width;
    const badgeW = textW + 6;
    const badgeH = 12;
    ctx.fillStyle = '#0078d4';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, Math.max(0, y - badgeH), badgeW, badgeH);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 3, Math.max(6, y - badgeH / 2));
    ctx.restore();
  }

  private static renderRectangle(ctx: CanvasRenderingContext2D, m: RectangleMarkup, isSelected: boolean = false) {
    if (!m.boxRect) return;
    ctx.save();
    ctx.globalAlpha = m.opacity;
    const x = Math.min(m.boxRect.x, m.boxRect.x + m.boxRect.width);
    const y = Math.min(m.boxRect.y, m.boxRect.y + m.boxRect.height);
    const width = Math.abs(m.boxRect.width);
    const height = Math.abs(m.boxRect.height);
    const normBox = { x, y, width, height };

    // Caso speciale: Nota / Sticky Note PDF (Stile Bluebeam Comment Icon)
    if (
      m.subject === 'Nota / Commento' ||
      m.subject === 'Nota' ||
      m.subject === 'Sticky Note' ||
      (m.subject === 'Commento testo' && m.strokeWidth > 0)
    ) {
      const fold = Math.min(6, width * 0.28);
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = m.fillColor || '#ffc100';
      ctx.strokeStyle = m.strokeColor || '#8c6200';
      ctx.lineWidth = 1.2;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width - fold, y);
      ctx.lineTo(x + width, y + fold);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Angolo piegato
      ctx.beginPath();
      ctx.moveTo(x + width - fold, y);
      ctx.lineTo(x + width - fold, y + fold);
      ctx.lineTo(x + width, y + fold);
      ctx.stroke();

      // Righe interne icona commento
      ctx.strokeStyle = '#5c4000';
      ctx.lineWidth = 1.2;
      const lineX1 = x + width * 0.22;
      const lineX2 = x + width * 0.78;
      for (const ry of [0.38, 0.56, 0.74]) {
        ctx.beginPath();
        ctx.moveTo(lineX1, y + height * ry);
        ctx.lineTo(ry === 0.74 ? x + width * 0.6 : lineX2, y + height * ry);
        ctx.stroke();
      }

      // Se selezionata e ha commento, mostra il fumetto con autore e testo
      if (isSelected && m.contents) {
        const commentText = `${m.author ? m.author + ': ' : ''}${m.contents}`;
        ctx.font = 'bold 10px Segoe UI, Arial, sans-serif';
        const textW = Math.min(340, Math.max(120, ctx.measureText(commentText).width + 16));
        const bx = x + width + 6;
        const by = y - 4;
        ctx.fillStyle = '#fffbe6';
        ctx.strokeStyle = '#d4a000';
        ctx.lineWidth = 1.2;
        ctx.fillRect(bx, by, textW, 24);
        ctx.strokeRect(bx, by, textW, 24);
        ctx.fillStyle = '#1e1e1e';
        ctx.textBaseline = 'middle';
        ctx.fillText(commentText.slice(0, 65) + (commentText.length > 65 ? '...' : ''), bx + 6, by + 12);
      }

      ctx.restore();
      ctx.restore();
      return;
    }

    // 1. Colore di sfondo pieno (con multiply per Evidenziatore così il testo nero sottostante resta nitido)
    if (m.fillColor && m.fillColor !== 'transparent') {
      ctx.save();
      if (
        m.subject === 'Evidenziatore' ||
        m.subject === 'Evidenziato' ||
        m.subject === 'Highlight' ||
        m.strokeWidth === 0
      ) {
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = m.fillOpacity ?? 0.45;
      } else {
        ctx.globalAlpha = m.fillOpacity ?? 1;
      }
      ctx.fillStyle = m.fillColor;
      ctx.fillRect(x, y, width, height);
      ctx.restore();
    }

    // 2. Retino / Campitura tecnica (se specificata)
    if (m.hatchPattern && m.hatchPattern !== 'none' && m.hatchPattern !== 'solid' && width > 0 && height > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      HatchRenderer.renderHatch(
        ctx,
        m.hatchPattern,
        normBox,
        m.hatchColor || m.strokeColor,
        m.hatchScale || 1,
        m.fillOpacity ?? 0.5,
        m.hatchAngle || 0
      );
      ctx.restore();
    }

    // 3. Bordo con stile linea CAD
    if (m.strokeWidth > 0) {
      ctx.strokeStyle = m.strokeColor;
      ctx.lineWidth = m.strokeWidth;
      LineStyleHelper.applyLineStyle(ctx, m.lineStyle, m.strokeWidth, m.lineStyleScale);
      ctx.strokeRect(x, y, width, height);
    }
    ctx.restore();
  }

  private static renderEllipse(ctx: CanvasRenderingContext2D, m: EllipseMarkup) {
    if (!m.boxRect) return;
    ctx.save();
    ctx.globalAlpha = m.opacity;
    const normX = Math.min(m.boxRect.x, m.boxRect.x + m.boxRect.width);
    const normY = Math.min(m.boxRect.y, m.boxRect.y + m.boxRect.height);
    const normW = Math.abs(m.boxRect.width);
    const normH = Math.abs(m.boxRect.height);
    const cx = normX + normW / 2;
    const cy = normY + normH / 2;
    const rx = normW / 2;
    const ry = normH / 2;
    const normBox = { x: normX, y: normY, width: normW, height: normH };

    // 1. Colore di sfondo
    if (m.fillColor && m.fillColor !== 'transparent' && rx > 0 && ry > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.globalAlpha = m.fillOpacity ?? 1;
      ctx.fillStyle = m.fillColor;
      ctx.fill();
      ctx.restore();
    }

    // 2. Retino / Campitura con clipping
    if (m.hatchPattern && m.hatchPattern !== 'none' && m.hatchPattern !== 'solid' && rx > 0 && ry > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      HatchRenderer.renderHatch(
        ctx,
        m.hatchPattern,
        normBox,
        m.hatchColor || m.strokeColor,
        m.hatchScale || 1,
        m.fillOpacity ?? 0.5,
        m.hatchAngle || 0
      );
      ctx.restore();
    }

    // 3. Bordo con stile linea
    if (m.strokeWidth > 0 && rx > 0 && ry > 0) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = m.strokeColor;
      ctx.lineWidth = m.strokeWidth;
      LineStyleHelper.applyLineStyle(ctx, m.lineStyle, m.strokeWidth, m.lineStyleScale);
      ctx.stroke();
    }
    ctx.restore();
  }

  private static renderCloud(ctx: CanvasRenderingContext2D, m: CloudMarkup) {
    if (m.points.length < 3) return;
    const arcs = CloudGenerator.generateCloudArcs(m.points, m.arcRadius || 24);
    CloudGenerator.drawCloudOnCanvas(
      ctx,
      arcs,
      m.strokeColor,
      m.strokeWidth,
      m.fillColor,
      m.opacity,
      m.fillOpacity ?? 0.3,
      m.hatchPattern,
      m.hatchColor || m.strokeColor,
      m.hatchScale || 1
    );
  }

  private static closestPointOnPolygonPerimeter(poly: Point2D[], pt: Point2D): Point2D {
    let best = poly[0];
    let minD = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      let t = 0;
      if (lenSq > 0) {
        t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
      }
      const proj = { x: a.x + t * dx, y: a.y + t * dy };
      const d = Math.hypot(pt.x - proj.x, pt.y - proj.y);
      if (d < minD) {
        minD = d;
        best = proj;
      }
    }
    return best;
  }

  public static getCloudPlusGeometry(m: CloudPlusMarkup): {
    targetX: number;
    targetY: number;
    elbowX: number;
    elbowY: number;
    leader: Point2D;
  } {
    const box = m.boxRect;
    const boxCenterX = box.x + box.width / 2;
    const boxCenterY = box.y + box.height / 2;

    let cloudCenterX = m.leaderPoint.x;
    if (m.cloudPoints && m.cloudPoints.length > 0) {
      cloudCenterX =
        m.cloudPoints.reduce((acc, p) => acc + p.x, 0) / m.cloudPoints.length;
    }

    const refX = m.elbowPoint ? m.elbowPoint.x : cloudCenterX;
    const isBoxRight = boxCenterX >= refX;
    const targetX = isBoxRight ? box.x : box.x + box.width;
    const targetY = boxCenterY;

    const elbowX = m.elbowPoint
      ? m.elbowPoint.x
      : isBoxRight
      ? Math.max(refX, box.x - 16)
      : Math.min(refX, box.x + box.width + 16);
    const elbowY = m.elbowPoint ? m.elbowPoint.y : boxCenterY;

    const leader =
      m.cloudPoints && m.cloudPoints.length >= 3
        ? this.closestPointOnPolygonPerimeter(m.cloudPoints, { x: elbowX, y: elbowY })
        : m.leaderPoint;

    return { targetX, targetY, elbowX, elbowY, leader };
  }

  private static renderCloudPlus(ctx: CanvasRenderingContext2D, m: CloudPlusMarkup) {
    if (m.cloudPoints && m.cloudPoints.length >= 3) {
      const arcs = CloudGenerator.generateCloudArcs(m.cloudPoints, 20);
      CloudGenerator.drawCloudOnCanvas(
        ctx,
        arcs,
        m.strokeColor,
        m.strokeWidth,
        m.fillColor,
        m.opacity,
        m.fillOpacity ?? 0.3,
        m.hatchPattern,
        m.hatchColor || m.strokeColor,
        m.hatchScale || 1
      );
    }

    ctx.save();
    ctx.globalAlpha = m.opacity;

    const box = m.boxRect;
    const { targetX, targetY, elbowX, elbowY, leader } = this.getCloudPlusGeometry(m);

    // Disegna linea direttrice
    ctx.strokeStyle = m.strokeColor;
    ctx.lineWidth = m.strokeWidth;
    this.applyLineStyle(ctx, m.lineStyle);

    ctx.beginPath();
    ctx.moveTo(leader.x, leader.y);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();

    // Box di testo (riempimento separato da quello della nuvola)
    ctx.setLineDash([]);
    const textBg = (m as any).textFillColor;
    if (textBg && textBg !== 'transparent') {
      ctx.save();
      ctx.globalAlpha = m.opacity * ((m as any).textFillOpacity ?? 1);
      ctx.fillStyle = textBg;
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.restore();
    }
    const hasBoxStroke = m.strokeWidth > 0 && m.strokeColor && m.strokeColor !== 'transparent';
    if (hasBoxStroke) {
      ctx.strokeStyle = m.strokeColor;
      ctx.lineWidth = m.strokeWidth;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
    }

    // Testo formattato all'interno con adattamento e allineamento (TextLayoutHelper)
    TextLayoutHelper.renderFormattedText(
      ctx,
      m.text || m.contents || '',
      box,
      {
        fontSize: m.fontSize || 11,
        fontFamily: m.fontFamily || 'Arial, sans-serif',
        fontWeight: (m as any).fontWeight || 'normal',
        fontStyle: (m as any).fontStyle || 'normal',
        textColor: (m as any).textColor || m.strokeColor || '#000000',
        textAlign: m.textAlign || 'left',
        verticalAlign: m.verticalAlign || 'top',
        paddingX: 6,
        paddingY: 6,
      }
    );

    ctx.restore();
  }

  private static applyLineStyle(ctx: CanvasRenderingContext2D, style?: string) {
    switch (style) {
      case 'dashed':
        ctx.setLineDash([8, 5]);
        break;
      case 'dotted':
        ctx.setLineDash([2, 4]);
        break;
      case 'dash_dot':
        ctx.setLineDash([10, 4, 2, 4]);
        break;
      default:
        ctx.setLineDash([]);
        break;
    }
  }

  public static getCalloutGeometry(m: CalloutMarkup): {
    targetX: number;
    targetY: number;
    elbowX: number;
    elbowY: number;
    arrows: Point2D[];
  } {
    const box = m.boxRect;
    const arrow = m.arrowPoint;
    const boxCenterX = box.x + box.width / 2;
    const boxCenterY = box.y + box.height / 2;

    const refX = m.elbowPoint ? m.elbowPoint.x : arrow.x;
    const isBoxRight = boxCenterX >= refX;
    const targetX = isBoxRight ? box.x : box.x + box.width;
    const targetY = boxCenterY;

    const elbowX = m.elbowPoint
      ? m.elbowPoint.x
      : isBoxRight
      ? Math.max(arrow.x, box.x - 16)
      : Math.min(arrow.x, box.x + box.width + 16);
    const elbowY = m.elbowPoint ? m.elbowPoint.y : boxCenterY;

    const arrows: Point2D[] = [arrow, ...(m.extraArrows || [])];
    return { targetX, targetY, elbowX, elbowY, arrows };
  }

  private static renderCallout(ctx: CanvasRenderingContext2D, m: CalloutMarkup) {
    ctx.save();
    ctx.globalAlpha = m.opacity;

    const box = m.boxRect;
    const { targetX, targetY, elbowX, elbowY, arrows } = this.getCalloutGeometry(m);

    // Disegna linea direttrice + gomito orizzontale (Leader & Landing) per tutte le frecce
    const leaderColor =
      m.strokeColor && m.strokeColor !== 'transparent'
        ? m.strokeColor
        : (m as any).textColor || '#ff0000';
    const leaderWidth = Math.max(1, m.strokeWidth || 1);
    ctx.strokeStyle = leaderColor;
    ctx.lineWidth = leaderWidth;
    this.applyLineStyle(ctx, m.lineStyle);

    ctx.beginPath();
    ctx.moveTo(targetX, targetY);
    ctx.lineTo(elbowX, elbowY);
    for (const tip of arrows) {
      ctx.moveTo(elbowX, elbowY);
      ctx.lineTo(tip.x, tip.y);
    }
    ctx.stroke();

    // Punte delle frecce su ciascuna direttrice
    ctx.setLineDash([]);
    const headLen = Math.max(10, leaderWidth * 3 + 6);
    for (const tip of arrows) {
      const arrowAngle = Math.atan2(elbowY - tip.y, elbowX - tip.x);
      this.drawArrowHead(ctx, tip, arrowAngle, leaderColor, headLen);
    }

    // Box di testo con sfondo (se non trasparente) e bordo (solo se contorno attivo)
    if (m.fillColor && m.fillColor !== 'transparent') {
      ctx.save();
      ctx.globalAlpha = m.fillOpacity !== undefined ? m.fillOpacity : 1;
      ctx.fillStyle = m.fillColor;
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.restore();
    }
    const hasBoxStroke = m.strokeWidth > 0 && m.strokeColor && m.strokeColor !== 'transparent';
    if (hasBoxStroke) {
      ctx.strokeStyle = m.strokeColor;
      ctx.lineWidth = m.strokeWidth;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
    }

    // Testo interno formattato con adattamento e allineamento (TextLayoutHelper)
    const resolvedCalloutTextColor =
      (m as any).textColor ||
      (m.strokeColor && m.strokeColor !== 'transparent' ? m.strokeColor : '#000000');
    TextLayoutHelper.renderFormattedText(
      ctx,
      m.text || m.contents || '',
      box,
      {
        fontSize: m.fontSize || 11,
        fontFamily: m.fontFamily || 'Arial, sans-serif',
        fontWeight: (m as any).fontWeight || 'normal',
        fontStyle: (m as any).fontStyle || 'normal',
        textColor: resolvedCalloutTextColor,
        textAlign: m.textAlign || 'left',
        verticalAlign: m.verticalAlign || 'top',
        paddingX: hasBoxStroke ? 6 : 2,
        paddingY: hasBoxStroke ? 6 : 2,
      }
    );

    ctx.restore();
  }

  private static renderTextBox(ctx: CanvasRenderingContext2D, m: TextMarkup) {
    if (!m.boxRect) return;
    ctx.save();
    ctx.globalAlpha = m.opacity;
    if (m.fillColor && m.fillColor !== 'transparent') {
      ctx.save();
      ctx.globalAlpha = m.fillOpacity !== undefined ? m.fillOpacity : 1;
      ctx.fillStyle = m.fillColor;
      ctx.fillRect(m.boxRect.x, m.boxRect.y, m.boxRect.width, m.boxRect.height);
      ctx.restore();
    }
    const hasStroke = m.strokeWidth > 0 && m.strokeColor && m.strokeColor !== 'transparent';
    if (hasStroke) {
      ctx.strokeStyle = m.strokeColor;
      ctx.lineWidth = m.strokeWidth;
      this.applyLineStyle(ctx, m.lineStyle);
      ctx.strokeRect(m.boxRect.x, m.boxRect.y, m.boxRect.width, m.boxRect.height);
    }
    ctx.setLineDash([]);

    const padX = hasStroke ? 5 : 0;
    const padY = hasStroke ? 5 : 0;
    const resolvedTextColor =
      (m as any).textColor ||
      (m.strokeColor && m.strokeColor !== 'transparent' ? m.strokeColor : '#000000');

    TextLayoutHelper.renderFormattedText(
      ctx,
      m.text || m.contents || '',
      m.boxRect,
      {
        fontSize: m.fontSize || 12,
        fontFamily: m.fontFamily || 'Arial, sans-serif',
        fontWeight: (m as any).fontWeight || 'normal',
        fontStyle: (m as any).fontStyle || 'normal',
        textColor: resolvedTextColor,
        textAlign: m.textAlign || 'left',
        verticalAlign: m.verticalAlign || 'top',
        paddingX: padX,
        paddingY: padY,
      }
    );

    ctx.restore();
  }

  private static renderLineOrArrow(ctx: CanvasRenderingContext2D, m: LineMarkup) {
    if (!m.startPoint || !m.endPoint) return;
    ctx.save();
    ctx.globalAlpha = m.opacity;
    ctx.strokeStyle = m.strokeColor;
    ctx.lineWidth = m.strokeWidth;
    LineStyleHelper.applyLineStyle(ctx, m.lineStyle, m.strokeWidth, m.lineStyleScale);

    ctx.beginPath();
    ctx.moveTo(m.startPoint.x, m.startPoint.y);
    ctx.lineTo(m.endPoint.x, m.endPoint.y);
    ctx.stroke();

    // Etichetta Piping per linee tubazioni (GAS, CW, HW, STEAM, DRAIN)
    LineStyleHelper.renderPipingLabel(ctx, m.startPoint, m.endPoint, m.lineStyle, m.strokeColor, m.lineStyleScale);

    ctx.setLineDash([]);
    const angle = Math.atan2(m.endPoint.y - m.startPoint.y, m.endPoint.x - m.startPoint.x);

    // Terminazione Fine (o tipo arrow)
    const effectiveEndHead = m.type === 'arrow' ? 'arrow' : (m.endHead || 'none');
    if (effectiveEndHead !== 'none') {
      this.drawLineEnding(ctx, m.endPoint, angle + Math.PI, effectiveEndHead, m.strokeColor, Math.max(9, m.strokeWidth * 3 + 6), m.strokeWidth);
    }
    // Terminazione Inizio
    if (m.startHead && m.startHead !== 'none') {
      this.drawLineEnding(ctx, m.startPoint, angle, m.startHead, m.strokeColor, Math.max(9, m.strokeWidth * 3 + 6), m.strokeWidth);
    }
    ctx.restore();
  }

  private static renderPenOrHighlighter(ctx: CanvasRenderingContext2D, m: any) {
    if (!m.points || m.points.length < 2) return;
    ctx.save();
    const isHighlight = m.type === 'highlighter';
    ctx.globalAlpha = isHighlight ? 0.35 : m.opacity;
    ctx.strokeStyle = m.strokeColor;
    ctx.lineWidth = Math.max(0.1, m.strokeWidth);
    ctx.lineCap = isHighlight ? 'square' : 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(m.points[0].x, m.points[0].y);
    for (let i = 1; i < m.points.length; i++) {
      ctx.lineTo(m.points[i].x, m.points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private static renderPolyline(ctx: CanvasRenderingContext2D, m: PolylineMarkup) {
    if (m.points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = m.opacity;

    // Se la polilinea ha almeno 3 vertici e ha colore riempimento o campitura (Stile Bluebeam Revu):
    if (m.points.length >= 3) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of m.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const bounds = { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };

      // 1. Sfondo pieno (se specificato)
      if (m.fillColor && m.fillColor !== 'transparent') {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(m.points[0].x, m.points[0].y);
        for (let i = 1; i < m.points.length; i++) {
          ctx.lineTo(m.points[i].x, m.points[i].y);
        }
        ctx.closePath();
        ctx.globalAlpha = m.fillOpacity ?? 1;
        ctx.fillStyle = m.fillColor;
        ctx.fill();
        ctx.restore();
      }

      // 2. Retino / Campitura tecnica (se specificata)
      if (m.hatchPattern && m.hatchPattern !== 'none' && m.hatchPattern !== 'solid') {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(m.points[0].x, m.points[0].y);
        for (let i = 1; i < m.points.length; i++) {
          ctx.lineTo(m.points[i].x, m.points[i].y);
        }
        ctx.closePath();
        ctx.clip();
        HatchRenderer.renderHatch(
          ctx,
          m.hatchPattern,
          bounds,
          m.hatchColor || m.strokeColor,
          m.hatchScale || 1,
          m.fillOpacity ?? 0.5,
          m.hatchAngle || 0
        );
        ctx.restore();
      }
    }

    // Tracciamento bordo aperto/continuo
    ctx.strokeStyle = m.strokeColor;
    ctx.lineWidth = m.strokeWidth;
    LineStyleHelper.applyLineStyle(ctx, m.lineStyle, m.strokeWidth, m.lineStyleScale);

    ctx.beginPath();
    ctx.moveTo(m.points[0].x, m.points[0].y);
    for (let i = 1; i < m.points.length; i++) {
      ctx.lineTo(m.points[i].x, m.points[i].y);
    }
    ctx.stroke();

    // Se stile piping, disegna le etichette sui segmenti
    if (m.lineStyle && ['gas', 'water', 'hot_water', 'steam', 'drain'].includes(m.lineStyle)) {
      for (let i = 0; i < m.points.length - 1; i++) {
        LineStyleHelper.renderPipingLabel(ctx, m.points[i], m.points[i + 1], m.lineStyle, m.strokeColor, m.lineStyleScale);
      }
    }

    ctx.setLineDash([]);
    // Terminazioni iniziale e finale (Inizio / Fine stile Bluebeam)
    if (m.startHead && m.startHead !== 'none' && m.points.length >= 2) {
      const p0 = m.points[0];
      const p1 = m.points[1];
      const startAngle = Math.atan2(p0.y - p1.y, p0.x - p1.x) + Math.PI;
      this.drawLineEnding(ctx, p0, startAngle, m.startHead, m.strokeColor, Math.max(9, m.strokeWidth * 3 + 6), m.strokeWidth);
    }
    if (m.endHead && m.endHead !== 'none' && m.points.length >= 2) {
      const pn = m.points[m.points.length - 1];
      const pn_1 = m.points[m.points.length - 2];
      const endAngle = Math.atan2(pn.y - pn_1.y, pn.x - pn_1.x);
      this.drawLineEnding(ctx, pn, endAngle + Math.PI, m.endHead, m.strokeColor, Math.max(9, m.strokeWidth * 3 + 6), m.strokeWidth);
    }

    ctx.restore();
  }

  private static renderPolygon(ctx: CanvasRenderingContext2D, m: PolygonMarkup) {
    if (m.points.length < 3) return;
    ctx.save();
    ctx.globalAlpha = m.opacity;
    ctx.strokeStyle = m.strokeColor;
    ctx.lineWidth = m.strokeWidth;

    // Calcolo bounding box per campitura
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of m.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const bounds = { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };

    // Sfondo pieno
    if (m.fillColor && m.fillColor !== 'transparent') {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(m.points[0].x, m.points[0].y);
      for (let i = 1; i < m.points.length; i++) {
        ctx.lineTo(m.points[i].x, m.points[i].y);
      }
      ctx.closePath();
      ctx.globalAlpha = m.fillOpacity ?? 1;
      ctx.fillStyle = m.fillColor;
      ctx.fill();
      ctx.restore();
    }

    // Campitura con clipping
    if (m.hatchPattern && m.hatchPattern !== 'none' && m.hatchPattern !== 'solid') {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(m.points[0].x, m.points[0].y);
      for (let i = 1; i < m.points.length; i++) {
        ctx.lineTo(m.points[i].x, m.points[i].y);
      }
      ctx.closePath();
      ctx.clip();
      HatchRenderer.renderHatch(
        ctx,
        m.hatchPattern,
        bounds,
        m.hatchColor || m.strokeColor,
        m.hatchScale || 1,
        m.fillOpacity ?? 0.5,
        m.hatchAngle || 0
      );
      ctx.restore();
    }

    // Bordo poligonale con stile linea
    ctx.beginPath();
    ctx.moveTo(m.points[0].x, m.points[0].y);
    for (let i = 1; i < m.points.length; i++) {
      ctx.lineTo(m.points[i].x, m.points[i].y);
    }
    ctx.closePath();
    LineStyleHelper.applyLineStyle(ctx, m.lineStyle, m.strokeWidth, m.lineStyleScale);
    ctx.stroke();

    ctx.restore();
  }

  private static renderMeasureLength(
    ctx: CanvasRenderingContext2D,
    m: MeasureLengthMarkup,
    scale?: ScaleCalibration | null
  ) {
    if (!m.startPoint || !m.endPoint) return;
    const p1 = m.startPoint;
    const p2 = m.endPoint;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;

    // Vettore normale unitario perpendicolare al segmento misurato
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    // Offset di estensione (distanza delle linee di estensione, default 24 pt)
    const offset = m.extensionOffset !== undefined ? m.extensionOffset : 24;
    const overshoot = m.extensionOvershoot !== undefined ? m.extensionOvershoot : 5;
    const gap = m.extensionGap !== undefined ? m.extensionGap : 2;
    const sign = offset >= 0 ? 1 : -1;

    // Punti della linea di quota parallela
    const dim1: Point2D = {
      x: p1.x + nx * offset,
      y: p1.y + ny * offset,
    };
    const dim2: Point2D = {
      x: p2.x + nx * offset,
      y: p2.y + ny * offset,
    };

    // Testimoni di quota (linee di estensione dai punti misurati oltre la quota)
    const ext1Start: Point2D = {
      x: p1.x + nx * (gap * sign),
      y: p1.y + ny * (gap * sign),
    };
    const ext1End: Point2D = {
      x: dim1.x + nx * (overshoot * sign),
      y: dim1.y + ny * (overshoot * sign),
    };

    const ext2Start: Point2D = {
      x: p2.x + nx * (gap * sign),
      y: p2.y + ny * (gap * sign),
    };
    const ext2End: Point2D = {
      x: dim2.x + nx * (overshoot * sign),
      y: dim2.y + ny * (overshoot * sign),
    };

    ctx.save();
    ctx.globalAlpha = m.opacity ?? 1;
    ctx.strokeStyle = m.strokeColor;
    ctx.lineWidth = m.strokeWidth;
    LineStyleHelper.applyLineStyle(ctx, m.lineStyle, m.strokeWidth, m.lineStyleScale);

    // 1. Disegna Linee di Estensione (Testimoni di quota standard CAD)
    ctx.beginPath();
    ctx.moveTo(ext1Start.x, ext1Start.y);
    ctx.lineTo(ext1End.x, ext1End.y);
    ctx.moveTo(ext2Start.x, ext2Start.y);
    ctx.lineTo(ext2End.x, ext2End.y);
    ctx.stroke();

    // 2. Disegna Linea di Quota Parallela
    ctx.beginPath();
    ctx.moveTo(dim1.x, dim1.y);
    ctx.lineTo(dim2.x, dim2.y);
    ctx.stroke();

    ctx.setLineDash([]);

    // 3. Simboli Terminali (Architectural Tick a 45° standard CAD o Freccia/Cerchio)
    const ending = m.dimensionEnding || 'tick';
    const angle = Math.atan2(dim2.y - dim1.y, dim2.x - dim1.x);

    if (ending === 'tick') {
      const tickLen = Math.max(9, m.strokeWidth * 3 + 6);
      this.drawTick(ctx, dim1, angle + Math.PI / 4, tickLen);
      this.drawTick(ctx, dim2, angle + Math.PI / 4, tickLen);
    } else {
      this.drawLineEnding(ctx, dim1, angle, ending, m.strokeColor, Math.max(9, m.strokeWidth * 3 + 6), m.strokeWidth);
      this.drawLineEnding(ctx, dim2, angle + Math.PI, ending, m.strokeColor, Math.max(9, m.strokeWidth * 3 + 6), m.strokeWidth);
    }

    // 4. Testo Quota Orientato (supporta testo personalizzato, font e colore)
    const dist = ScaleManager.calculateDistance(p1, p2);
    let label = m.customText;
    if (!label) {
      if (m.showUnit === false) {
        const scaledVal = scale ? dist * (scale.scaleRatio || 1) : dist;
        label = scaledVal.toFixed(1);
      } else {
        label = ScaleManager.formatLength(dist, scale);
      }
    }

    const midX = (dim1.x + dim2.x) / 2;
    const midY = (dim1.y + dim2.y) / 2;
    const fontSize = m.fontSize || 12;
    const fontFamily = m.fontFamily || 'Segoe UI, Arial, sans-serif';
    const textColor = m.textColor || '#ffff00'; // Default Giallo CAD stile AutoCAD/Bluebeam
    const textPos = m.textPosition || 'above';   // Default 'above' standard CAD

    ctx.save();
    ctx.translate(midX, midY);

    // Ruota il testo lungo la linea di quota (leggibile dal basso/sinistra senza capovolgimenti)
    let textAngle = angle;
    if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
      textAngle += Math.PI;
    }
    ctx.rotate(textAngle);

    ctx.font = `600 ${fontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';

    const metrics = ctx.measureText(label);
    const padX = 4;
    const padY = 2;

    if (textPos === 'above') {
      ctx.textBaseline = 'bottom';
      const textY = -3; // Posizionato SOPRA la linea di quota (standard CAD)

      // Sfondo facoltativo sotto il testo della quota (attivabile/disattivabile dall'utente)
      if (m.showTextBackground) {
        ctx.fillStyle = m.textFillColor || 'rgba(24, 24, 24, 0.85)';
        ctx.fillRect(-metrics.width / 2 - padX, textY - fontSize - padY, metrics.width + padX * 2, fontSize + padY * 2);
      }

      ctx.fillStyle = textColor;
      ctx.fillText(label, 0, textY);
    } else {
      ctx.textBaseline = 'middle';
      if (m.showTextBackground !== false) {
        ctx.fillStyle = m.textFillColor || 'rgba(24, 24, 24, 0.85)';
        ctx.fillRect(-metrics.width / 2 - padX, -fontSize / 2 - padY, metrics.width + padX * 2, fontSize + padY * 2);
      }
      ctx.fillStyle = textColor;
      ctx.fillText(label, 0, 0);
    }

    ctx.restore();
    ctx.restore();
  }

  private static renderMeasurePolyline(
    ctx: CanvasRenderingContext2D,
    m: MeasurePolylineMarkup,
    scale?: ScaleCalibration | null
  ) {
    if (m.points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = m.opacity;
    ctx.strokeStyle = m.strokeColor;
    ctx.lineWidth = m.strokeWidth;

    ctx.beginPath();
    ctx.moveTo(m.points[0].x, m.points[0].y);
    for (let i = 1; i < m.points.length; i++) {
      ctx.lineTo(m.points[i].x, m.points[i].y);
    }
    ctx.stroke();

    // Etichetta totale sull'ultimo punto
    const totalLen = ScaleManager.calculatePolylineLength(m.points);
    const label = `Totale: ${ScaleManager.formatLength(totalLen, scale)}`;
    const lastPt = m.points[m.points.length - 1];
    this.renderTextBadge(ctx, lastPt.x, lastPt.y - 12, label, m.strokeColor);

    ctx.restore();
  }

  private static renderMeasureArea(
    ctx: CanvasRenderingContext2D,
    m: MeasureAreaMarkup,
    scale?: ScaleCalibration | null
  ) {
    if (m.points.length < 3) return;
    ctx.save();
    ctx.globalAlpha = m.opacity;
    ctx.strokeStyle = m.strokeColor;
    ctx.lineWidth = m.strokeWidth;

    // Calcolo bounding box per eventuale campitura
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of m.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

    // Sfondo trasparente/colorato
    ctx.beginPath();
    ctx.moveTo(m.points[0].x, m.points[0].y);
    for (let i = 1; i < m.points.length; i++) {
      ctx.lineTo(m.points[i].x, m.points[i].y);
    }
    ctx.closePath();

    if (m.fillColor !== 'transparent') {
      ctx.save();
      ctx.globalAlpha = m.fillOpacity ?? 1;
      ctx.fillStyle = (m.fillColor && m.fillColor !== 'transparent') ? m.fillColor : m.strokeColor;
      ctx.fill();
      ctx.restore();
    }

    // Campitura
    if (m.hatchPattern && m.hatchPattern !== 'none' && m.hatchPattern !== 'solid') {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(m.points[0].x, m.points[0].y);
      for (let i = 1; i < m.points.length; i++) {
        ctx.lineTo(m.points[i].x, m.points[i].y);
      }
      ctx.closePath();
      ctx.clip();
      HatchRenderer.renderHatch(
        ctx,
        m.hatchPattern,
        bounds,
        m.hatchColor || m.strokeColor,
        m.hatchScale || 1,
        m.fillOpacity ?? 0.5,
        m.hatchAngle || 0
      );
      ctx.restore();
    }

    LineStyleHelper.applyLineStyle(ctx, m.lineStyle, m.strokeWidth, m.lineStyleScale);
    ctx.stroke();

    // Centroide per etichetta area
    let cx = 0;
    let cy = 0;
    for (const pt of m.points) {
      cx += pt.x;
      cy += pt.y;
    }
    cx /= m.points.length;
    cy /= m.points.length;

    const area = ScaleManager.calculatePolygonArea(m.points);
    const label = `Area: ${ScaleManager.formatArea(area, scale)}`;
    this.renderTextBadge(ctx, cx, cy, label, m.strokeColor);

    ctx.restore();
  }

  private static renderMeasureCount(ctx: CanvasRenderingContext2D, m: MeasureCountMarkup) {
    ctx.save();
    ctx.globalAlpha = m.opacity;

    m.locations.forEach((pt, index) => {
      ctx.fillStyle = m.strokeColor || '#ff0000';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), pt.x, pt.y);
    });

    ctx.restore();
  }

  private static stampImageCache: Map<string, HTMLImageElement> = new Map();

  public static preloadStampImage(id: string, dataUrl: string): Promise<void> {
    if (typeof Image === 'undefined' || !dataUrl) return Promise.resolve();
    const existing = this.stampImageCache.get(id);
    if (existing && existing.src === dataUrl && existing.complete) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = dataUrl;
      this.stampImageCache.set(id, img);
    });
  }

  private static renderStamp(ctx: CanvasRenderingContext2D, m: StampMarkup) {
    ctx.save();
    ctx.globalAlpha = m.opacity;
    const { x, y, width, height } = m.boxRect;
    const rotDeg = m.rotation || 0;
    if (rotDeg !== 0) {
      const cx = x + width / 2;
      const cy = y + height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((rotDeg * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    if (m.imageDataUrl && typeof Image !== 'undefined') {
      let img = this.stampImageCache.get(m.id);
      if (!img || img.src !== m.imageDataUrl) {
        img = new Image();
        img.src = m.imageDataUrl;
        this.stampImageCache.set(m.id, img);
      }
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, x, y, width, height);
        ctx.restore();
        return;
      }
    }

    // Bordo timbro adattivo (solo per timbri testuali standard senza grafica/clipboard)
    ctx.strokeStyle = m.strokeColor || '#cc0000';
    ctx.lineWidth = height < 25 ? 1.5 : 2.5;
    ctx.strokeRect(x, y, width, height);
    if (width > 24 && height > 24) {
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x + 3, y + 3, width - 6, height - 6);
    }

    const title = m.stampTitle || 'TIMBRO';
    const titleFontSize = Math.max(6, Math.min(Math.floor(height * 0.36), Math.floor((width * 1.3) / Math.max(4, title.length))));
    ctx.fillStyle = m.strokeColor || '#cc0000';
    ctx.font = `bold ${titleFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, x + width / 2, height < 24 ? y + height / 2 : y + height * 0.38, width - 4);

    if (height >= 24) {
      const subFontSize = Math.max(5, Math.min(Math.floor(height * 0.18), Math.floor(width / 10)));
      ctx.font = `500 ${subFontSize}px sans-serif`;
      ctx.fillText(`${m.dateStamp}`, x + width / 2, y + height * 0.74, width - 4);
    }

    ctx.restore();
  }

  private static renderSelectionHandles(ctx: CanvasRenderingContext2D, markup: AnyMarkup, zoom: number = 1.0) {
    ctx.save();
    ctx.fillStyle = '#0078d4';
    ctx.strokeStyle = '#ffffff';
    const invZoom = 1 / Math.max(0.25, zoom);

    let minDim = 999;
    if ('boxRect' in markup && (markup as any).boxRect) {
      const b = (markup as any).boxRect;
      minDim = Math.min(Math.abs(b.width || 0), Math.abs(b.height || 0));
    } else if ('points' in markup && Array.isArray((markup as any).points) && (markup as any).points.length > 0) {
      const pts: Point2D[] = (markup as any).points;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      minDim = Math.min(x1 - x0, y1 - y0);
    }

    const screenMinDim = minDim * Math.max(0.25, zoom);
    const isTiny = screenMinDim < 28;
    const handleR = (isTiny ? Math.max(2.5, Math.min(3.5, screenMinDim * 0.14)) : 4.5) * invZoom;
    ctx.lineWidth = (isTiny ? 1 : 1.5) * invZoom;
    const dashPattern = [4 * invZoom, 3 * invZoom];

    const drawHandle = (pt: Point2D) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, handleR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    if (markup.type === 'cloud_plus') {
      const cpm = markup as CloudPlusMarkup;
      const { elbowX, elbowY, leader } = this.getCloudPlusGeometry(cpm);
      if (cpm.cloudPoints) cpm.cloudPoints.forEach(drawHandle);
      if (cpm.boxRect) {
        const b = cpm.boxRect;
        ctx.save();
        ctx.strokeStyle = '#0078d4';
        ctx.lineWidth = 1 * invZoom;
        ctx.setLineDash(dashPattern);
        ctx.strokeRect(b.x, b.y, b.width, b.height);
        ctx.restore();
        drawHandle({ x: b.x, y: b.y });
        drawHandle({ x: b.x + b.width, y: b.y });
        drawHandle({ x: b.x + b.width, y: b.y + b.height });
        drawHandle({ x: b.x, y: b.y + b.height });
        drawHandle({ x: b.x + b.width / 2, y: b.y });
        drawHandle({ x: b.x + b.width, y: b.y + b.height / 2 });
        drawHandle({ x: b.x + b.width / 2, y: b.y + b.height });
        drawHandle({ x: b.x, y: b.y + b.height / 2 });
      }
      ctx.save();
      ctx.fillStyle = '#eab308';
      drawHandle({ x: elbowX, y: elbowY });
      if (leader) drawHandle(leader);
      ctx.restore();
    } else if (markup.compoundPaths && markup.compoundPaths.length > 0 && markup.boxRect) {
      const b = markup.boxRect;
      const pad = isTiny ? handleR + 2 : 0;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rad = (((markup as any).rotation || 0) * Math.PI) / 180;
      const rotPt = (px: number, py: number): Point2D => {
        if (!rad) return { x: px, y: py };
        const dx = px - cx;
        const dy = py - cy;
        return {
          x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
          y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
        };
      };
      const tl = rotPt(b.x - pad, b.y - pad);
      const tr = rotPt(b.x + b.width + pad, b.y - pad);
      const br = rotPt(b.x + b.width + pad, b.y + b.height + pad);
      const bl = rotPt(b.x - pad, b.y + b.height + pad);
      const topMid = rotPt(cx, b.y - pad);
      const rotHandle = rotPt(cx, b.y - 20);
      ctx.save();
      ctx.strokeStyle = '#00b7c3';
      ctx.lineWidth = (isTiny ? 0.8 : 1) * invZoom;
      ctx.setLineDash(dashPattern);
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y);
      ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y);
      ctx.lineTo(bl.x, bl.y);
      ctx.closePath();
      ctx.moveTo(topMid.x, topMid.y);
      ctx.lineTo(rotHandle.x, rotHandle.y);
      ctx.stroke();
      ctx.restore();
      drawHandle(tl);
      drawHandle(tr);
      drawHandle(br);
      drawHandle(bl);
      ctx.save();
      ctx.fillStyle = '#10b981';
      drawHandle(rotHandle);
      ctx.restore();
    } else if ('points' in markup && Array.isArray((markup as any).points)) {
      const pts: Point2D[] = (markup as any).points;
      if (pts.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity;
        for (const pt of pts) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
        }
        const topMid = { x: (minX + maxX) / 2, y: minY };
        const rotHandle = { x: (minX + maxX) / 2, y: minY - 20 };
        ctx.save();
        ctx.strokeStyle = '#0078d4';
        ctx.lineWidth = 1 * invZoom;
        ctx.setLineDash(dashPattern);
        ctx.beginPath();
        ctx.moveTo(topMid.x, topMid.y);
        ctx.lineTo(rotHandle.x, rotHandle.y);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.fillStyle = '#10b981';
        drawHandle(rotHandle);
        ctx.restore();
      }
      pts.forEach(drawHandle);
    } else if (markup.type === 'measure_length') {
      const ml = markup as MeasureLengthMarkup;
      if (!ml.startPoint || !ml.endPoint) {
        ctx.restore();
        return;
      }
      drawHandle(ml.startPoint);
      drawHandle(ml.endPoint);
      const dx = ml.endPoint.x - ml.startPoint.x;
      const dy = ml.endPoint.y - ml.startPoint.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const nx = -dy / len;
        const ny = dx / len;
        const offset = ml.extensionOffset !== undefined ? ml.extensionOffset : 24;
        const dimMid = {
          x: (ml.startPoint.x + ml.endPoint.x) / 2 + nx * offset,
          y: (ml.startPoint.y + ml.endPoint.y) / 2 + ny * offset,
        };
        ctx.save();
        ctx.fillStyle = '#00b7c3';
        drawHandle(dimMid);
        ctx.restore();
      }
    } else if (markup.type === 'callout') {
      const cm = markup as CalloutMarkup;
      const b = cm.boxRect;
      const { elbowX, elbowY, arrows } = this.getCalloutGeometry(cm);

      // Riquadro tratteggiato del box testo + 8 maniglie (angoli e lati)
      ctx.save();
      ctx.strokeStyle = '#0078d4';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(b.x, b.y, b.width, b.height);
      ctx.restore();

      drawHandle({ x: b.x, y: b.y });
      drawHandle({ x: b.x + b.width, y: b.y });
      drawHandle({ x: b.x + b.width, y: b.y + b.height });
      drawHandle({ x: b.x, y: b.y + b.height });
      drawHandle({ x: b.x + b.width / 2, y: b.y });
      drawHandle({ x: b.x + b.width, y: b.y + b.height / 2 });
      drawHandle({ x: b.x + b.width / 2, y: b.y + b.height });
      drawHandle({ x: b.x, y: b.y + b.height / 2 });

      // Maniglia gialla sul gomito e maniglie sulle punte delle frecce
      ctx.save();
      ctx.fillStyle = '#eab308';
      drawHandle({ x: elbowX, y: elbowY });
      arrows.forEach((tip) => drawHandle(tip));
      ctx.restore();
    } else if ('startPoint' in markup && 'endPoint' in markup && (markup as any).startPoint && (markup as any).endPoint) {
      const sp = (markup as any).startPoint as Point2D;
      const ep = (markup as any).endPoint as Point2D;
      const topMid = { x: (sp.x + ep.x) / 2, y: Math.min(sp.y, ep.y) };
      const rotHandle = { x: topMid.x, y: topMid.y - 20 };
      ctx.save();
      ctx.strokeStyle = '#0078d4';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(topMid.x, topMid.y);
      ctx.lineTo(rotHandle.x, rotHandle.y);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = '#10b981';
      drawHandle(rotHandle);
      ctx.restore();
      drawHandle(sp);
      drawHandle(ep);
    } else if ('boxRect' in markup && (markup as any).boxRect) {
      const sm = markup as any;
      const b = sm.boxRect;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rad = ((sm.rotation || 0) * Math.PI) / 180;
      const rotPt = (px: number, py: number): Point2D => {
        if (!rad) return { x: px, y: py };
        const dx = px - cx;
        const dy = py - cy;
        return {
          x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
          y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
        };
      };

      const tl = rotPt(b.x, b.y);
      const tr = rotPt(b.x + b.width, b.y);
      const br = rotPt(b.x + b.width, b.y + b.height);
      const bl = rotPt(b.x, b.y + b.height);
      const topMid = rotPt(cx, b.y);
      const rotHandle = rotPt(cx, b.y - 20);

      ctx.save();
      ctx.strokeStyle = '#0078d4';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y);
      ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y);
      ctx.lineTo(bl.x, bl.y);
      ctx.closePath();
      ctx.moveTo(topMid.x, topMid.y);
      ctx.lineTo(rotHandle.x, rotHandle.y);
      ctx.stroke();
      ctx.restore();

      drawHandle(tl);
      drawHandle(tr);
      drawHandle(br);
      drawHandle(bl);

      ctx.save();
      ctx.fillStyle = '#10b981';
      drawHandle(rotHandle);
      ctx.restore();
    }
    ctx.restore();
  }

  private static drawTick(ctx: CanvasRenderingContext2D, pt: Point2D, angle: number, len: number) {
    const dx = Math.cos(angle) * (len / 2);
    const dy = Math.sin(angle) * (len / 2);
    ctx.beginPath();
    ctx.moveTo(pt.x - dx, pt.y - dy);
    ctx.lineTo(pt.x + dx, pt.y + dy);
    ctx.stroke();
  }

  private static drawArrowHead(
    ctx: CanvasRenderingContext2D,
    tip: Point2D,
    angle: number,
    color: string,
    size: number
  ) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x + size * Math.cos(angle - Math.PI / 6),
      tip.y + size * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      tip.x + size * Math.cos(angle + Math.PI / 6),
      tip.y + size * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private static renderTextBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
    color: string
  ) {
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(text);
    const paddingX = 6;
    const paddingY = 4;
    const bgWidth = metrics.width + paddingX * 2;
    const bgHeight = 18;

    ctx.fillStyle = 'rgba(24, 24, 24, 0.85)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.fillRect(x - bgWidth / 2, y - bgHeight / 2, bgWidth, bgHeight);
    ctx.strokeRect(x - bgWidth / 2, y - bgHeight / 2, bgWidth, bgHeight);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  public static drawLineEnding(
    ctx: CanvasRenderingContext2D,
    pt: Point2D,
    angle: number,
    ending: LineEnding | undefined,
    color: string,
    size: number,
    strokeWidth: number = 2
  ) {
    if (!ending || ending === 'none') return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.1, strokeWidth);

    switch (ending) {
      case 'arrow':
        this.drawArrowHead(ctx, pt, angle, color, size);
        break;

      case 'open_arrow': {
        const wing = size * 0.85;
        ctx.beginPath();
        ctx.moveTo(pt.x + wing * Math.cos(angle - Math.PI / 6), pt.y + wing * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(pt.x, pt.y);
        ctx.lineTo(pt.x + wing * Math.cos(angle + Math.PI / 6), pt.y + wing * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
        break;
      }

      case 'circle':
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(3, size * 0.35), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;

      case 'square': {
        const half = Math.max(3, size * 0.32);
        ctx.translate(pt.x, pt.y);
        ctx.rotate(angle);
        ctx.fillRect(-half, -half, half * 2, half * 2);
        ctx.strokeRect(-half, -half, half * 2, half * 2);
        break;
      }

      case 'tick': {
        const len = Math.max(8, size * 0.9);
        const tickAngle = angle + Math.PI / 4;
        const dx = Math.cos(tickAngle) * (len / 2);
        const dy = Math.sin(tickAngle) * (len / 2);
        ctx.beginPath();
        ctx.moveTo(pt.x - dx, pt.y - dy);
        ctx.lineTo(pt.x + dx, pt.y + dy);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  private static renderCompoundMarkup(ctx: CanvasRenderingContext2D, m: AnyMarkup) {
    if (!m.compoundPaths || m.compoundPaths.length === 0) return;
    ctx.save();
    ctx.globalAlpha = m.opacity ?? 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const fillOpacity = m.fillOpacity ?? 1;

    m.compoundPaths.forEach((cp) => {
      const stroke = cp.strokeColor || m.strokeColor || '#ff0000';
      const width = cp.strokeWidth !== undefined ? cp.strokeWidth : (m.strokeWidth || 1.2);
      const fill = cp.fillColor;

      const fillSubPath = () => {
        if (!fill || fill === 'transparent') return;
        ctx.save();
        ctx.globalAlpha = fillOpacity;
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.restore();
      };

      ctx.strokeStyle = stroke;
      ctx.lineWidth = width > 0 ? width : 0;
      LineStyleHelper.applyLineStyle(ctx, (cp as any).lineStyle || m.lineStyle, width, m.lineStyleScale);

      if (cp.type === 'text' && cp.rect && cp.text) {
        const fs = Math.max(4, cp.fontSize || cp.rect.height * 0.75);
        const align: CanvasTextAlign =
          cp.textAlign === 'left' || cp.textAlign === 'right' || cp.textAlign === 'center'
            ? cp.textAlign
            : cp.textAlign === 'justify'
            ? 'left'
            : 'center';
        ctx.save();
        ctx.fillStyle = stroke;
        ctx.font = `${fs}px Helvetica, Arial, sans-serif`;
        ctx.textAlign = align;
        ctx.textBaseline = 'middle';
        const lines = cp.text.split(/\r?\n/);
        const lineHeight = fs * 1.15;
        const startY =
          cp.rect.y + cp.rect.height / 2 - ((lines.length - 1) * lineHeight) / 2;
        const tx =
          align === 'left'
            ? cp.rect.x + 2
            : align === 'right'
            ? cp.rect.x + cp.rect.width - 2
            : cp.rect.x + cp.rect.width / 2;
        lines.forEach((line, li) => {
          ctx.fillText(line, tx, startY + li * lineHeight);
        });
        ctx.restore();
      } else if (cp.points && cp.points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(cp.points[0].x, cp.points[0].y);
        for (let i = 1; i < cp.points.length; i++) {
          ctx.lineTo(cp.points[i].x, cp.points[i].y);
        }
        if (cp.type === 'polygon') {
          ctx.closePath();
          fillSubPath();
        }
        if (width > 0 && stroke !== 'transparent') {
          ctx.stroke();
        }
      } else if (cp.circle) {
        ctx.beginPath();
        ctx.arc(cp.circle.cx, cp.circle.cy, Math.max(0.2, cp.circle.r), 0, Math.PI * 2);
        fillSubPath();
        if (width > 0 && stroke !== 'transparent') ctx.stroke();
      } else if (cp.ellipse) {
        ctx.beginPath();
        ctx.ellipse(
          cp.ellipse.cx,
          cp.ellipse.cy,
          Math.max(0.2, cp.ellipse.rx),
          Math.max(0.2, cp.ellipse.ry),
          0,
          0,
          Math.PI * 2
        );
        fillSubPath();
        if (width > 0 && stroke !== 'transparent') ctx.stroke();
      } else if (cp.rect) {
        if (fill && fill !== 'transparent') {
          ctx.save();
          ctx.globalAlpha = fillOpacity;
          ctx.fillStyle = fill;
          ctx.fillRect(cp.rect.x, cp.rect.y, cp.rect.width, cp.rect.height);
          ctx.restore();
        }
        if (width > 0 && stroke !== 'transparent') {
          ctx.strokeRect(cp.rect.x, cp.rect.y, cp.rect.width, cp.rect.height);
        }
      }
    });

    ctx.restore();
  }
}
