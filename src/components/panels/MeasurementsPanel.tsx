import React, { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { ScaleManager } from '@/core/scale/scaleManager';
import { CalibrationModal } from '../scale/CalibrationModal';
import { Ruler, Check, Hash, Square, CornerDownRight } from 'lucide-react';

export const MeasurementsPanel: React.FC = () => {
  const {
    scaleCalibration,
    setScaleCalibration,
    markups,
    activeDocumentId,
    setActiveTool,
  } = useAppStore();

  const [showModal, setShowModal] = useState(false);

  // Calcolo totali computo / Takeoff
  const docMarkups = markups;

  let totalLength = 0;
  let totalArea = 0;
  let totalCount = 0;

  for (const m of docMarkups) {
    if (m.type === 'measure_length') {
      totalLength += (m as any).measuredLength || 0;
    } else if (m.type === 'measure_polyline' && (m as any).points) {
      totalLength += ScaleManager.calculatePolylineLength((m as any).points);
    } else if ((m.type === 'measure_area' || m.type === 'measure_area_rect') && (m as any).points) {
      totalArea += ScaleManager.calculatePolygonArea((m as any).points);
    } else if (m.type === 'measure_count') {
      totalCount += (m as any).locations?.length || 1;
    }
  }

  const presets = [
    { label: '1 : 100 (1cm = 1m)', ratio: 100 },
    { label: '1 : 50 (2cm = 1m)', ratio: 50 },
    { label: '1 : 20 (5cm = 1m)', ratio: 20 },
    { label: '1 : 1 (Scala Reale 1:1)', ratio: 1 },
  ];

  const handleApplyPreset = (ratio: number) => {
    // 1 mm PDF corrisponde a `ratio` mm reali
    setScaleCalibration({
      pixelDistance: 2.83465, // ~1mm a 72DPI
      realDistance: ratio,
      unit: 'mm',
      scaleRatio: ratio,
      formattedText: `1 : ${ratio}`,
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#202022] text-xs select-none">
      {/* Intestazione */}
      <div className="h-9 px-3 bg-[#1e1e1e] border-b border-[#333333] flex items-center justify-between font-bold text-white shrink-0">
        <div className="flex items-center space-x-1.5">
          <Ruler size={13} className="text-[#00b7c3]" />
          <span className="text-[12px]">Misure & Computo Metrico</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Calibrazione Attiva */}
        <div className="bg-[#181818] border border-[#333333] rounded p-2.5 space-y-2">
          <div className="text-[11px] font-semibold text-[#888] uppercase tracking-wider">
            Scala del Foglio
          </div>
          <div className="text-white font-mono text-xs flex items-center justify-between">
            <span>Stato:</span>
            <span className={scaleCalibration ? 'text-[#00ff66] font-semibold' : 'text-[#ffaa00]'}>
              {scaleCalibration ? `Calibrato (1:${scaleCalibration.scaleRatio.toFixed(0)})` : 'Non calibrato (Default)'}
            </span>
          </div>

          <button
            onClick={() => setActiveTool('calibrate')}
            className="w-full py-1.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded font-medium text-[11px] transition shadow"
            title="Seleziona due punti notevoli sul foglio per calibrare la scala"
          >
            Calibra Scala a 2 Punti...
          </button>
        </div>

        {/* Preset Rapidi di Scala */}
        <div>
          <div className="text-[11px] font-semibold text-[#888] mb-1.5 px-0.5">Scale CAD Frequenti</div>
          <div className="grid grid-cols-2 gap-1.5">
            {presets.map((p, idx) => (
              <button
                key={idx}
                onClick={() => handleApplyPreset(p.ratio)}
                className="px-2 py-1 bg-[#252526] hover:bg-[#333333] border border-[#3e3e42] rounded text-[10px] text-[#ccc] hover:text-white transition text-left"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Riepilogo Computo / Takeoff Live */}
        <div className="pt-2 border-t border-[#333333] space-y-2">
          <div className="text-[11px] font-semibold text-[#888] uppercase tracking-wider">
            Riepilogo Computo (Takeoff)
          </div>

          <div className="space-y-1.5 bg-[#181818] border border-[#333333] rounded p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center space-x-1.5 text-[#aaa]">
                <CornerDownRight size={12} className="text-[#0078d4]" />
                <span>Lunghezza Totale:</span>
              </div>
              <span className="font-mono text-white font-semibold">
                {ScaleManager.formatLength(totalLength, scaleCalibration)}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center space-x-1.5 text-[#aaa]">
                <Square size={12} className="text-[#00b7c3]" />
                <span>Superficie Totale:</span>
              </div>
              <span className="font-mono text-white font-semibold">
                {ScaleManager.formatArea(totalArea, scaleCalibration)}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center space-x-1.5 text-[#aaa]">
                <Hash size={12} className="text-[#ffbb00]" />
                <span>Conteggio Pezzi:</span>
              </div>
              <span className="font-mono text-white font-semibold">{totalCount} pz</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
