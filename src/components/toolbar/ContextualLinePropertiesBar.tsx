import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { HatchPattern, LineEnding, LineStyle } from '@/types/markup';
import { 
  ChevronDown, 
  ChevronUp, 
  Sliders,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Maximize2
} from 'lucide-react';
import { BluebeamIcon } from '@/components/icons/BluebeamIcon';
import { BluebeamColorPicker } from './BluebeamColorPicker';

const BLUEBEAM_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

const LINE_STYLES: { id: LineStyle; label: string; dashPattern: string }[] = [
  { id: 'solid', label: 'Continua', dashPattern: 'solid' },
  { id: 'dashed', label: 'Tratteggiata', dashPattern: 'dashed' },
  { id: 'dotted', label: 'Puntinata', dashPattern: 'dotted' },
  { id: 'dash_dot', label: 'Tratto-Punto (Asse)', dashPattern: 'dash_dot' },
  { id: 'dash_dot_dot', label: 'Tratto-Doppio Punto', dashPattern: 'dash_dot_dot' },
  { id: 'long_dash', label: 'Tratto Lungo', dashPattern: 'long_dash' },
  { id: 'electric_signal', label: 'Segnale Elettrico (- - -)', dashPattern: 'dashed' },
  { id: 'pneumatic', label: 'Segnale Pneumatico (//)', dashPattern: 'solid' },
  { id: 'hydraulic', label: 'Segnale Idraulico (L)', dashPattern: 'solid' },
  { id: 'capillary', label: 'Tubo Capillare (×)', dashPattern: 'solid' },
  { id: 'electromagnetic', label: 'Elettromagnetico (~)', dashPattern: 'dotted' },
  { id: 'data_link', label: 'Collegamento Dati (○)', dashPattern: 'solid' },
  { id: 'heat_traced', label: 'Linea Tracciata (T)', dashPattern: 'solid' },
];

const LINE_ENDINGS: { id: LineEnding; label: string; symbol: string }[] = [
  { id: 'none', label: 'Nessuno', symbol: '―' },
  { id: 'tick', label: 'Trattino 45° CAD', symbol: '/' },
  { id: 'arrow', label: 'Freccia Chiusa', symbol: '➔' },
  { id: 'open_arrow', label: 'Freccia Aperta', symbol: '🠆' },
  { id: 'circle', label: 'Cerchio', symbol: '●' },
  { id: 'square', label: 'Quadrato', symbol: '■' },
];

const HATCH_OPTIONS: { id: HatchPattern; label: string }[] = [
  { id: 'none', label: 'Nessuno' },
  { id: 'diagonal_right', label: 'ANSI31 (45°)' },
  { id: 'diagonal_left', label: 'ANSI32 (135°)' },
  { id: 'crosshatch', label: 'ANSI37 (Incrociato)' },
  { id: 'horizontal', label: 'Orizzontale' },
  { id: 'vertical', label: 'Verticale' },
  { id: 'brick', label: 'Muratura / Mattoni' },
  { id: 'dots', label: 'Calcestruzzo / Punti' },
  { id: 'zigzag', label: 'Isolamento / Terreno' },
];

import { AVAILABLE_FONTS } from '@/core/fonts/fontDefinitions';

