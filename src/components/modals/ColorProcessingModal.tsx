import React, { useEffect, useRef, useState } from 'react';
import { X, Pipette, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { StampMarkup } from '@/types/markup';
import { MarkupRenderer } from '@/core/markup/markupRenderer';
import { BluebeamColorPicker } from '@/components/toolbar/BluebeamColorPicker';

const QUICK_COLOR_PRESETS = [
  '#000000',
  '#ff0000',
  '#0078d4',
  '#107c41',
  '#ffaa00',
  '#7030a0',
  '#ff00ff',
  '#666666',
  '#ffffff',
];

export type ColorProcessMode = 'modify' | 'grayscale' | 'bw' | 'tint';

interface ColorRule {
  id: string;
  from: string;
  to: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function processSnapshotImage(
  dataUrl: string,
  options: {
    mode: ColorProcessMode;
    rules: ColorRule[];
    useTolerance: boolean;
    tolerance: number; // 0..100
  }
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.max(1, img.naturalWidth);
      const h = Math.max(1, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const d = imgData.data;

      const parsedRules = options.rules.map((rule) => ({
        from: hexToRgb(rule.from),
        to: hexToRgb(rule.to),
      }));
      // Tolleranza in distanza RGB (max sqrt(3*255^2) ≈ 441.67)
      const maxDist = options.useTolerance ? Math.max(12, (options.tolerance / 100) * 442) : 48;

      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const a = d[i + 3];
        if (a < 10) continue;

        if (options.mode === 'grayscale') {
          const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          d[i] = lum;
          d[i + 1] = lum;
          d[i + 2] = lum;
          continue;
        }

        if (options.mode === 'bw') {
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const v = lum > 160 ? 255 : 0;
          d[i] = v;
          d[i + 1] = v;
          d[i + 2] = v;
          continue;
        }

        if (options.mode === 'tint') {
          const [, , ] = [r, g, b];
          const [tr, tg, tb] = parsedRules[0]?.to || [255, 0, 0];
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          if (lum >= 0.94) continue;
          const ink = Math.min(1, (1 - lum) / 0.85);
          d[i] = Math.round(255 * (1 - ink) + tr * ink);
          d[i + 1] = Math.round(255 * (1 - ink) + tg * ink);
          d[i + 2] = Math.round(255 * (1 - ink) + tb * ink);
          continue;
        }

        // Modalità 'modify': sostituisce i colori di origine selezionati con i colori di destinazione
        for (const rule of parsedRules) {
          const [sr, sg, sb] = rule.from;
          const [tr, tg, tb] = rule.to;
          const dist = Math.hypot(r - sr, g - sg, b - sb);
          const isNearBlackSource = sr < 50 && sg < 50 && sb < 50;
          const chroma = Math.max(r, g, b) - Math.min(r, g, b);
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

          // Gestione nitida dell'anti-aliasing su testo/tratti scuri su sfondo bianco:
          // mappa TUTTI i pixel neutri (anche i bordi grigi chiari dell'anti-aliasing) lungo la rampa bianco -> colore target,
          // eliminando completamente gli aloni grigi o marroni.
          if (isNearBlackSource && chroma < 34) {
            if (lum >= 0.96) break; // Mantiene intatto il bianco puro dello sfondo
            const maxInkLum = options.useTolerance ? Math.min(0.96, 0.78 + (options.tolerance / 100) * 0.18) : 0.94;
            if (lum <= maxInkLum) {
              const ink = Math.min(1, Math.pow((1 - lum) / 0.86, 0.85));
              d[i] = Math.round(255 * (1 - ink) + tr * ink);
              d[i + 1] = Math.round(255 * (1 - ink) + tg * ink);
              d[i + 2] = Math.round(255 * (1 - ink) + tb * ink);
              break;
            }
          }

          if (dist <= maxDist) {
            const srcLum = (0.299 * sr + 0.587 * sg + 0.114 * sb) / 255;
            if (srcLum < 0.85 && lum > srcLum) {
              // Preserva l'anti-aliasing verso il bianco nel nuovo colore invece di scurire/sporcare i bordi
              const ink = Math.min(1, Math.max(0, (1 - lum) / Math.max(0.1, 1 - srcLum)));
              d[i] = Math.round(255 * (1 - ink) + tr * ink);
              d[i + 1] = Math.round(255 * (1 - ink) + tg * ink);
              d[i + 2] = Math.round(255 * (1 - ink) + tb * ink);
            } else {
              d[i] = tr;
              d[i + 1] = tg;
              d[i + 2] = tb;
            }
            break;
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export const ColorProcessingModal: React.FC = () => {
  const { colorProcessingIds, setColorProcessingIds, markups, updateMarkup } = useAppStore();

  const [mode, setMode] = useState<ColorProcessMode>('modify');
  const [fromColor, setFromColor] = useState<string>('#000000');
  const [toColor, setToColor] = useState<string>('#ff0000');
  const [useTolerance, setUseTolerance] = useState<boolean>(true);
  const [tolerance, setTolerance] = useState<number>(30);
  const [rules, setRules] = useState<ColorRule[]>([]);
  const [pickingFromPreview, setPickingFromPreview] = useState<boolean>(false);
  const [previewAfterUrl, setPreviewAfterUrl] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState<boolean>(false);

  const beforeCanvasRef = useRef<HTMLCanvasElement>(null);

  const targetMarkups = (colorProcessingIds || [])
    .map((id) => markups.find((m) => m.id === id))
    .filter((m): m is StampMarkup => Boolean(m && m.type === 'stamp' && (m as StampMarkup).imageDataUrl));

  const primaryStamp = targetMarkups[0] || null;

  const activeRules: ColorRule[] =
    rules.length > 0 ? rules : [{ id: 'current', from: fromColor, to: toColor }];

  // Disegna immagine "Prima" su canvas per supportare il contagocce (eyedropper) con click diretto
  useEffect(() => {
    if (!primaryStamp?.imageDataUrl || !beforeCanvasRef.current) return;
    const canvas = beforeCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = Math.max(1, img.naturalWidth);
      canvas.height = Math.max(1, img.naturalHeight);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = primaryStamp.imageDataUrl;
  }, [primaryStamp?.id, primaryStamp?.imageDataUrl]);

  // Aggiorna anteprima "Dopo" in tempo reale
  useEffect(() => {
    if (!primaryStamp?.imageDataUrl) {
      setPreviewAfterUrl(null);
      return;
    }
    let cancelled = false;
    void processSnapshotImage(primaryStamp.imageDataUrl, {
      mode,
      rules: activeRules,
      useTolerance,
      tolerance,
    }).then((url) => {
      if (!cancelled) setPreviewAfterUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [primaryStamp?.imageDataUrl, mode, fromColor, toColor, rules, useTolerance, tolerance]);

  if (!colorProcessingIds || targetMarkups.length === 0 || !primaryStamp) {
    return null;
  }

  const handleBeforeCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!pickingFromPreview || !beforeCanvasRef.current) return;
    const canvas = beforeCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const px = ctx.getImageData(
      Math.max(0, Math.min(canvas.width - 1, x)),
      Math.max(0, Math.min(canvas.height - 1, y)),
      1,
      1
    ).data;
    setFromColor(rgbToHex(px[0], px[1], px[2]));
    setPickingFromPreview(false);
  };

  const handleAddRule = () => {
    setRules((prev) => [...prev, { id: crypto.randomUUID(), from: fromColor, to: toColor }]);
  };

  const handleRemoveRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleApply = async () => {
    setIsApplying(true);
    try {
      for (const sm of targetMarkups) {
        if (!sm.imageDataUrl) continue;
        const newUrl = await processSnapshotImage(sm.imageDataUrl, {
          mode,
          rules: activeRules,
          useTolerance,
          tolerance,
        });
        await MarkupRenderer.preloadStampImage(sm.id, newUrl);
        updateMarkup(sm.id, { imageDataUrl: newUrl, strokeColor: toColor } as any);
      }
      setColorProcessingIds(null);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 select-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setColorProcessingIds(null);
      }}
    >
      <div className="w-[540px] max-w-[95vw] bg-[#252529] border border-[#45454a] rounded-lg shadow-2xl text-[#e4e4e4] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#1e1e22] border-b border-[#3a3a40]">
          <span className="text-[13px] font-semibold">Elaborazione colore</span>
          <button
            onClick={() => setColorProcessingIds(null)}
            className="text-[#999] hover:text-white p-0.5 rounded"
            title="Chiudi"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3 text-[12px]">
          {/* Tipo di elaborazione */}
          <div className="flex items-center gap-3">
            <label className="w-32 text-[#bbb]">Tipo di elaborazione:</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ColorProcessMode)}
              className="flex-1 bg-[#1b1b1e] border border-[#45454a] rounded px-2.5 py-1 text-[#e4e4e4] outline-none focus:border-[#0078d4]"
            >
              <option value="modify">Modifica colori</option>
              <option value="tint">Colora tutto (inchiostro)</option>
              <option value="grayscale">Scala di grigi</option>
              <option value="bw">Bianco e nero</option>
            </select>
          </div>

          {/* Box Elaborazione */}
          <div className="border border-[#3a3a40] rounded p-3 space-y-2.5 bg-[#202024]">
            <div className="text-[11px] font-semibold text-[#aaa] uppercase tracking-wide">
              Elaborazione
            </div>

            {mode === 'modify' && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[#ccc]">Colore di origine:</span>
                    <BluebeamColorPicker
                      color={fromColor}
                      onChange={(c) => setFromColor(c)}
                      allowTransparent={false}
                      title="Scegli colore di origine (Preset Bluebeam o RGB)"
                    />
                    <button
                      type="button"
                      onClick={() => setPickingFromPreview((v) => !v)}
                      className={`p-1 rounded border text-[11px] flex items-center gap-1 cursor-pointer ${
                        pickingFromPreview
                          ? 'bg-[#0078d4] border-[#0078d4] text-white'
                          : 'bg-[#2a2a2f] border-[#45454a] text-[#ccc] hover:text-white'
                      }`}
                      title="Preleva colore cliccando sull'anteprima Prima"
                    >
                      <Pipette size={13} />
                    </button>

                    <span className="text-[#ccc] ml-2">A:</span>
                    <BluebeamColorPicker
                      color={toColor}
                      onChange={(c) => setToColor(c)}
                      allowTransparent={false}
                      title="Scegli nuovo colore (Preset Bluebeam o RGB)"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 cursor-pointer text-[#ccc]">
                      <input
                        type="checkbox"
                        checked={useTolerance}
                        onChange={(e) => setUseTolerance(e.target.checked)}
                        className="accent-[#0078d4]"
                      />
                      <span>Tolleranza</span>
                    </label>
                    {useTolerance && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="range"
                          min={5}
                          max={90}
                          value={tolerance}
                          onChange={(e) => setTolerance(Number(e.target.value))}
                          className="w-20 accent-[#0078d4]"
                        />
                        <span className="text-[11px] text-[#999] w-8 text-right">{tolerance}%</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Preset rapidi per colore di destinazione (A:) */}
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span className="text-[11px] text-[#888]">Preset rapidi (A):</span>
                  {QUICK_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setToColor(preset)}
                      className={`w-4 h-4 rounded-sm border transition cursor-pointer ${
                        toColor.toLowerCase() === preset.toLowerCase()
                          ? 'border-white scale-110 ring-1 ring-[#0078d4]'
                          : 'border-[#555] hover:border-[#aaa]'
                      }`}
                      style={{ backgroundColor: preset }}
                      title={`Imposta nuovo colore: ${preset}`}
                    />
                  ))}
                </div>

                {/* Azioni Aggiungi / Lista regole multiple */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex flex-wrap gap-1.5">
                    {rules.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-1.5 bg-[#2b2b30] border border-[#45454a] rounded px-2 py-0.5 text-[11px]"
                      >
                        <span className="w-3 h-3 rounded-sm border border-[#666]" style={{ backgroundColor: r.from }} />
                        <span>→</span>
                        <span className="w-3 h-3 rounded-sm border border-[#666]" style={{ backgroundColor: r.to }} />
                        <button
                          type="button"
                          onClick={() => handleRemoveRule(r.id)}
                          className="text-[#999] hover:text-red-400 ml-0.5"
                          title="Rimuovi"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleAddRule}
                    className="flex items-center gap-1 px-2.5 py-1 bg-[#2c2c32] hover:bg-[#383840] border border-[#45454a] rounded text-[11px] cursor-pointer"
                  >
                    <Plus size={12} />
                    <span>Aggiungi</span>
                  </button>
                </div>
              </>
            )}

            {mode === 'tint' && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[#ccc]">Nuovo colore:</span>
                <BluebeamColorPicker
                  color={toColor}
                  onChange={(c) => setToColor(c)}
                  allowTransparent={false}
                  title="Scegli nuovo colore (Preset Bluebeam o RGB)"
                />
                <div className="flex items-center gap-1.5 ml-2">
                  {QUICK_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setToColor(preset)}
                      className={`w-4 h-4 rounded-sm border transition cursor-pointer ${
                        toColor.toLowerCase() === preset.toLowerCase()
                          ? 'border-white scale-110 ring-1 ring-[#0078d4]'
                          : 'border-[#555] hover:border-[#aaa]'
                      }`}
                      style={{ backgroundColor: preset }}
                      title={`Imposta nuovo colore: ${preset}`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Anteprima Prima / Dopo */}
          <div className="border border-[#3a3a40] rounded p-3 bg-[#202024] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#aaa] uppercase tracking-wide">
                Anteprima
              </span>
              {pickingFromPreview && (
                <span className="text-[11px] text-[#50e6ff]">
                  Clicca su un punto dell&apos;immagine &quot;Prima&quot; per prelevare il colore di origine
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-[11px] text-[#bbb]">Prima:</div>
                <div
                  className={`h-44 bg-white border rounded flex items-center justify-center p-2 overflow-hidden ${
                    pickingFromPreview ? 'border-[#50e6ff] cursor-crosshair' : 'border-[#45454a]'
                  }`}
                >
                  <canvas
                    ref={beforeCanvasRef}
                    onClick={handleBeforeCanvasClick}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] text-[#bbb]">Dopo:</div>
                <div className="h-44 bg-white border border-[#45454a] rounded flex items-center justify-center p-2 overflow-hidden">
                  {previewAfterUrl ? (
                    <img
                      src={previewAfterUrl}
                      alt="Anteprima dopo elaborazione colore"
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <span className="text-[#888] text-[11px]">Elaborazione...</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 bg-[#1e1e22] border-t border-[#3a3a40]">
          <button
            type="button"
            disabled={isApplying}
            onClick={() => void handleApply()}
            className="px-4 py-1.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded text-[12px] font-medium cursor-pointer disabled:opacity-50"
          >
            {isApplying ? 'Applicazione...' : 'OK'}
          </button>
          <button
            type="button"
            onClick={() => setColorProcessingIds(null)}
            className="px-4 py-1.5 bg-[#2d2d32] hover:bg-[#3a3a40] text-[#e4e4e4] border border-[#45454a] rounded text-[12px] cursor-pointer"
          >
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
};
