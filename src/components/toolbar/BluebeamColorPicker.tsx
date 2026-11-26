import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Pipette, ChevronDown, ChevronUp } from 'lucide-react';

export const BLUEBEAM_PALETTE_ROWS: string[][] = [
  // Row 1: Pastels
  ['#ffcccc', '#ffffcc', '#ccffcc', '#ccffff', '#cce5ff', '#ccccff', '#e5ccff', '#ffccff'],
  // Row 2: Bright / Vivid
  ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#00aaff', '#0000ff', '#7030a0', '#ff00ff'],
  // Row 3: Medium
  ['#c00000', '#ffc000', '#00b050', '#00a0a0', '#0070c0', '#002060', '#602080', '#b02070'],
  // Row 4: Dark
  ['#800000', '#e36c09', '#385723', '#1f497d', '#16365c', '#0f243e', '#401860', '#701840'],
  // Row 5: Deep / Earth
  ['#600000', '#7f6000', '#274e13', '#0c343d', '#0b1d3a', '#1a103c', '#300030', '#4a004a'],
];

export const BLUEBEAM_GRAYSCALE: string[] = [
  '#000000',
  '#333333',
  '#666666',
  '#999999',
  '#cccccc',
  '#ffffff',
];

interface BluebeamColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  allowTransparent?: boolean;
  title?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

const STORAGE_RECENT_KEY = 'openrevu_recent_colors';