export const ContextualLinePropertiesBar: React.FC = () => {
  const {
    activeTool,
    selectFenceMode,
    setSelectFenceMode,
    activeColor,
    setActiveColor,
    activeStrokeWidth,
    setActiveStrokeWidth,
    activeOpacity,
    setActiveOpacity,
    activeLineStyle,
    setActiveLineStyle,
    activeLineStyleScale,
    setActiveLineStyleScale,
    activeStartHead,
    setActiveStartHead,
    activeEndHead,
    setActiveEndHead,
    activeFillColor,
    setActiveFillColor,
    activeFillOpacity,
    setActiveFillOpacity,
    activeHatchPattern,
    setActiveHatchPattern,
    activeFontFamily,
    setActiveFontFamily,
    activeFontSize,
    setActiveFontSize,
    activeFontBold,
    setActiveFontBold,
    activeFontItalic,
    setActiveFontItalic,
    activeTextAlign,
    setActiveTextAlign,
    activeVerticalAlign,
    setActiveVerticalAlign,
    autoSizeSelectedMarkups,
    selectedMarkupIds,
    markups,
    updateMarkup,
    activeRightPanel,
    setActiveRightPanel,
  } = useAppStore();

  const selectedMarkup = selectedMarkupIds.length === 1 
    ? markups.find((m) => m.id === selectedMarkupIds[0]) 
    : null;

  const isMeasurement = activeTool === 'measure_length' || selectedMarkup?.type === 'measure_length';
  const isTextCapable = selectedMarkup
    ? (selectedMarkup.type === 'textbox' || selectedMarkup.type === 'callout' || selectedMarkup.type === 'cloud_plus')
    : (activeTool === 'textbox' || activeTool === 'callout' || activeTool === 'cloud_plus');

  // Valori attivi (dal markup selezionato o dallo strumento corrente)
  const currentColor = selectedMarkup ? selectedMarkup.strokeColor : activeColor;
  const currentWidth = selectedMarkup ? selectedMarkup.strokeWidth : activeStrokeWidth;
  const currentOpacity = selectedMarkup ? Math.round((selectedMarkup.opacity ?? 1) * 100) : Math.round(activeOpacity * 100);
  const currentLineStyle = selectedMarkup ? (selectedMarkup.lineStyle || 'solid') : activeLineStyle;
  const currentLineStyleScale = selectedMarkup ? ((selectedMarkup as any).lineStyleScale ?? activeLineStyleScale ?? 1) : (activeLineStyleScale ?? 1);
  const currentStartHead = (selectedMarkup as any)?.startHead || activeStartHead;
  const currentEndHead = (selectedMarkup as any)?.endHead || (activeTool === 'arrow' ? 'arrow' : activeEndHead);
  
  // Riempimento & Campitura (Stile Bluebeam: 'Riempire:' e 'Tratteggio:')
  const currentFill = selectedMarkup ? (selectedMarkup.fillColor || 'transparent') : activeFillColor;
  const currentFillOpacity = selectedMarkup 
    ? Math.round(((selectedMarkup as any).fillOpacity ?? activeFillOpacity ?? 1.0) * 100) 
    : Math.round(activeFillOpacity * 100);
  const currentHatch = selectedMarkup ? ((selectedMarkup as any).hatchPattern || 'none') : activeHatchPattern;

  // Valori specifici testo / quota CAD
  const currentTextColor = (selectedMarkup as any)?.textColor || selectedMarkup?.strokeColor || '#000000';
  const currentFontSize = (selectedMarkup as any)?.fontSize || activeFontSize || 12;
  const currentFontFamily = (selectedMarkup as any)?.fontFamily || activeFontFamily || 'Segoe UI, sans-serif';
  const currentTextAlign = (selectedMarkup as any)?.textAlign || activeTextAlign || 'left';
  const currentVerticalAlign = (selectedMarkup as any)?.verticalAlign || activeVerticalAlign || 'top';
  const currentBold = (selectedMarkup as any)?.fontWeight === 'bold' || (!selectedMarkup && activeFontBold);
  const currentItalic = (selectedMarkup as any)?.fontStyle === 'italic' || (!selectedMarkup && activeFontItalic);
  const currentCustomText = (selectedMarkup as any)?.customText || '';
  const currentOffset = (selectedMarkup as any)?.extensionOffset !== undefined ? (selectedMarkup as any).extensionOffset : 24;
  const currentEnding = (selectedMarkup as any)?.dimensionEnding || 'tick';
  const currentTextPos = (selectedMarkup as any)?.textPosition || 'above';
  const currentTextBg = (selectedMarkup as any)?.showTextBackground ? ((selectedMarkup as any)?.textFillColor || '#181818') : 'transparent';

  const setColor = (c: string) => {
    setActiveColor(c);
    const st = useAppStore.getState();
    st.selectedMarkupIds.forEach((id) => {
      const target = st.markups.find((m) => m.id === id);
      if (!target) return;
      const updates: any = { strokeColor: c };
      if (target.compoundPaths && target.compoundPaths.length > 0) {
        updates.compoundPaths = target.compoundPaths.map((cp) => ({
          ...cp,
          strokeColor: cp.strokeColor === 'transparent' ? 'transparent' : c,
        }));
      }
      updateMarkup(id, updates);
    });
  };

  const setWidth = (w: number) => {
    const val = Math.max(0, Math.min(64, w));
    setActiveStrokeWidth(val);
    const st = useAppStore.getState();
    st.selectedMarkupIds.forEach((id) => {
      const target = st.markups.find((m) => m.id === id);
      if (!target) return;
      const updates: any = { strokeWidth: val };
      if (target.compoundPaths && target.compoundPaths.length > 0) {
        updates.compoundPaths = target.compoundPaths.map((cp) => ({
          ...cp,
          strokeWidth: cp.strokeWidth === 0 ? 0 : val,
        }));
      }
      updateMarkup(id, updates);
    });
  };

  const setLineScale = (sc: number) => {
    const val = Math.max(0.25, Math.min(5, Math.round(sc * 100) / 100));
    setActiveLineStyleScale(val);
    const st = useAppStore.getState();
    st.selectedMarkupIds.forEach((id) => {
      updateMarkup(id, { lineStyleScale: val } as any);
    });
  };

  const setOpacity = (pct: number) => {
    const val = Math.max(0, Math.min(100, pct));
    setActiveOpacity(val / 100);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { opacity: val / 100 });
  };

  const setLineStyle = (s: LineStyle) => {
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
        updateMarkup(id, updates);
      });
    }
  };

  const setStartHead = (h: LineEnding) => {
    setActiveStartHead(h);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { startHead: h });
  };

  const setEndHead = (h: LineEnding) => {
    setActiveEndHead(h);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { endHead: h });
  };

  const setFill = (f: string) => {
    setActiveFillColor(f);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { fillColor: f });
  };

  const setFillOpacity = (pct: number) => {
    const val = Math.max(0, Math.min(100, pct));
    setActiveFillOpacity(val / 100);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { fillOpacity: val / 100 } as any);
  };

  const setHatch = (h: HatchPattern) => {
    setActiveHatchPattern(h);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { hatchPattern: h } as any);
  };

  const setTextColor = (c: string) => {
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { textColor: c } as any);
  };

  const setTextAlign = (align: any) => {
    setActiveTextAlign(align);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { textAlign: align } as any);
  };

  const setVerticalAlign = (valign: any) => {
    setActiveVerticalAlign(valign);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { verticalAlign: valign } as any);
  };

  const toggleBold = () => {
    const next = !currentBold;
    setActiveFontBold(next);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { fontWeight: next ? 'bold' : 'normal' } as any);
  };

  const toggleItalic = () => {
    const next = !currentItalic;
    setActiveFontItalic(next);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { fontStyle: next ? 'italic' : 'normal' } as any);
  };

  const setFontSize = (sz: number) => {
    const val = Math.max(6, Math.min(72, sz));
    setActiveFontSize(val);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { fontSize: val } as any);
  };

  const setFontFamily = (f: string) => {
    setActiveFontFamily(f);
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { fontFamily: f } as any);
  };

  const setDimensionEnding = (ending: LineEnding) => {
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { dimensionEnding: ending } as any);
  };

  const setExtensionOffset = (offset: number) => {
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { extensionOffset: offset } as any);
  };

  return (
    <div className="h-9.5 bg-[#2b2b2c] border-b border-[#38383a] flex items-center px-2.5 space-x-2.5 text-[11.5px] text-[#cccccc] select-none shrink-0 overflow-x-auto shadow-xs">
      {/* 1. Icona dello strumento attivo con dropdown */}
      <div className="flex items-center space-x-0.5 px-1 py-0.5 bg-[#38383a] hover:bg-[#444] rounded border border-[#48484a] cursor-pointer">
        <BluebeamIcon name={activeTool === 'select' ? 'select' : activeTool} size={13} />
        <ChevronDown size={11} className="text-[#888]" />
      </div>

      {activeTool === 'select' && (
        <div className="flex items-center bg-[#1e1e1e] rounded p-0.5 border border-[#444]">
          <button
            type="button"
            onClick={() => setSelectFenceMode('rect')}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition ${
              selectFenceMode === 'rect'
                ? 'bg-[#0078d4] text-white'
                : 'text-[#aaa] hover:text-white'
            }`}
            title="Selezione Rettangolare (Verso Destra = Tutto compreso, Verso Sinistra = Interseca)"
          >
            ▭ Rettangolo
          </button>
          <button
            type="button"
            onClick={() => setSelectFenceMode('lasso')}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition ${
              selectFenceMode === 'lasso'
                ? 'bg-[#0078d4] text-white'
                : 'text-[#aaa] hover:text-white'
            }`}
            title="Selezione Lazo (oppure Alt + Trascina)"
          >
            ➰ Lazo
          </button>
        </div>
      )}

      <div className="h-4 w-px bg-[#404044]" />

      {/* 2. Linea / Quota: [ Palette Colori Bluebeam ] */}
      <div className="flex items-center space-x-1.5">
        <span className="text-[#aaaaaa] font-medium text-[11px]">{isMeasurement ? 'Quota:' : 'Linea:'}</span>
        <BluebeamColorPicker
          color={currentColor}
          onChange={setColor}
          allowTransparent={true}
          title="Colore Tratto / Contorno (barrato = nessun contorno)"
          size="sm"
        />
      </div>

      {/* 3. Opacità Linea: [ 100% ˄˅ ] */}
      <div className="flex items-center bg-[#1e1e1e] border border-[#444] rounded px-1.5 py-0.5 space-x-1" title="Opacità Tratto">
        <span className="w-8 text-right font-mono text-[11px] text-white">{currentOpacity}%</span>
        <div className="flex flex-col -space-y-1">
          <button 
            type="button" 
            onClick={() => setOpacity(currentOpacity + 5)}
            className="text-[#888] hover:text-white"
          >
            <ChevronUp size={9} />
          </button>
          <button 
            type="button" 
            onClick={() => setOpacity(currentOpacity - 5)}
            className="text-[#888] hover:text-white"
          >
            <ChevronDown size={9} />
          </button>
        </div>
      </div>

      {/* 4. Stile Linea: [ Continua ˅ ] */}
      <select
        value={currentLineStyle}
        onChange={(e) => setLineStyle(e.target.value as any)}
        className="bg-[#1e1e1e] border border-[#444] text-white rounded px-2 py-0.5 text-[11px] focus:outline-none"
        title="Stile linea"
      >
        {LINE_STYLES.map((st) => (
          <option key={st.id} value={st.id}>
            {st.label}
          </option>
        ))}
      </select>

      {/* 4b. Scala Linea (per tratteggi/simboli P&ID anche su simboli composti) */}
      <div className="flex items-center bg-[#1e1e1e] border border-[#444] rounded px-1.5 py-0.5 space-x-1" title="Scala Tipo Linea (tratteggio e marcatori)">
        <span className="text-[10px] text-[#888]">Sc:</span>
        <span className="w-8 text-right font-mono text-[11px] text-[#50e6ff]">{currentLineStyleScale.toFixed(2)}x</span>
        <div className="flex flex-col -space-y-1">
          <button
            type="button"
            onClick={() => setLineScale(currentLineStyleScale + 0.25)}
            className="text-[#888] hover:text-white"
          >
            <ChevronUp size={9} />
          </button>
          <button
            type="button"
            onClick={() => setLineScale(currentLineStyleScale - 0.25)}
            className="text-[#888] hover:text-white"
          >
            <ChevronDown size={9} />
          </button>
        </div>
      </div>

      {/* 5. Spessore: [ 1.00 pt ˄˅ ] */}
      <div className="flex items-center bg-[#1e1e1e] border border-[#444] rounded px-1.5 py-0.5 space-x-1" title="Spessore Tratto">
        <span className="w-12 text-right font-mono text-[11px] text-white">{currentWidth.toFixed(2)} pt</span>
        <div className="flex flex-col -space-y-1">
          <button 
            type="button" 
            onClick={() => setWidth(currentWidth + 0.5)}
            className="text-[#888] hover:text-white"
          >
            <ChevronUp size={9} />
          </button>
          <button 
            type="button" 
            onClick={() => setWidth(currentWidth - 0.5)}
            className="text-[#888] hover:text-white"
          >
            <ChevronDown size={9} />
          </button>
        </div>
      </div>

      <div className="h-4 w-px bg-[#404044]" />

      {/* 6. RIEMPIRE: [ Palette Colori Bluebeam con Trasparente ] [ Opacità ˄˅ ] */}
      <div className="flex items-center space-x-1.5" title="Proprietà Riempimento (Stile Bluebeam Revu)">
        <span className="text-[#aaaaaa] font-medium text-[11px]">Riempire:</span>
        <BluebeamColorPicker
          color={currentFill}
          onChange={setFill}
          allowTransparent={true}
          title="Colore Riempimento (con opzione Trasparente / Nessun Riempimento)"
          size="sm"
        />

        {/* Opacità Riempimento: [ 100% ˄˅ ] */}
        <div 
          className={`flex items-center bg-[#1e1e1e] border border-[#444] rounded px-1.5 py-0.5 space-x-1 ${
            currentFill === 'transparent' ? 'opacity-40 pointer-events-none' : ''
          }`}
          title="Opacità Riempimento"
        >
          <span className="w-8 text-right font-mono text-[11px] text-white">{currentFillOpacity}%</span>
          <div className="flex flex-col -space-y-1">
            <button 
              type="button" 
              onClick={() => setFillOpacity(currentFillOpacity + 5)}
              className="text-[#888] hover:text-white"
            >
              <ChevronUp size={9} />
            </button>
            <button 
              type="button" 
              onClick={() => setFillOpacity(currentFillOpacity - 5)}
              className="text-[#888] hover:text-white"
            >
              <ChevronDown size={9} />
            </button>
          </div>
        </div>

        {/* Tratteggio / Campitura Tecnico */}
        <span className="text-[#aaaaaa] font-medium text-[11px] pl-1">Tratteggio:</span>
        <select
          value={currentHatch}
          onChange={(e) => setHatch(e.target.value as any)}
          className="bg-[#1e1e1e] border border-[#444] text-white rounded px-1.5 py-0.5 text-[11px] focus:outline-none max-w-[125px]"
          title="Tratteggio / Campitura Tecnica"
        >
          {HATCH_OPTIONS.map((ho) => (
            <option key={ho.id} value={ho.id}>
              {ho.label}
            </option>
          ))}
        </select>
      </div>

      <div className="h-4 w-px bg-[#404044]" />

      {/* 7. SEZIONE SPECIFICA: QUOTA CAD vs TERMINAZIONI LINEA */}
      {isMeasurement ? (
        <>
          {/* Testo Quota: Colore con BluebeamColorPicker */}
          <div className="flex items-center space-x-1">
            <span className="text-[#aaa] text-[11px]">Testo:</span>
            <BluebeamColorPicker
              color={currentTextColor}
              onChange={setTextColor}
              allowTransparent={false}
              title="Colore testo quota"
              size="sm"
            />
          </div>

          {/* Font Family */}
          <select
            value={currentFontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            className="bg-[#1e1e1e] border border-[#444] text-white rounded px-1.5 py-0.5 text-[11px] focus:outline-none max-w-[95px]"
            title="Carattere quota"
          >
            {AVAILABLE_FONTS.map((f) => (
              <option key={f.id} value={f.family}>
                {f.name}
              </option>
            ))}
          </select>

          {/* Font Size stile Bluebeam (dropdown + step 1pt) */}
          <div className="flex items-center bg-[#1e1e1e] border border-[#444] rounded px-1 py-0.5 space-x-0.5" title="Dimensione Font Quota">
            <select
              value={currentFontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="bg-[#1e1e1e] text-white font-mono text-[11px] focus:outline-none cursor-pointer pr-0.5"
            >
              {!BLUEBEAM_FONT_SIZES.includes(currentFontSize) && (
                <option value={currentFontSize}>{currentFontSize}</option>
              )}
              {BLUEBEAM_FONT_SIZES.map((sz) => (
                <option key={sz} value={sz}>
                  {sz}
                </option>
              ))}
            </select>
            <div className="flex flex-col -space-y-1 pl-0.5">
              <button 
                type="button" 
                onClick={() => setFontSize(currentFontSize + 1)}
                className="text-[#888] hover:text-white"
              >
                <ChevronUp size={9} />
              </button>
              <button 
                type="button" 
                onClick={() => setFontSize(currentFontSize - 1)}
                className="text-[#888] hover:text-white"
              >
                <ChevronDown size={9} />
              </button>
            </div>
          </div>

          {/* Simbolo Terminale Quota */}
          <div className="flex items-center space-x-1">
            <span className="text-[#aaa] text-[11px]">Terminale:</span>
            <select
              value={currentEnding}
              onChange={(e) => setDimensionEnding(e.target.value as any)}
              className="bg-[#1e1e1e] border border-[#444] text-white rounded px-1.5 py-0.5 text-[11px] font-mono focus:outline-none"
              title="Terminazione testimoni di quota"
            >
              <option value="tick">/ Tick 45°</option>
              <option value="arrow">➔ Freccia</option>
              <option value="open_arrow">🠆 Aperta</option>
              <option value="circle">● Punto</option>
            </select>
          </div>

          {/* Offset Linee Estensione */}
          <div className="flex items-center bg-[#1e1e1e] border border-[#444] rounded px-1 py-0.5 space-x-0.5" title="Offset Linee di Estensione (Testimoni)">
            <span className="text-[#777] text-[10px]">dst:</span>
            <span className="w-6 text-right font-mono text-[11px] text-white">{currentOffset}</span>
            <span className="text-[#777] text-[10px]">pt</span>
            <div className="flex flex-col -space-y-1 pl-0.5">
              <button 
                type="button" 
                onClick={() => setExtensionOffset(currentOffset + 4)}
                className="text-[#888] hover:text-white"
              >
                <ChevronUp size={9} />
              </button>
              <button 
                type="button" 
                onClick={() => setExtensionOffset(currentOffset - 4)}
                className="text-[#888] hover:text-white"
              >
                <ChevronDown size={9} />
              </button>
            </div>
          </div>

          {/* Testo Quota se selezionato */}
          {selectedMarkup && (
            <>
              <div className="flex items-center space-x-1">
                <span className="text-[#aaa] text-[11px]">Valore:</span>
                <input
                  type="text"
                  placeholder="Auto"
                  value={currentCustomText}
                  onChange={(e) => updateMarkup(selectedMarkup.id, { customText: e.target.value || undefined } as any)}
                  className="w-16 bg-[#1e1e1e] border border-[#444] text-white font-mono text-[11px] px-1 py-0.5 rounded focus:outline-none focus:border-[#0078d4]"
                  title="Modifica o sovrascrivi testo quota"
                />
              </div>

              {/* Posizione Quota Sopra / Centro */}
              <button
                type="button"
                onClick={() => updateMarkup(selectedMarkup.id, { textPosition: currentTextPos === 'above' ? 'center' : 'above' } as any)}
                className="px-1.5 py-0.5 rounded text-[10px] bg-[#1e1e1e] text-[#ccc] border border-[#444] hover:text-white hover:border-[#0078d4] font-medium"
                title="Posizione testo: Sopra la linea (standard CAD) / Centrata"
              >
                {currentTextPos === 'above' ? 'Sopra' : 'Centro'}
              </button>

              {/* Sfondo Quota Palette con Trasparente */}
              <div className="flex items-center space-x-1">
                <span className="text-[#aaa] text-[10px]">Sfondo:</span>
                <BluebeamColorPicker
                  color={currentTextBg}
                  onChange={(c) => {
                    if (c === 'transparent') {
                      updateMarkup(selectedMarkup.id, { showTextBackground: false } as any);
                    } else {
                      updateMarkup(selectedMarkup.id, { showTextBackground: true, textFillColor: c } as any);
                    }
                  }}
                  allowTransparent={true}
                  title="Sfondo Testo Quota (Trasparente / Colore)"
                  size="sm"
                />
              </div>
            </>
          )}
        </>
      ) : isTextCapable ? (
        <>
          {/* Colore Testo con BluebeamColorPicker */}
          <div className="flex items-center space-x-1">
            <span className="text-[#aaa] text-[11px]">Testo:</span>
            <BluebeamColorPicker
              color={currentTextColor}
              onChange={setTextColor}
              allowTransparent={false}
              title="Colore testo"
              size="sm"
            />
          </div>

          {selectedMarkup?.type === 'cloud_plus' && (
            <div className="flex items-center space-x-1">
              <span className="text-[#aaa] text-[11px]">Sfondo Testo:</span>
              <BluebeamColorPicker
                color={(selectedMarkup as any).textFillColor || 'transparent'}
                onChange={(c) => updateMarkup(selectedMarkup.id, { textFillColor: c } as any)}
                allowTransparent={true}
                title="Riempimento separato per il riquadro di testo (Nuvola usa 'Riempire:')"
                size="sm"
              />
            </div>
          )}

          {/* Font Family */}
          <select
            value={currentFontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            className="bg-[#1e1e1e] border border-[#444] text-white rounded px-1.5 py-0.5 text-[11px] focus:outline-none max-w-[105px]"
            title="Carattere (Font)"
          >
            {AVAILABLE_FONTS.map((f: any) => (
              <option key={f.id} value={f.family}>
                {f.name}
              </option>
            ))}
          </select>

          {/* Font Size stile Bluebeam (dropdown + step 1pt) */}
          <div className="flex items-center bg-[#1e1e1e] border border-[#444] rounded px-1 py-0.5 space-x-0.5" title="Dimensione Font">
            <select
              value={currentFontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="bg-[#1e1e1e] text-white font-mono text-[11px] focus:outline-none cursor-pointer pr-0.5"
            >
              {!BLUEBEAM_FONT_SIZES.includes(currentFontSize) && (
                <option value={currentFontSize}>{currentFontSize}</option>
              )}
              {BLUEBEAM_FONT_SIZES.map((sz) => (
                <option key={sz} value={sz}>
                  {sz}
                </option>
              ))}
            </select>
            <div className="flex flex-col -space-y-1 pl-0.5">
              <button 
                type="button" 
                onClick={() => setFontSize(currentFontSize + 1)}
                className="text-[#888] hover:text-white"
              >
                <ChevronUp size={9} />
              </button>
              <button 
                type="button" 
                onClick={() => setFontSize(currentFontSize - 1)}
                className="text-[#888] hover:text-white"
              >
                <ChevronDown size={9} />
              </button>
            </div>
          </div>

          {/* Grassetto / Corsivo */}
          <div className="flex items-center space-x-0.5 bg-[#1e1e1e] border border-[#444] rounded p-0.5">
            <button
              type="button"
              onClick={toggleBold}
              className={`p-1 rounded text-xs ${currentBold ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
              title="Grassetto"
            >
              <Bold size={11} />
            </button>
            <button
              type="button"
              onClick={toggleItalic}
              className={`p-1 rounded text-xs ${currentItalic ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
              title="Corsivo"
            >
              <Italic size={11} />
            </button>
          </div>

          {/* Allineamento Orizzontale (Sinistra, Centro, Destra, Giustificato) */}
          <div className="flex items-center space-x-0.5 bg-[#1e1e1e] border border-[#444] rounded p-0.5">
            <button
              type="button"
              onClick={() => setTextAlign('left')}
              className={`p-1 rounded text-xs ${currentTextAlign === 'left' ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
              title="Allinea a Sinistra"
            >
              <AlignLeft size={11} />
            </button>
            <button
              type="button"
              onClick={() => setTextAlign('center')}
              className={`p-1 rounded text-xs ${currentTextAlign === 'center' ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
              title="Allinea al Centro"
            >
              <AlignCenter size={11} />
            </button>
            <button
              type="button"
              onClick={() => setTextAlign('right')}
              className={`p-1 rounded text-xs ${currentTextAlign === 'right' ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
              title="Allinea a Destra"
            >
              <AlignRight size={11} />
            </button>
            <button
              type="button"
              onClick={() => setTextAlign('justify')}
              className={`p-1 rounded text-xs ${currentTextAlign === 'justify' ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
              title="Giustificato"
            >
              <AlignJustify size={11} />
            </button>
          </div>

          {/* Allineamento Verticale (In alto, Al centro, In basso) */}
          <div className="flex items-center space-x-0.5 bg-[#1e1e1e] border border-[#444] rounded p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => setVerticalAlign('top')}
              className={`px-1.5 py-0.5 rounded ${currentVerticalAlign === 'top' ? 'bg-[#0078d4] text-white font-semibold' : 'text-[#888] hover:text-white'}`}
              title="Allinea in Alto (Top)"
            >
              Alto
            </button>
            <button
              type="button"
              onClick={() => setVerticalAlign('middle')}
              className={`px-1.5 py-0.5 rounded ${currentVerticalAlign === 'middle' ? 'bg-[#0078d4] text-white font-semibold' : 'text-[#888] hover:text-white'}`}
              title="Allinea al Centro Verticale (Middle)"
            >
              Centro
            </button>
            <button
              type="button"
              onClick={() => setVerticalAlign('bottom')}
              className={`px-1.5 py-0.5 rounded ${currentVerticalAlign === 'bottom' ? 'bg-[#0078d4] text-white font-semibold' : 'text-[#888] hover:text-white'}`}
              title="Allinea in Basso (Bottom)"
            >
              Basso
            </button>
          </div>

          {/* Adatta Casella a Testo (Alt+Z) */}
          <button
            type="button"
            onClick={autoSizeSelectedMarkups}
            className="flex items-center space-x-1 px-1.5 py-0.5 bg-[#0078d4]/20 hover:bg-[#0078d4]/40 text-[#00b7c3] hover:text-white border border-[#0078d4]/40 rounded text-[10px] font-mono transition cursor-pointer"
            title="Adatta Casella di Testo (Scorciatoia: Alt+Z come Bluebeam Revu)"
          >
            <Maximize2 size={10} />
            <span>Adatta (Alt+Z)</span>
          </button>
        </>
      ) : (
        <>
          {/* Inizio: [ ― ˅ ] */}
          <div className="flex items-center space-x-1">
            <span className="text-[#aaa] text-[11px]">Inizio:</span>
            <select
              value={currentStartHead}
              onChange={(e) => setStartHead(e.target.value as any)}
              className="bg-[#1e1e1e] border border-[#444] text-white rounded px-1.5 py-0.5 text-[11px] font-mono focus:outline-none"
              title="Terminazione iniziale linea"
            >
              {LINE_ENDINGS.map((le) => (
                <option key={le.id} value={le.id}>
                  {le.symbol} {le.label}
                </option>
              ))}
            </select>
          </div>

          {/* Fine: [ ➜ ˅ ] */}
          <div className="flex items-center space-x-1">
            <span className="text-[#aaa] text-[11px]">Fine:</span>
            <select
              value={currentEndHead}
              onChange={(e) => setEndHead(e.target.value as any)}
              className="bg-[#1e1e1e] border border-[#444] text-white rounded px-1.5 py-0.5 text-[11px] font-mono focus:outline-none"
              title="Terminazione finale linea"
            >
              {LINE_ENDINGS.map((le) => (
                <option key={le.id} value={le.id}>
                  {le.symbol} {le.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Scorciatoia Pannello Proprietà Destro */}
      <button
        type="button"
        onClick={() => setActiveRightPanel(activeRightPanel === 'properties' ? 'none' : 'properties')}
        className={`p-1 rounded transition border ml-auto ${
          activeRightPanel === 'properties'
            ? 'bg-[#0078d4] text-white border-[#0078d4]'
            : 'bg-[#38383a] hover:bg-[#444] text-[#ccc] hover:text-white border-[#48484a]'
        }`}
        title="Apri pannello proprietà avanzate"
      >
        <Sliders size={12} />
      </button>
    </div>
  );
};
