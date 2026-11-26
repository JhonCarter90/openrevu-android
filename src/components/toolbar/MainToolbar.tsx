import React from 'react';
import { useAppStore, extractFormatStyle } from '@/store/useAppStore';
import { MarkupType } from '@/types/markup';
import { BluebeamIcon } from '@/components/icons/BluebeamIcon';
import { triggerImageImportToPdf } from '@/core/utils/imageImport';
import { triggerFlattenActiveDocument } from '@/core/pdf/pdfFlattenService';
import { 
  Ruler, 
  Palette, 
  PaintBucket, 
  Magnet, 
  Ban,
  Paintbrush
} from 'lucide-react';

interface ToolButton {
  id: MarkupType;
  label: string;
  iconName: string;
}

const TOOLS: ToolButton[] = [
  // Navigazione & Selezione
  { id: 'select', label: 'Seleziona Oggetti (V)', iconName: 'select' },
  { id: 'pan', label: 'Panoramica (H / Spazio)', iconName: 'pan' },
  { id: 'select_text', label: 'Seleziona Testo PDF (Copia/Incolla - Ctrl+C)', iconName: 'select_text' },
  { id: 'edit_pdf_text', label: 'Modifica Testo Originale PDF (Stile Bluebeam Edit Text)', iconName: 'edit_pdf_text' },
  { id: 'calibrate', label: 'Calibra Scala 2 Punti', iconName: 'calibrate' },
  
  // Forme & Nuvolette (Icone Originali Bluebeam)
  { id: 'cloud_rect', label: 'Nuvoletta Rettangolare (C) - Trascina', iconName: 'cloud_rect' },
  { id: 'cloud', label: 'Nuvoletta Poligonale (Shift+C) - Punto per punto', iconName: 'cloud' },
  { id: 'cloud_plus', label: 'Nuvoletta con Callout Cloud+ (K)', iconName: 'cloud_plus' },
  { id: 'callout', label: 'Callout Freccia + Testo (Q)', iconName: 'callout' },
  { id: 'textbox', label: 'Casella di Testo (T)', iconName: 'textbox' },
  { id: 'rectangle', label: 'Rettangolo / Quadrato (R) - Trascina', iconName: 'rectangle' },
  { id: 'ellipse', label: 'Ellisse / Cerchio (E) - Trascina', iconName: 'ellipse' },
  { id: 'polygon', label: 'Poligono (Shift+P)', iconName: 'polygon' },
  { id: 'polyline', label: 'Polilinea (Shift+N)', iconName: 'polyline' },
  { id: 'connector', label: 'Connettore Ortogonale (Spezzata automatica - Shift = forma a L)', iconName: 'connector' },
  { id: 'line', label: 'Linea (L)', iconName: 'line' },
  { id: 'arrow', label: 'Freccia (A)', iconName: 'arrow' },
  { id: 'pen', label: 'Penna a Mano Libera (P)', iconName: 'pen' },
  { id: 'highlighter', label: 'Evidenziatore (H)', iconName: 'highlighter' },
  
  // Misure & Takeoff (Icone Originali Bluebeam)
  { id: 'measure_length', label: 'Quota Lineare (M / Shift+Alt+L)', iconName: 'measure_length' },
  { id: 'measure_polyline', label: 'Lunghezza Polilinea (Shift+Alt+Q)', iconName: 'measure_polyline' },
  { id: 'measure_area_rect', label: 'Area Rettangolare - Trascina', iconName: 'measure_area_rect' },
  { id: 'measure_area', label: 'Area Poligonale (Shift+Alt+A)', iconName: 'measure_area' },
  { id: 'measure_count', label: 'Conteggio Pallinatura (Shift+Alt+C)', iconName: 'measure_count' },
  { id: 'stamp', label: 'Timbro Tecnico (S)', iconName: 'stamp' },
  { id: 'snapshot', label: 'Istantanea Area PDF (G) - Copia negli appunti', iconName: 'snapshot' },
  { id: 'erase_content', label: 'Cancella Contenuto (Sbianca area PDF)', iconName: 'erase_content' },
];

