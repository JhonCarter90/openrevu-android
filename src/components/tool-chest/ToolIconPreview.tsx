import React, { useEffect, useRef } from 'react';
import { AnyMarkup, Point2D } from '@/types/markup';
import { CloudGenerator } from '@/core/markup/cloudGenerator';
import { HatchRenderer } from '@/core/markup/hatchRenderer';
import { LineStyleHelper } from '@/core/markup/lineStyleHelper';

interface ToolIconPreviewProps {
  tool: AnyMarkup;
  size?: number;
}

/**
 * Anteprima vettoriale mini-canvas fedele a Bluebeam Revu per ogni elemento della Cassa degli Strumenti
 */
export const ToolIconPreview: React.FC<ToolIconPreviewProps> = ({ tool, size = 34 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const stroke = tool.strokeColor || '#ff0000';
    const fill = tool.fillColor;
    const fillOp = tool.fillOpacity ?? 0.35;
    const lineW = Math.min(2.2, Math.max(1, (tool.strokeWidth || 1.5) * 0.65));

    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pad = 4;
    const w = size - pad * 2;
    const h = size - pad * 2;

    try {
      // 0. SIMBOLO COMPOSTO MULTI-ELEMENTO (BTX / Valvole / Pompe / Gruppi utente)
      if (tool.compoundPaths && tool.compoundPaths.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        tool.compoundPaths.forEach((cp) => {
          if (cp.points) {
            cp.points.forEach((p: Point2D) => {
              if (p.x < minX) minX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.x > maxX) maxX = p.x;
              if (p.y > maxY) maxY = p.y;
            });
          }
          if (cp.circle) {
            minX = Math.min(minX, cp.circle.cx - cp.circle.r);
            minY = Math.min(minY, cp.circle.cy - cp.circle.r);
            maxX = Math.max(maxX, cp.circle.cx + cp.circle.r);
            maxY = Math.max(maxY, cp.circle.cy + cp.circle.r);
          }
          if (cp.ellipse) {
            minX = Math.min(minX, cp.ellipse.cx - cp.ellipse.rx);
            minY = Math.min(minY, cp.ellipse.cy - cp.ellipse.ry);
            maxX = Math.max(maxX, cp.ellipse.cx + cp.ellipse.rx);
            maxY = Math.max(maxY, cp.ellipse.cy + cp.ellipse.ry);
          }
          if (cp.rect) {
            minX = Math.min(minX, cp.rect.x);
            minY = Math.min(minY, cp.rect.y);
            maxX = Math.max(maxX, cp.rect.x + cp.rect.width);
            maxY = Math.max(maxY, cp.rect.y + cp.rect.height);
          }
        });

        const bw = Math.max(1, maxX - minX);
        const bh = Math.max(1, maxY - minY);
        const scale = Math.min((size - 6) / bw, (size - 6) / bh);
        const offX = (size - bw * scale) / 2 - minX * scale;
        const offY = (size - bh * scale) / 2 - minY * scale;

        tool.compoundPaths.forEach((cp) => {
          ctx.strokeStyle = cp.strokeColor || stroke;
          ctx.lineWidth = Math.max(0.85, Math.min(1.8, (cp.strokeWidth || 1.2) * 0.85));
          ctx.fillStyle = cp.fillColor || 'transparent';

          if (cp.type === 'text' && cp.rect && cp.text) {
            const fs = Math.max(5, Math.min(10, (cp.fontSize || cp.rect.height * 0.75) * scale));
            ctx.save();
            ctx.fillStyle = cp.strokeColor || stroke;
            ctx.font = `bold ${fs}px Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(
              cp.text,
              (cp.rect.x + cp.rect.width / 2) * scale + offX,
              (cp.rect.y + cp.rect.height / 2) * scale + offY
            );
            ctx.restore();
          } else if (cp.points && cp.points.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(cp.points[0].x * scale + offX, cp.points[0].y * scale + offY);
            for (let i = 1; i < cp.points.length; i++) {
              ctx.lineTo(cp.points[i].x * scale + offX, cp.points[i].y * scale + offY);
            }
            if (cp.type === 'polygon') {
              ctx.closePath();
              if (cp.fillColor && cp.fillColor !== 'transparent') {
                ctx.fill();
              }
            }
            ctx.stroke();
          } else if (cp.circle) {
            ctx.beginPath();
            ctx.arc(
              cp.circle.cx * scale + offX,
              cp.circle.cy * scale + offY,
              Math.max(1, cp.circle.r * scale),
              0,
              Math.PI * 2
            );
            if (cp.fillColor && cp.fillColor !== 'transparent') {
              ctx.fill();
            }
            ctx.stroke();
          } else if (cp.ellipse) {
            ctx.beginPath();
            ctx.ellipse(
              cp.ellipse.cx * scale + offX,
              cp.ellipse.cy * scale + offY,
              Math.max(1, cp.ellipse.rx * scale),
              Math.max(1, cp.ellipse.ry * scale),
              0,
              0,
              Math.PI * 2
            );
            if (cp.fillColor && cp.fillColor !== 'transparent') {
              ctx.fill();
            }
            ctx.stroke();
          } else if (cp.rect) {
            const rx = cp.rect.x * scale + offX;
            const ry = cp.rect.y * scale + offY;
            const rw = cp.rect.width * scale;
            const rh = cp.rect.height * scale;
            if (cp.fillColor && cp.fillColor !== 'transparent') {
              ctx.fillRect(rx, ry, rw, rh);
            }
            ctx.strokeRect(rx, ry, rw, rh);
          }
        });

        ctx.restore();
        return;
      }

      // 1. NUVOLETTA (Cloud / Cloud Rect / Cloud+)
      if (tool.type === 'cloud' || tool.type === 'cloud_rect' || tool.type === 'cloud_plus') {
        const rectPts: Point2D[] = [
          { x: pad + 3, y: pad + 5 },
          { x: size - pad - 3, y: pad + 5 },
          { x: size - pad - 3, y: size - pad - 5 },
          { x: pad + 3, y: size - pad - 5 },
        ];
        const arcs = CloudGenerator.generateCloudArcs(rectPts, 5.5);
        CloudGenerator.drawCloudOnCanvas(
          ctx,
          arcs,
          stroke,
          lineW,
          fill,
          1,
          fillOp,
          tool.hatchPattern,
          tool.hatchColor || stroke,
          0.5
        );
      }
      // 2. CASELLA DI TESTO ('textbox') -> Icona T incorniciata
      else if (tool.type === 'textbox') {
        const bx = pad + 2;
        const by = pad + 3;
        const bw = w - 4;
        const bh = h - 6;

        if (fill && fill !== 'transparent') {
          ctx.save();
          ctx.fillStyle = fill;
          ctx.globalAlpha = fillOp;
          ctx.fillRect(bx, by, bw, bh);
          ctx.restore();
        }
        if ((tool.strokeWidth ?? 1) > 0) {
          LineStyleHelper.applyLineStyle(ctx, tool.lineStyle, lineW);
          ctx.strokeRect(bx, by, bw, bh);
          ctx.setLineDash([]);
        }
        ctx.fillStyle = (tool as any).textColor || stroke || '#eab308';
        ctx.font = 'bold 14px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('T', size / 2, size / 2 + 1);
      }
      // 3. CALLOUT -> Freccia + Box con 'Aa'
      else if (tool.type === 'callout') {
        const bx = pad + 9;
        const by = pad + 2;
        const bw = w - 9;
        const bh = h - 10;

        ctx.beginPath();
        ctx.moveTo(pad + 1, size - pad - 1);
        ctx.lineTo(pad + 6, by + bh / 2);
        ctx.lineTo(bx, by + bh / 2);
        ctx.stroke();

        ctx.fillStyle = fill && fill !== 'transparent' ? fill : '#ffffff';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeRect(bx, by, bw, bh);

        ctx.fillStyle = stroke;
        ctx.font = 'bold 8px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Aa', bx + bw / 2, by + bh / 2 + 0.5);
      }
      // 4. PENNA / EVIDENZIATORE -> Onda fluida
      else if (tool.type === 'pen' || tool.type === 'highlighter') {
        ctx.save();
        if (tool.type === 'highlighter') {
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 5;
        } else {
          ctx.lineWidth = Math.max(1.8, lineW);
        }
        ctx.beginPath();
        ctx.moveTo(pad + 1, size - pad - 4);
        ctx.bezierCurveTo(size * 0.35, pad, size * 0.65, pad + 6, size - pad - 1, pad + 4);
        ctx.stroke();
        ctx.restore();
      }
      // 5. LINEA / FRECCIA / QUOTA LINEARE
      else if (
        tool.type === 'line' ||
        tool.type === 'arrow' ||
        tool.type === 'measure_length' ||
        (tool as any).type === 'measure'
      ) {
        const p1 = { x: pad + 2, y: size - pad - 2 };
        const p2 = { x: size - pad - 2, y: pad + 2 };

        LineStyleHelper.applyLineStyle(ctx, tool.lineStyle, lineW);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (tool.type === 'arrow' || tool.endHead === 'arrow') {
          const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          ctx.fillStyle = stroke;
          ctx.beginPath();
          ctx.moveTo(p2.x, p2.y);
          ctx.lineTo(p2.x - 6 * Math.cos(angle - Math.PI / 6), p2.y - 6 * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(p2.x - 6 * Math.cos(angle + Math.PI / 6), p2.y - 6 * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        }
      }
      // 6. ELLISSE / CERCHIO
      else if (tool.type === 'ellipse') {
        const cx = size / 2;
        const cy = size / 2;
        const rx = w / 2 - 2;
        const ry = h / 2 - 2;

        if (fill && fill !== 'transparent') {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.globalAlpha = fillOp;
          ctx.fill();
          ctx.restore();
        }
        if (tool.hatchPattern && tool.hatchPattern !== 'none' && tool.hatchPattern !== 'solid') {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.clip();
          HatchRenderer.renderHatch(
            ctx,
            tool.hatchPattern,
            { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 },
            tool.hatchColor || stroke,
            0.5,
            0.7
          );
          ctx.restore();
        }
        LineStyleHelper.applyLineStyle(ctx, tool.lineStyle, lineW);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 7. POLILINEA / POLIGONO
      else if (
        (tool.type === 'polyline' || tool.type === 'polygon' || tool.type === 'measure_area' || tool.type === 'measure_polyline') &&
        'points' in tool &&
        Array.isArray((tool as any).points) &&
        (tool as any).points.length >= 2
      ) {
        const pts: Point2D[] = (tool as any).points;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach((p) => {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        });
        const bw = Math.max(1, maxX - minX);
        const bh = Math.max(1, maxY - minY);
        const scale = Math.min((w - 2) / bw, (h - 2) / bh);
        const offX = (size - bw * scale) / 2 - minX * scale;
        const offY = (size - bh * scale) / 2 - minY * scale;

        ctx.beginPath();
        ctx.moveTo(pts[0].x * scale + offX, pts[0].y * scale + offY);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x * scale + offX, pts[i].y * scale + offY);
        }
        if (tool.type === 'polygon' || tool.type === 'measure_area') {
          ctx.closePath();
          if (fill && fill !== 'transparent') {
            ctx.save();
            ctx.fillStyle = fill;
            ctx.globalAlpha = fillOp;
            ctx.fill();
            ctx.restore();
          }
        }
        ctx.stroke();
      }
      // 8. RETTANGOLO / DEFAULT
      else {
        const bx = pad + 2;
        const by = pad + 3;
        const bw = w - 4;
        const bh = h - 6;

        if (fill && fill !== 'transparent') {
          ctx.save();
          ctx.fillStyle = fill;
          ctx.globalAlpha = fillOp;
          ctx.fillRect(bx, by, bw, bh);
          ctx.restore();
        }
        if (tool.hatchPattern && tool.hatchPattern !== 'none' && tool.hatchPattern !== 'solid') {
          ctx.save();
          ctx.beginPath();
          ctx.rect(bx, by, bw, bh);
          ctx.clip();
          HatchRenderer.renderHatch(
            ctx,
            tool.hatchPattern,
            { x: bx, y: by, width: bw, height: bh },
            tool.hatchColor || stroke,
            0.5,
            0.7
          );
          ctx.restore();
        }
        LineStyleHelper.applyLineStyle(ctx, tool.lineStyle, lineW);
        ctx.strokeRect(bx, by, bw, bh);
      }
    } catch (e) {
      // Fallback anti-crash
      ctx.strokeRect(pad + 4, pad + 4, w - 8, h - 8);
    }

    ctx.restore();
  }, [tool, size]);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} className="block" />;
};
