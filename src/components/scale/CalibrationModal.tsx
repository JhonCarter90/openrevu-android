import React, { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { ScaleManager } from '@/core/scale/scaleManager';
import { Point2D, UnitType } from '@/types/markup';
import { Ruler, Check, X } from 'lucide-react';

interface CalibrationModalProps {
  p1: Point2D;
  p2: Point2D;
  onClose: () => void;
}

export const CalibrationModal: React.FC<CalibrationModalProps> = ({ p1, p2, onClose }) => {
  const [realDist, setRealDist] = useState<string>('1000');
  const [unit, setUnit] = useState<UnitType>('mm');
  const { setScaleCalibration, setActiveTool } = useAppStore();

  const handleConfirm = () => {
    const val = parseFloat(realDist);
    if (isNaN(val) || val <= 0) {
      alert('Inserisci un valore numerico positivo valido.');
      return;
    }

    try {
      const cal = ScaleManager.calibrate(p1, p2, val, unit);
      setScaleCalibration(cal);
      setActiveTool('select');
      onClose();
    } catch (err: any) {
      alert(err.message || 'Errore di calibrazione');
    }
  };

  const pixelDist = ScaleManager.calculateDistance(p1, p2);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-[#252526] border border-[#3e3e42] rounded-lg shadow-2xl p-5 w-96 text-xs text-[#cccccc]">
        <div className="flex items-center justify-between pb-3 border-b border-[#333333] mb-4">
          <div className="flex items-center space-x-2 text-white font-bold text-sm">
            <Ruler className="text-[#0078d4]" size={18} />
            <span>Calibra Scala del Disegno</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[#333333] rounded text-[#888]">
            <X size={16} />
          </button>
        </div>

        <p className="mb-3 text-[#aaaaaa]">
          Distanza misurata sul PDF:{' '}
          <strong className="text-white font-mono">{pixelDist.toFixed(1)} pt</strong>
        </p>

        <div className="space-y-3 mb-5">
          <label className="block text-white font-medium">Misura Reale Notata sulla Tavola:</label>
          <div className="flex space-x-2">
            <input
              type="number"
              step="any"
              value={realDist}
              onChange={(e) => setRealDist(e.target.value)}
              className="flex-1 bg-[#1e1e1e] border border-[#3c3c3c] rounded px-3 py-1.5 text-white font-mono text-sm focus:outline-none focus:border-[#0078d4]"
              placeholder="Es. 1000"
              autoFocus
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as UnitType)}
              className="bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2 py-1.5 text-white focus:outline-none focus:border-[#0078d4]"
            >
              <option value="mm">Millimetri (mm)</option>
              <option value="cm">Centimetri (cm)</option>
              <option value="m">Metri (m)</option>
              <option value="in">Pollici (in)</option>
              <option value="ft">Piedi (ft)</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded hover:bg-[#333333] text-[#aaaaaa]"
          >
            Annulla
          </button>
          <button
            onClick={handleConfirm}
            className="flex items-center space-x-1.5 px-4 py-1.5 bg-[#0078d4] hover:bg-[#106ebe] text-white font-medium rounded shadow transition"
          >
            <Check size={14} />
            <span>Applica Scala</span>
          </button>
        </div>
      </div>
    </div>
  );
};