export const BluebeamColorPicker: React.FC<BluebeamColorPickerProps> = ({
  color,
  onChange,
  allowTransparent = true,
  title = 'Seleziona colore',
  disabled = false,
  className = '',
  size = 'md',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customHex, setCustomHex] = useState(color === 'transparent' ? '#ffffff' : color);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [recentColors, setRecentColors] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_RECENT_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const nativeColorInputRef = useRef<HTMLInputElement>(null);

  // Aggiorna customHex quando il colore esterno cambia
  useEffect(() => {
    if (color && color !== 'transparent') {
      setCustomHex(color);
    }
  }, [color]);

  // Calcola le coordinate per visualizzare il popup sotto o sopra il pulsante
  const updateCoords = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const popupWidth = 190;
    const popupHeight = showAdvanced ? 260 : 200;

    let top = rect.bottom + 4;
    let left = rect.left;

    // Se sfora a destra, allinea verso sinistra
    if (left + popupWidth > window.innerWidth) {
      left = Math.max(8, window.innerWidth - popupWidth - 8);
    }

    // Se sfora in basso, apri verso l'alto
    if (top + popupHeight > window.innerHeight && rect.top - popupHeight > 0) {
      top = rect.top - popupHeight - 4;
    }

    setCoords({ top, left });
  };

  useEffect(() => {
    if (isOpen) {
      updateCoords();
      window.addEventListener('resize', updateCoords);
      window.addEventListener('scroll', updateCoords, true);
      return () => {
        window.removeEventListener('resize', updateCoords);
        window.removeEventListener('scroll', updateCoords, true);
      };
    }
  }, [isOpen, showAdvanced]);

  // Chiudi cliccando all'esterno
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current && buttonRef.current.contains(target)) {
        return;
      }
      if (popupRef.current && popupRef.current.contains(target)) {
        return;
      }
      setIsOpen(false);
    };
    window.addEventListener('mousedown', handleClickOutside, true);
    return () => window.removeEventListener('mousedown', handleClickOutside, true);
  }, [isOpen]);

  const recordRecentColor = (col: string) => {
    if (!col || col === 'transparent') return;
    setRecentColors((prev) => {
      const filtered = prev.filter((c) => c.toLowerCase() !== col.toLowerCase());
      const updated = [col, ...filtered].slice(0, 8);
      try {
        localStorage.setItem(STORAGE_RECENT_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleSelectColor = (selected: string) => {
    onChange(selected);
    if (selected !== 'transparent') {
      recordRecentColor(selected);
    }
    setIsOpen(false);
  };

  const handleEyeDropper = async () => {
    if ((window as any).EyeDropper) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        if (result && result.sRGBHex) {
          handleSelectColor(result.sRGBHex);
        }
      } catch {
        // Utente ha annullato
      }
    } else {
      nativeColorInputRef.current?.click();
    }
  };

  const isTransparent = color === 'transparent' || !color;
  const swatchDimension = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <div className={`inline-block ${className}`}>
      {/* Bottone Swatch Trigger (Stile Bluebeam Revu) */}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          updateCoords();
          setIsOpen((prev) => !prev);
        }}
        className={`${swatchDimension} rounded-xs border border-[#555] hover:border-[#0078d4] focus:outline-none transition relative flex items-center justify-center p-0 overflow-hidden cursor-pointer shadow-xs bg-[#1f1f20] disabled:opacity-50 disabled:cursor-not-allowed`}
        title={title}
      >
        {isTransparent ? (
          <svg viewBox="0 0 20 20" className="w-full h-full pointer-events-none">
            <rect width="20" height="20" fill="#2b2b2c" />
            <line x1="2" y1="18" x2="18" y2="2" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        ) : (
          <div
            className="w-full h-full"
            style={{ backgroundColor: color }}
          />
        )}
      </button>

      {/* Input nativo nascosto per fallback contagocce o altri colori */}
      <input
        ref={nativeColorInputRef}
        type="color"
        value={color === 'transparent' ? '#ffffff' : color}
        onChange={(e) => handleSelectColor(e.target.value)}
        className="opacity-0 absolute pointer-events-none w-0 h-0"
      />

      {/* Popup Palette Colori Bluebeam Revu montato tramite Portal su document.body (MAI tagliato da overflow) */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div 
          ref={popupRef}
          className="fixed bg-[#1e1e1e] border border-[#444444] rounded shadow-2xl p-2 select-none animate-in fade-in zoom-in-95 duration-75"
          style={{ 
            top: `${coords.top}px`, 
            left: `${coords.left}px`, 
            width: '184px',
            zIndex: 999999 
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Griglia Colori Principali: 5 Righe x 8 Colonne */}
          <div className="grid grid-cols-8 gap-1 mb-1.5">
            {BLUEBEAM_PALETTE_ROWS.flatMap((row, rIdx) =>
              row.map((cellCol, cIdx) => {
                const isSelected = !isTransparent && color.toLowerCase() === cellCol.toLowerCase();
                return (
                  <button
                    key={`${rIdx}-${cIdx}`}
                    type="button"
                    onClick={() => handleSelectColor(cellCol)}
                    className={`w-[17px] h-[17px] rounded-xs transition hover:scale-115 hover:z-10 focus:outline-none cursor-pointer border ${
                      isSelected ? 'border-white ring-1 ring-white' : 'border-[#333333] hover:border-white'
                    }`}
                    style={{ backgroundColor: cellCol }}
                    title={cellCol}
                  />
                );
              })
            )}
          </div>

          {/* Riga 6: Scala di Grigi (6 caselle) + Trasparente + Contagocce */}
          <div className="grid grid-cols-8 gap-1 pt-1 border-t border-[#333333] mb-1.5">
            {BLUEBEAM_GRAYSCALE.map((grayCol, idx) => {
              const isSelected = !isTransparent && color.toLowerCase() === grayCol.toLowerCase();
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectColor(grayCol)}
                  className={`w-[17px] h-[17px] rounded-xs transition hover:scale-115 hover:z-10 focus:outline-none cursor-pointer border ${
                    isSelected ? 'border-[#0078d4] ring-1 ring-[#0078d4]' : 'border-[#333333] hover:border-white'
                  }`}
                  style={{ backgroundColor: grayCol }}
                  title={grayCol}
                />
              );
            })}

            {/* Casella Trasparente (Bianco con linea rossa obliqua) */}
            {allowTransparent ? (
              <button
                type="button"
                onClick={() => handleSelectColor('transparent')}
                className={`w-[17px] h-[17px] rounded-xs bg-[#ffffff] border transition hover:scale-115 hover:z-10 focus:outline-none cursor-pointer relative overflow-hidden flex items-center justify-center ${
                  isTransparent ? 'border-[#0078d4] ring-1 ring-[#0078d4]' : 'border-[#333333] hover:border-white'
                }`}
                title="Trasparente (Nessun colore)"
              >
                <svg viewBox="0 0 16 16" className="w-full h-full pointer-events-none">
                  <line x1="2" y1="14" x2="14" y2="2" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            ) : (
              <div className="w-[17px] h-[17px]" />
            )}

            {/* Contagocce / Eyedropper */}
            <button
              type="button"
              onClick={handleEyeDropper}
              className="w-[17px] h-[17px] rounded-xs bg-[#2a2a2c] hover:bg-[#3a3a3c] border border-[#444444] hover:border-white flex items-center justify-center cursor-pointer transition hover:scale-115 focus:outline-none"
              title="Preleva colore dallo schermo (Contagocce)"
            >
              <Pipette size={11} className="text-[#ccc] hover:text-white" />
            </button>
          </div>

          {/* Riga 7: Colori Recenti / Personalizzati (8 slot stile Bluebeam) */}
          <div className="pt-1 border-t border-[#333333]">
            <div className="grid grid-cols-8 gap-1 mb-1">
              {Array.from({ length: 8 }).map((_, idx) => {
                const recCol = recentColors[idx];
                if (recCol) {
                  const isSelected = !isTransparent && color.toLowerCase() === recCol.toLowerCase();
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectColor(recCol)}
                      className={`w-[17px] h-[17px] rounded-xs transition hover:scale-115 focus:outline-none cursor-pointer border ${
                        isSelected ? 'border-white ring-1 ring-white' : 'border-[#444444] hover:border-white'
                      }`}
                      style={{ backgroundColor: recCol }}
                      title={recCol}
                    />
                  );
                }
                return (
                  <div
                    key={idx}
                    className="w-[17px] h-[17px] rounded-xs border border-[#333333] bg-[#252526]"
                  />
                );
              })}
            </div>

            {/* Freccia Espandi / Altri Colori Avanzati */}
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="w-full flex items-center justify-center py-0.5 text-[#888888] hover:text-white hover:bg-[#28282a] rounded text-[10px] transition cursor-pointer"
              title="Altri colori e codice Hex"
            >
              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {/* Pannello Avanzato Hex & Picker Spettro */}
            {showAdvanced && (
              <div className="mt-1 pt-1.5 border-t border-[#333333] space-y-1.5 animate-in fade-in duration-100">
                <div className="flex items-center space-x-1">
                  <span className="text-[#888] text-[10px] font-mono">Hex:</span>
                  <input
                    type="text"
                    value={customHex}
                    onChange={(e) => setCustomHex(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSelectColor(customHex);
                      }
                    }}
                    placeholder="#FFFFFF"
                    className="flex-1 bg-[#141414] border border-[#444] rounded px-1.5 py-0.5 text-white font-mono text-[10px] focus:outline-none focus:border-[#0078d4]"
                  />
                  <button
                    type="button"
                    onClick={() => handleSelectColor(customHex)}
                    className="px-1.5 py-0.5 bg-[#0078d4] hover:bg-[#006bbd] text-white rounded text-[10px] font-medium"
                  >
                    OK
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => nativeColorInputRef.current?.click()}
                  className="w-full py-1 bg-[#252526] hover:bg-[#333335] text-[#ccc] hover:text-white border border-[#444] rounded text-[10px] transition flex items-center justify-center space-x-1 cursor-pointer"
                >
                  <span>Spettro continuo...</span>
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