const STROKE_COLORS = ['transparent', '#ff0000', '#0078d4', '#107c41', '#ffaa00', '#000000'];
const FILL_COLORS = ['transparent', '#ffff00', '#ff0000', '#0078d4', '#107c41', '#ffffff'];

export const MainToolbar: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    activeColor,
    setActiveColor,
    activeFillColor,
    setActiveFillColor,
    activeFillOpacity,
    setActiveFillOpacity,
    activeStrokeWidth,
    setActiveStrokeWidth,
    activeLineStyle,
    setActiveLineStyle,
    activeHatchPattern,
    setActiveHatchPattern,
    scaleCalibration,
    snapEnabled,
    setSnapEnabled,
    setActiveToolChestMarkup,
    selectedMarkupIds,
    markups,
    formatPainterStyle,
    setFormatPainterStyle,
  } = useAppStore();

  const selectedMarkup =
    selectedMarkupIds.length > 0
      ? markups.find((m) => m.id === selectedMarkupIds[0]) || null
      : null;

  const displayStrokeColor = (selectedMarkup as any)?.strokeColor ?? activeColor;
  const displayFillColor = (selectedMarkup as any)?.fillColor ?? activeFillColor;
  const displayFillOpacity =
    selectedMarkup && typeof (selectedMarkup as any).fillOpacity === 'number'
      ? (selectedMarkup as any).fillOpacity
      : activeFillOpacity;
  const displayHatchPattern = (selectedMarkup as any)?.hatchPattern ?? activeHatchPattern;

  const applyStrokeColorToSelected = (col: string) => {
    const st = useAppStore.getState();
    if (st.selectedMarkupIds.length === 0) return;
    st.selectedMarkupIds.forEach((id) => {
      const target = st.markups.find((m) => m.id === id);
      if (!target) return;
      const nextUpdates: any = { strokeColor: col };
      if (col === 'transparent') {
        nextUpdates.strokeWidth = 0;
      } else if ((target.strokeWidth ?? 0) === 0) {
        nextUpdates.strokeWidth = st.activeStrokeWidth > 0 ? st.activeStrokeWidth : 1.5;
      }
      if (target.compoundPaths && target.compoundPaths.length > 0) {
        nextUpdates.compoundPaths = target.compoundPaths.map((cp) => ({
          ...cp,
          strokeColor: col,
          ...(col === 'transparent' ? { strokeWidth: 0 } : {}),
        }));
      }
      st.updateMarkup(id, nextUpdates);
    });
  };

  const applyFillOrHatchToSelected = (updates: Record<string, any>) => {
    const st = useAppStore.getState();
    if (st.selectedMarkupIds.length === 0) return;
    st.selectedMarkupIds.forEach((id) => {
      const target = st.markups.find((m) => m.id === id);
      if (!target) return;
      const nextUpdates: any = { ...updates };
      if (
        updates.fillColor !== undefined &&
        updates.fillColor !== 'transparent' &&
        (target as any).fillOpacity === 0
      ) {
        nextUpdates.fillOpacity = st.activeFillOpacity > 0 ? st.activeFillOpacity : 1.0;
      }
      if (target.compoundPaths && target.compoundPaths.length > 0) {
        nextUpdates.compoundPaths = target.compoundPaths.map((cp) => ({
          ...cp,
          ...(updates.fillColor !== undefined ? { fillColor: updates.fillColor } : {}),
          ...(updates.hatchPattern !== undefined ? { hatchPattern: updates.hatchPattern } : {}),
        }));
      }
      st.updateMarkup(id, nextUpdates);
    });
  };

  return (
    <div className="bg-[#252526] border-b border-[#333333] flex flex-col text-xs select-none shrink-0">
      {/* LIVELLO 1: Strumenti di disegno/misura + Snap + Scala */}
      <div className="min-h-9 py-1 border-b border-[#2f2f32] flex items-center justify-between px-2 gap-2 flex-wrap">
        <div className="flex items-center space-x-1 flex-wrap">
          {TOOLS.map((tool) => {
            const isActive = activeTool === tool.id;
            const isSeparator = tool.id === 'calibrate' || tool.id === 'cloud_rect' || tool.id === 'measure_length';
            return (
              <React.Fragment key={tool.id}>
                {isSeparator && <div className="h-5 w-px bg-[#3e3e42] mx-1" />}
                <button
                  onClick={() => {
                    setActiveTool(tool.id);
                    setActiveToolChestMarkup(null);
                    if (tool.id !== 'select' && formatPainterStyle) {
                      setFormatPainterStyle(null);
                    }
                  }}
                  className={`w-[28px] h-[28px] rounded flex items-center justify-center transition cursor-pointer ${
                    isActive
                      ? 'bg-[#0078d4] text-white shadow ring-1 ring-white/40'
                      : 'text-[#cccccc] hover:bg-[#38383a] hover:text-white'
                  }`}
                  title={tool.label}
                >
                  <BluebeamIcon name={tool.iconName} size={17} />
                </button>
              </React.Fragment>
            );
          })}
          <button
            onClick={triggerImageImportToPdf}
            className="w-[28px] h-[28px] rounded flex items-center justify-center transition cursor-pointer text-[#cccccc] hover:bg-[#38383a] hover:text-white"
            title="Inserisci Immagine (PNG, JPG, SVG, WebP)"
          >
            <BluebeamIcon name="image" size={17} />
          </button>
          <button
            onClick={() => void triggerFlattenActiveDocument()}
            className="w-[28px] h-[28px] rounded flex items-center justify-center transition cursor-pointer text-[#cccccc] hover:bg-[#38383a] hover:text-white"
            title="Unisci livelli (Ctrl+Maiusc+M) - Fissa i commenti nel PDF"
          >
            <BluebeamIcon name="flatten" size={17} />
          </button>
          <div className="h-5 w-px bg-[#3e3e42] mx-1" />
          <button
            onClick={() => {
              if (formatPainterStyle) {
                setFormatPainterStyle(null);
                return;
              }
              setActiveTool('select');
              setActiveToolChestMarkup(null);
              const firstSel = selectedMarkupIds.length > 0
                ? markups.find((m) => m.id === selectedMarkupIds[0])
                : null;
              if (firstSel) {
                setFormatPainterStyle(extractFormatStyle(firstSel));
              } else {
                setFormatPainterStyle({ __waitingForSource: true } as any);
              }
            }}
            className={`w-[28px] h-[28px] rounded flex items-center justify-center transition cursor-pointer ${
              formatPainterStyle
                ? 'bg-[#0078d4] text-white shadow ring-1 ring-white/40'
                : 'text-[#cccccc] hover:bg-[#38383a] hover:text-white'
            }`}
            title="Copia formato (Ctrl+Maiusc+C) - Seleziona oggetto, attiva Copia formato, poi clicca sugli oggetti di destinazione"
          >
            <Paintbrush size={15} />
          </button>
        </div>

        <div className="flex items-center space-x-2 flex-shrink-0">
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded transition border ${
              snapEnabled
                ? 'bg-[#107c41]/30 border-[#107c41] text-[#00ff66]'
                : 'bg-[#1e1e1e] border-[#3e3e42] text-[#777]'
            }`}
            title="Snap ad Oggetto (Inizio, Punto Medio, Fine)"
          >
            <Magnet size={13} className={snapEnabled ? 'text-[#00ff66]' : 'text-[#777]'} />
            <span className="font-mono text-[11px]">Snap {snapEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <div className="flex items-center space-x-1 bg-[#1e1e1e] px-2 py-0.5 rounded border border-[#3c3c3c]">
            <Ruler size={12} className="text-[#00b7c3]" />
            <span className="font-mono text-[#00b7c3] font-medium text-[11px]">
              {scaleCalibration ? scaleCalibration.formattedText : '1:1'}
            </span>
          </div>
        </div>
      </div>

      {/* LIVELLO 2: Proprietà CAD (Contorno, Tratto, Stile, Retino, Riempimento, Opacità) */}
      <div className="min-h-8 py-1 bg-[#222224] flex items-center px-2 gap-3 flex-wrap">
        {/* Colore Contorno */}
        <div className="flex items-center space-x-1" title="Colore Contorno / Linea (barrato = nessun contorno)">
          <Palette size={13} className="text-[#888888] mr-0.5" />
          {STROKE_COLORS.map((col) => {
            const isTrans = col === 'transparent';
            return (
              <button
                key={col}
                onClick={() => {
                  setActiveColor(col);
                  applyStrokeColorToSelected(col);
                }}
                className={`w-3.5 h-3.5 rounded-full border transition flex items-center justify-center ${
                  displayStrokeColor === col ? 'border-white scale-110 shadow' : 'border-[#444]'
                }`}
                style={{ backgroundColor: isTrans ? '#1e1e1e' : col }}
                title={isTrans ? 'Nessun contorno (Trasparente)' : `Colore ${col}`}
              >
                {isTrans && <Ban size={10} className="text-red-400" />}
              </button>
            );
          })}
          <input
            type="color"
            value={displayStrokeColor === 'transparent' ? '#ff0000' : displayStrokeColor}
            onChange={(e) => {
              const col = e.target.value;
              setActiveColor(col);
              applyStrokeColorToSelected(col);
            }}
            className="w-4 h-4 bg-transparent cursor-pointer rounded border border-[#555]"
            title="Scegli colore linea personalizzato"
          />
        </div>

        {/* Spessore & Stile Tratto */}
        <div className="flex items-center space-x-1">
          <span className="text-[#888888]">Tratto:</span>
          {[0, 1, 2, 4, 8, 12, 16].map((w) => (
            <button
              key={w}
              onClick={() => {
                setActiveStrokeWidth(w);
                const st = useAppStore.getState();
                st.selectedMarkupIds.forEach((id) => {
                  const target = st.markups.find((m) => m.id === id);
                  if (!target) return;
                  const updates: any = { strokeWidth: w };
                  if (target.compoundPaths && target.compoundPaths.length > 0) {
                    updates.compoundPaths = target.compoundPaths.map((cp) => ({
                      ...cp,
                      strokeWidth: cp.strokeWidth === 0 ? 0 : w,
                    }));
                  }
                  st.updateMarkup(id, updates);
                });
              }}
              className={`px-1 py-0.5 rounded text-[10px] font-mono ${
                activeStrokeWidth === w ? 'bg-[#0078d4] text-white' : 'hover:bg-[#333333] text-[#aaa]'
              }`}
              title={w === 0 ? 'Senza contorno (0pt)' : `${w}pt`}
            >
              {w}pt
            </button>
          ))}
          <select
            value={activeLineStyle}
            onChange={(e) => {
              const s = e.target.value as any;
              setActiveLineStyle(s);
              const st = useAppStore.getState();
              if (st.selectedMarkupIds.length > 0) {
                st.selectedMarkupIds.forEach((id) => {
                  const target = st.markups.find((m) => m.id === id);
                  if (!target) return;
                  const updates: any = { lineStyle: s };
                  if (target.compoundPaths && target.compoundPaths.length > 0) {
                    updates.compoundPaths = target.compoundPaths.map((cp) => ({
                      ...cp,
                      lineStyle: s,
                    }));
                  }
                  st.updateMarkup(id, updates);
                });
              }
            }}
            className="bg-[#1e1e1e] border border-[#3c3c3c] text-white rounded px-1.5 py-0.5 text-[10px] focus:outline-none ml-1 max-w-[130px]"
            title="Tipo di Linea (CAD e Piping)"
          >
            <option value="solid">Continua</option>
            <option value="dashed">Tratteggiata</option>
            <option value="dotted">Puntinata</option>
            <option value="dash_dot">Tratto-Punto (Asse)</option>
            <option value="dash_dot_dot">Tratto-2Punti (Centro)</option>
            <option value="long_dash">Tratto Lungo</option>
            <option value="gas">Tubazione GAS</option>
            <option value="water">Tubazione CW (Acqua)</option>
            <option value="hot_water">Tubazione HW (Calda)</option>
            <option value="steam">Tubazione Vapore</option>
            <option value="drain">Tubazione Scarico</option>
            <option value="electric_signal">Segnale Elettrico (- - -)</option>
            <option value="pneumatic">Segnale Pneumatico (— // —)</option>
            <option value="hydraulic">Segnale Idraulico (— L —)</option>
            <option value="capillary">Tubo Capillare (— × —)</option>
            <option value="electromagnetic">Elettromagnetico (~ ~ ~)</option>
            <option value="data_link">Collegamento Dati (— ○ —)</option>
            <option value="heat_traced">Linea Tracciata (— T —)</option>
          </select>
        </div>

        <div className="h-4 w-px bg-[#3e3e42]" />

        {/* Campitura / Retino (Hatch) Rapido */}
        <div className="flex items-center space-x-1" title="Campitura / Retino Tecnico (Hatch)">
          <span className="text-[#888888]">Retino:</span>
          <select
            value={displayHatchPattern}
            onChange={(e) => {
              const pat = e.target.value as any;
              setActiveHatchPattern(pat);
              applyFillOrHatchToSelected({ hatchPattern: pat });
            }}
            className="bg-[#1e1e1e] border border-[#3c3c3c] text-white rounded px-1.5 py-0.5 text-[10px] focus:outline-none max-w-[130px]"
          >
            <option value="none">Nessuno</option>
            <option value="diagonal_right">ANSI31 (45°)</option>
            <option value="diagonal_left">ANSI32 (135°)</option>
            <option value="crosshatch">ANSI37 (Incrociato)</option>
            <option value="horizontal">Orizzontale</option>
            <option value="vertical">Verticale</option>
            <option value="brick">Muratura / Mattoni</option>
            <option value="dots">Calcestruzzo / Punti</option>
            <option value="zigzag">Isolamento / Terreno</option>
          </select>
        </div>

        <div className="h-4 w-px bg-[#3e3e42]" />

        {/* Riempimento (Fill) */}
        <div className="flex items-center space-x-1.5" title="Proprietà Riempimento (Fill)">
          <div className="flex items-center space-x-1">
            <PaintBucket size={13} className="text-[#00b7c3]" />
            <span className="text-[#888888]">Riempimento:</span>
            {FILL_COLORS.map((col) => {
              const isTrans = col === 'transparent';
              const isSelected = displayFillColor === col;
              return (
                <button
                  key={col}
                  onClick={() => {
                    setActiveFillColor(col);
                    applyFillOrHatchToSelected({ fillColor: col });
                  }}
                  className={`w-3.5 h-3.5 rounded border transition flex items-center justify-center ${
                    isSelected ? 'border-white scale-110 shadow' : 'border-[#444]'
                  }`}
                  style={{ backgroundColor: isTrans ? '#1e1e1e' : col }}
                  title={isTrans ? 'Nessun riempimento (Trasparente)' : `Colore ${col}`}
                >
                  {isTrans && <Ban size={10} className="text-red-400" />}
                </button>
              );
            })}
            <input
              type="color"
              value={displayFillColor === 'transparent' ? '#ffff00' : displayFillColor}
              onChange={(e) => {
                const col = e.target.value;
                setActiveFillColor(col);
                applyFillOrHatchToSelected({ fillColor: col });
              }}
              className="w-4 h-4 bg-transparent cursor-pointer rounded border border-[#555]"
              title="Colore riempimento personalizzato"
            />
          </div>

          <div className="flex items-center space-x-1 ml-1" title="Opacità Riempimento">
            <span className="text-[#888888] text-[10px]">Opacità:</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={displayFillOpacity}
              onChange={(e) => {
                const op = parseFloat(e.target.value);
                setActiveFillOpacity(op);
                applyFillOrHatchToSelected({ fillOpacity: op });
              }}
              className="w-14 accent-[#0078d4] cursor-pointer"
            />
            <span className="font-mono text-[#00b7c3] text-[10px] w-7">
              {Math.round(displayFillOpacity * 100)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
