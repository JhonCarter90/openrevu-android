import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { MarkupStatus } from '@/types/markup';
import { 
  Sliders, 
  Trash2, 
  Lock, 
  Unlock, 
  Copy, 
  Type, 
  Paintbrush, 
  Info,
  ChevronRight,
  ChevronLeft,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Maximize2
} from 'lucide-react';
import { BluebeamColorPicker } from '@/components/toolbar/BluebeamColorPicker';
import { AVAILABLE_FONTS } from '@/core/fonts/fontDefinitions';

export const PropertiesSidebar: React.FC = () => {
  const {
    markups,
    selectedMarkupIds,
    updateMarkup,
    deleteMarkup,
    addMarkup,
    lockedMarkupIds,
    toggleLockMarkup,
    activeRightPanel,
    setActiveRightPanel,
    activeTool,
    activeColor,
    setActiveColor,
    activeFillColor,
    setActiveFillColor,
    activeFillOpacity,
    setActiveFillOpacity,
    activeStrokeWidth,
    setActiveStrokeWidth,
    activeOpacity,
    setActiveOpacity,
    activeLineStyle,
    setActiveLineStyle,
    activeFontFamily,
    setActiveFontFamily,
    activeFontSize,
    setActiveFontSize,
    activeTextAlign,
    setActiveTextAlign,
    activeVerticalAlign,
    setActiveVerticalAlign,
    autoSizeSelectedMarkups,
    currentUser,
  } = useAppStore();

  const [panelWidth, setPanelWidth] = React.useState<number>(270);
  const isDraggingRef = React.useRef(false);

  const handlePointerDownResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startW = panelWidth;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const delta = startX - moveEvent.clientX;
      const newW = Math.max(190, Math.min(560, startW + delta));
      setPanelWidth(newW);
    };

    const onPointerUp = () => {
      isDraggingRef.current = false;
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerUp);
    };

    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerUp);
  };

  const isOpen = activeRightPanel !== 'none';
  const selectedMarkup = markups.find((m) => selectedMarkupIds.includes(m.id));
  const isLocked = selectedMarkup ? lockedMarkupIds.includes(selectedMarkup.id) : false;

  const handleDuplicate = () => {
    if (!selectedMarkup) return;
    const clone = structuredClone(selectedMarkup);
    clone.id = crypto.randomUUID();
    clone.creationDate = new Date().toISOString();
    clone.modificationDate = new Date().toISOString();
    if (clone.compoundPaths && clone.compoundPaths.length > 0) {
      clone.compoundPaths = clone.compoundPaths.map((cp) => ({
        ...cp,
        points: cp.points ? cp.points.map((p) => ({ x: p.x + 20, y: p.y + 20 })) : undefined,
        circle: cp.circle ? { ...cp.circle, cx: cp.circle.cx + 20, cy: cp.circle.cy + 20 } : undefined,
        ellipse: cp.ellipse ? { ...cp.ellipse, cx: cp.ellipse.cx + 20, cy: cp.ellipse.cy + 20 } : undefined,
        rect: cp.rect ? { ...cp.rect, x: cp.rect.x + 20, y: cp.rect.y + 20 } : undefined,
      }));
    }
    if ('boxRect' in clone && clone.boxRect) {
      clone.boxRect.x += 20;
      clone.boxRect.y += 20;
    } else if ('points' in clone && Array.isArray((clone as any).points)) {
      (clone as any).points = (clone as any).points.map((p: any) => ({ x: p.x + 20, y: p.y + 20 }));
    } else if ('startPoint' in clone) {
      (clone as any).startPoint.x += 20;
      (clone as any).startPoint.y += 20;
      (clone as any).endPoint.x += 20;
      (clone as any).endPoint.y += 20;
    }
    addMarkup(clone);
  };

  const LINE_STYLES = [
    { id: 'solid', label: 'Continua' },
    { id: 'dashed', label: 'Tratteggiata' },
    { id: 'dotted', label: 'Puntinata' },
    { id: 'dash_dot', label: 'Tratto-Punto' },
  ];

  return (
    <div className="flex h-full z-20 shrink-0 select-none">
      {/* Cassetto Contenuto Proprietà ridimensionabile */}
      {isOpen && (
        <aside
          style={{ width: `${panelWidth}px` }}
          className="relative bg-[#222225] border-l border-[#333333] flex flex-col text-xs shadow-2xl animate-in slide-in-from-right-2 duration-150"
        >
          {/* Maniglia splitter ridimensionamento a sinistra */}
          <div
            onPointerDown={handlePointerDownResize}
            style={{ touchAction: 'none' }}
            className="absolute top-0 left-0 w-2.5 h-full cursor-col-resize hover:bg-[#0078d4]/70 active:bg-[#0078d4] transition z-30"
            title="Trascina per allargare o stringere il pannello proprietà"
          />
          {/* Intestazione Pannello */}
          <div className="h-9 px-3 bg-[#1a1a1c] border-b border-[#333333] flex items-center justify-between font-bold text-white shrink-0">
            <div className="flex items-center space-x-1.5 truncate">
              <Sliders size={13} className="text-[#0078d4]" />
              <span className="truncate">
                {selectedMarkup ? `Proprietà: ${selectedMarkup.subject || 'Marcatura'}` : 'Proprietà Predefinite'}
              </span>
            </div>

            {selectedMarkup && (
              <div className="flex items-center space-x-1 shrink-0">
                <button
                  onClick={() => toggleLockMarkup(selectedMarkup.id)}
                  className={`p-1 rounded transition ${isLocked ? 'text-[#ffaa00] bg-[#333]' : 'text-[#888] hover:text-white'}`}
                  title={isLocked ? 'Sblocca marcatura (Lock attivo)' : 'Blocca marcatura contro modifiche accidentali'}
                >
                  {isLocked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
                <button
                  onClick={handleDuplicate}
                  className="p-1 hover:bg-[#333] text-[#888] hover:text-white rounded transition"
                  title="Duplica marcatura (Ctrl+D)"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={() => deleteMarkup(selectedMarkup.id)}
                  disabled={isLocked}
                  className="p-1 hover:bg-red-500/20 text-[#888] hover:text-red-400 disabled:opacity-30 rounded transition"
                  title="Elimina marcatura (Canc)"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4 text-[#ccc]">
            {selectedMarkup ? (
              <>
                {/* 1. SEZIONE ASPETTO (STILE LINEA E RIEMPIMENTO) */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[#ededed] font-medium text-[12px]">
                    <Paintbrush size={14} strokeWidth={1.5} className="text-[#85858b]" />
                    <span>Aspetto grafico</span>
                  </div>

                  {/* Colore e Spessore Linea */}
                  <div className="grid grid-cols-2 gap-2 bg-[#1a1a1c] p-2 rounded border border-[#333333]">
                    <div>
                      <span className="text-[#888] text-[10px] block mb-1">Colore Tratto</span>
                      <div className="flex items-center space-x-1.5">
                        <BluebeamColorPicker
                          disabled={isLocked}
                          color={selectedMarkup.strokeColor}
                          onChange={(c) => updateMarkup(selectedMarkup.id, { strokeColor: c })}
                          allowTransparent={false}
                          title="Colore Tratto"
                          size="sm"
                        />
                        <span className="font-mono text-[10px] text-white uppercase">{selectedMarkup.strokeColor}</span>
                      </div>
                    </div>

                    <div>
                      <span className="text-[#888] text-[10px] block mb-1">Spessore ({selectedMarkup.strokeWidth}pt)</span>
                      <input
                        type="range"
                        disabled={isLocked}
                        min="0.5"
                        max="12"
                        step="0.5"
                        value={selectedMarkup.strokeWidth}
                        onChange={(e) => updateMarkup(selectedMarkup.id, { strokeWidth: parseFloat(e.target.value) })}
                        className="w-full accent-[#0078d4]"
                      />
                    </div>
                  </div>

                  {/* Stile Tratto */}
                  <div className="bg-[#1a1a1c] p-2 rounded border border-[#333333] space-y-1.5">
                    <span className="text-[#888] text-[10px] block">Stile del Tratto</span>
                    <select
                      disabled={isLocked}
                      value={selectedMarkup.lineStyle || 'solid'}
                      onChange={(e) => updateMarkup(selectedMarkup.id, { lineStyle: e.target.value as any })}
                      className="w-full bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 text-white text-[11px] focus:outline-none focus:border-[#0078d4]"
                    >
                      {LINE_STYLES.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.label}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center justify-between text-[11px] pt-1">
                      <span className="text-[#888]">Opacità Linea:</span>
                      <span className="font-mono text-white">{Math.round((selectedMarkup.opacity ?? 1) * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      disabled={isLocked}
                      min="0"
                      max="1.0"
                      step="0.05"
                      value={selectedMarkup.opacity ?? 1}
                      onChange={(e) => updateMarkup(selectedMarkup.id, { opacity: parseFloat(e.target.value) })}
                      className="w-full accent-[#0078d4]"
                    />
                  </div>

                  {/* Riempimento */}
                  {'fillColor' in selectedMarkup && (
                    <div className="bg-[#1a1a1c] p-2 rounded border border-[#333333] space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[#888] text-[10px]">Colore Riempimento</span>
                        <span className="text-[9px] text-[#888]">
                          {(selectedMarkup as any).fillColor === 'transparent' ? 'Nessun riempimento' : (selectedMarkup as any).fillColor}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <BluebeamColorPicker
                          disabled={isLocked}
                          color={(selectedMarkup as any).fillColor || 'transparent'}
                          onChange={(c) => updateMarkup(selectedMarkup.id, { fillColor: c })}
                          allowTransparent={true}
                          title="Colore Riempimento (Trasparente o Colore)"
                          size="sm"
                        />
                        <span className="font-mono text-[10px] text-white">
                          {(selectedMarkup as any).fillColor === 'transparent' ? 'Trasparente' : (selectedMarkup as any).fillColor}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-1">
                        <span className="text-[#888]">Opacità Riempimento:</span>
                        <span className="font-mono text-white">
                          {Math.round(((selectedMarkup as any).fillOpacity ?? 0.3) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        disabled={isLocked}
                        min="0"
                        max="1"
                        step="0.05"
                        value={(selectedMarkup as any).fillOpacity ?? 0.3}
                        onChange={(e) => updateMarkup(selectedMarkup.id, { fillOpacity: parseFloat(e.target.value) })}
                        className="w-full accent-[#0078d4]"
                      />

                      {/* Campitura / Retino Tecnico */}
                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#2a2a2c]">
                        <span className="text-[#888]">Campitura / Retino:</span>
                        <select
                          disabled={isLocked}
                          value={(selectedMarkup as any).hatchPattern || 'none'}
                          onChange={(e) => updateMarkup(selectedMarkup.id, { hatchPattern: e.target.value as any })}
                          className="bg-[#252526] border border-[#3e3e42] rounded px-2 py-0.5 text-white text-[11px] focus:outline-none"
                        >
                          <option value="none">Nessuna</option>
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
                    </div>
                  )}
                </div>

                {/* 2. SEZIONE TESTO & TIPOGRAFIA (Callout, Note, Testo, Cloud+) */}
                {('text' in selectedMarkup || (selectedMarkup.type as string) === 'callout' || (selectedMarkup.type as string) === 'textbox' || (selectedMarkup.type as string) === 'cloud_plus') && (
                  <div className="space-y-2.5 pt-3 border-t border-white/[0.08]">
                    <div className="flex items-center justify-between text-[#ededed] font-medium text-[12px]">
                      <div className="flex items-center gap-2">
                        <Type size={14} strokeWidth={1.5} className="text-[#85858b]" />
                        <span>Testo e tipografia</span>
                      </div>
                      <button
                        type="button"
                        onClick={autoSizeSelectedMarkups}
                        title="Adatta casella di testo (Alt+Z)"
                        className="flex items-center gap-1 px-1.5 py-0.5 bg-[#232325] hover:bg-[#2c2c30] text-[#a1a1a6] hover:text-[#ededed] rounded border border-white/[0.08] text-[10px] font-mono transition-colors cursor-pointer"
                      >
                        <Maximize2 size={9} />
                        <span>Alt+Z</span>
                      </button>
                    </div>

                    <div className="bg-[#1a1a1c] p-2.5 rounded border border-[#333333] space-y-2.5">
                      {/* Carattere (Font) */}
                      <div>
                        <span className="text-[#888] text-[10px] block mb-1">Carattere (Font)</span>
                        <select
                          disabled={isLocked}
                          value={(selectedMarkup as any).fontFamily || 'Segoe UI, sans-serif'}
                          onChange={(e) => updateMarkup(selectedMarkup.id, { fontFamily: e.target.value } as any)}
                          className="w-full bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 text-white text-[11px] focus:outline-none focus:border-[#0078d4]"
                        >
                          {AVAILABLE_FONTS.map((f: any) => (
                            <option key={f.id} value={f.family}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Dimensione & Colore Testo */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[#888] text-[10px] block mb-1">Dimensione Font</span>
                          <select
                            disabled={isLocked}
                            value={(selectedMarkup as any).fontSize || 11}
                            onChange={(e) => updateMarkup(selectedMarkup.id, { fontSize: parseInt(e.target.value, 10) } as any)}
                            className="w-full bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 text-white font-mono text-[11px]"
                          >
                            {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72].map((sz) => (
                              <option key={sz} value={sz}>
                                {sz} pt
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <span className="text-[#888] text-[10px] block mb-1">Colore Testo</span>
                          <div className="flex items-center space-x-1.5 pt-0.5">
                            <BluebeamColorPicker
                              color={(selectedMarkup as any).textColor || selectedMarkup.strokeColor || '#000000'}
                              onChange={(c) => updateMarkup(selectedMarkup.id, { textColor: c } as any)}
                              allowTransparent={false}
                              title="Colore testo"
                              size="sm"
                            />
                            <span className="text-[10px] text-[#aaa] font-mono truncate">
                              {(selectedMarkup as any).textColor || selectedMarkup.strokeColor || '#000000'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Stile Grassetto / Corsivo */}
                      <div className="flex items-center justify-between pt-1 border-t border-[#2a2a2c]">
                        <span className="text-[#888] text-[10px]">Stile:</span>
                        <div className="flex items-center space-x-1 bg-[#252526] border border-[#3e3e42] rounded p-0.5">
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => updateMarkup(selectedMarkup.id, {
                              fontWeight: (selectedMarkup as any).fontWeight === 'bold' ? 'normal' : 'bold'
                            } as any)}
                            className={`p-1 rounded text-xs ${(selectedMarkup as any).fontWeight === 'bold' ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
                            title="Grassetto"
                          >
                            <Bold size={11} />
                          </button>
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => updateMarkup(selectedMarkup.id, {
                              fontStyle: (selectedMarkup as any).fontStyle === 'italic' ? 'normal' : 'italic'
                            } as any)}
                            className={`p-1 rounded text-xs ${(selectedMarkup as any).fontStyle === 'italic' ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
                            title="Corsivo"
                          >
                            <Italic size={11} />
                          </button>
                        </div>
                      </div>

                      {/* Allineamento Orizzontale (Sinistra, Centro, Destra, Giustificato) */}
                      <div className="flex items-center justify-between pt-1 border-t border-[#2a2a2c]">
                        <span className="text-[#888] text-[10px]">Allineamento:</span>
                        <div className="flex items-center space-x-0.5 bg-[#252526] border border-[#3e3e42] rounded p-0.5">
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => updateMarkup(selectedMarkup.id, { textAlign: 'left' } as any)}
                            className={`p-1 rounded text-xs ${((selectedMarkup as any).textAlign || 'left') === 'left' ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
                            title="Allinea a Sinistra"
                          >
                            <AlignLeft size={11} />
                          </button>
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => updateMarkup(selectedMarkup.id, { textAlign: 'center' } as any)}
                            className={`p-1 rounded text-xs ${(selectedMarkup as any).textAlign === 'center' ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
                            title="Allinea al Centro"
                          >
                            <AlignCenter size={11} />
                          </button>
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => updateMarkup(selectedMarkup.id, { textAlign: 'right' } as any)}
                            className={`p-1 rounded text-xs ${(selectedMarkup as any).textAlign === 'right' ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
                            title="Allinea a Destra"
                          >
                            <AlignRight size={11} />
                          </button>
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => updateMarkup(selectedMarkup.id, { textAlign: 'justify' } as any)}
                            className={`p-1 rounded text-xs ${(selectedMarkup as any).textAlign === 'justify' ? 'bg-[#0078d4] text-white' : 'text-[#888] hover:text-white'}`}
                            title="Giustificato"
                          >
                            <AlignJustify size={11} />
                          </button>
                        </div>
                      </div>

                      {/* Allineamento Verticale (In alto, Al centro, In basso) */}
                      <div className="flex items-center justify-between pt-1 border-t border-[#2a2a2c]">
                        <span className="text-[#888] text-[10px]">Allineamento Vert.:</span>
                        <div className="flex items-center space-x-1 bg-[#252526] border border-[#3e3e42] rounded p-0.5 text-[10px]">
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => updateMarkup(selectedMarkup.id, { verticalAlign: 'top' } as any)}
                            className={`px-1.5 py-0.5 rounded ${((selectedMarkup as any).verticalAlign || 'top') === 'top' ? 'bg-[#0078d4] text-white font-semibold' : 'text-[#888] hover:text-white'}`}
                            title="Allinea in Alto"
                          >
                            Alto
                          </button>
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => updateMarkup(selectedMarkup.id, { verticalAlign: 'middle' } as any)}
                            className={`px-1.5 py-0.5 rounded ${(selectedMarkup as any).verticalAlign === 'middle' ? 'bg-[#0078d4] text-white font-semibold' : 'text-[#888] hover:text-white'}`}
                            title="Allinea al Centro Verticale"
                          >
                            Centro
                          </button>
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => updateMarkup(selectedMarkup.id, { verticalAlign: 'bottom' } as any)}
                            className={`px-1.5 py-0.5 rounded ${(selectedMarkup as any).verticalAlign === 'bottom' ? 'bg-[#0078d4] text-white font-semibold' : 'text-[#888] hover:text-white'}`}
                            title="Allinea in Basso"
                          >
                            Basso
                          </button>
                        </div>
                      </div>

                      {/* Adatta Automaticamente Casella di Testo (Auto Size - Alt+Z) */}
                      <div className="pt-2 border-t border-[#2a2a2c]">
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={autoSizeSelectedMarkups}
                          className="w-full flex items-center justify-center space-x-2 px-2 py-1.5 bg-[#0078d4]/20 hover:bg-[#0078d4]/35 text-[#00b7c3] hover:text-white border border-[#0078d4]/40 rounded text-[11px] font-medium transition cursor-pointer"
                          title="Ridimensiona la casella per adattarla perfettamente al testo (Scorciatoia: Alt+Z come Bluebeam)"
                        >
                          <Maximize2 size={12} />
                          <span>Adatta Casella a Testo (Alt+Z)</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2.5 SEZIONE QUOTA CAD & TESTO */}
                {['measure_length', 'measure_polyline', 'measure_area', 'measure_area_rect'].includes(selectedMarkup.type) && (
                  <div className="space-y-2.5 pt-3 border-t border-white/[0.08]">
                    <div className="flex items-center gap-2 text-[#ededed] font-medium text-[12px]">
                      <Type size={14} strokeWidth={1.5} className="text-[#85858b]" />
                      <span>Testo e stile quota CAD</span>
                    </div>

                    <div className="bg-[#1a1a1c] p-2.5 rounded border border-[#333333] space-y-2.5">
                      {/* Testo Quota Personalizzato / Sovrascrittura */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[#aaa] text-[10px] font-semibold">Testo Quota / Sovrascrittura:</span>
                          {(selectedMarkup as any).customText && (
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={() => updateMarkup(selectedMarkup.id, { customText: undefined } as any)}
                              className="text-[9px] text-[#0078d4] hover:underline cursor-pointer"
                            >
                              Ripristina Misura
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          disabled={isLocked}
                          placeholder="Es. 575 o testo personalizzato"
                          value={(selectedMarkup as any).customText || ''}
                          onChange={(e) => updateMarkup(selectedMarkup.id, { customText: e.target.value } as any)}
                          className="w-full bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 text-white text-[11px] font-mono focus:outline-none focus:border-[#0078d4]"
                        />
                      </div>

                      {/* Font e Dimensione */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[#888] text-[10px] block mb-1">Carattere (Font)</span>
                          <select
                            disabled={isLocked}
                            value={(selectedMarkup as any).fontFamily || 'Segoe UI, sans-serif'}
                            onChange={(e) => updateMarkup(selectedMarkup.id, { fontFamily: e.target.value } as any)}
                            className="w-full bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 text-white text-[11px] focus:outline-none focus:border-[#0078d4]"
                          >
                            {AVAILABLE_FONTS.map((f) => (
                              <option key={f.id} value={f.family}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <span className="text-[#888] text-[10px] block mb-1">Dimensione Font</span>
                          <select
                            disabled={isLocked}
                            value={(selectedMarkup as any).fontSize || 12}
                            onChange={(e) => updateMarkup(selectedMarkup.id, { fontSize: parseInt(e.target.value, 10) } as any)}
                            className="w-full bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 text-white font-mono text-[11px]"
                          >
                            {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].map((sz) => (
                              <option key={sz} value={sz}>
                                {sz} pt
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Colore Testo Quota */}
                      <div className="flex items-center justify-between pt-1 border-t border-[#2a2a2c]">
                        <span className="text-[#888] text-[10px]">Colore Testo Quota</span>
                        <div className="flex items-center space-x-1.5">
                          <BluebeamColorPicker
                            disabled={isLocked}
                            color={(selectedMarkup as any).textColor || '#ffff00'}
                            onChange={(c) => updateMarkup(selectedMarkup.id, { textColor: c } as any)}
                            allowTransparent={false}
                            title="Colore Testo Quota"
                            size="sm"
                          />
                          <span className="font-mono text-[9px] text-white">
                            {(selectedMarkup as any).textColor || '#ffff00'}
                          </span>
                        </div>
                      </div>

                      {/* Proprietà Specifiche Quota Lineare (measure_length) */}
                      {selectedMarkup.type === 'measure_length' && (
                        <div className="space-y-2 pt-1.5 border-t border-[#2a2a2c]">
                          {/* Terminazione Quota */}
                          <div className="flex items-center justify-between">
                            <span className="text-[#888] text-[10px]">Simbolo Terminale:</span>
                            <select
                              disabled={isLocked}
                              value={(selectedMarkup as any).dimensionEnding || 'tick'}
                              onChange={(e) => updateMarkup(selectedMarkup.id, { dimensionEnding: e.target.value } as any)}
                              className="bg-[#252526] border border-[#3e3e42] rounded px-2 py-0.5 text-white text-[11px]"
                            >
                              <option value="tick">Trattino 45° CAD (Tick)</option>
                              <option value="arrow">Freccia Chiusa</option>
                              <option value="open_arrow">Freccia Aperta</option>
                              <option value="circle">Cerchio / Punto</option>
                            </select>
                          </div>

                          {/* Offset Linee di Estensione (Testimoni) */}
                          <div>
                            <div className="flex items-center justify-between text-[10px] text-[#888] mb-0.5">
                              <span>Offset Linee Estensione:</span>
                              <span className="font-mono text-white">{(selectedMarkup as any).extensionOffset !== undefined ? (selectedMarkup as any).extensionOffset : 24} pt</span>
                            </div>
                            <input
                              type="range"
                              disabled={isLocked}
                              min="-80"
                              max="120"
                              step="2"
                              value={(selectedMarkup as any).extensionOffset !== undefined ? (selectedMarkup as any).extensionOffset : 24}
                              onChange={(e) => updateMarkup(selectedMarkup.id, { extensionOffset: parseInt(e.target.value, 10) } as any)}
                              className="w-full accent-[#0078d4]"
                            />
                          </div>

                          {/* Sconfinamento oltre quota */}
                          <div>
                            <div className="flex items-center justify-between text-[10px] text-[#888] mb-0.5">
                              <span>Sconfinamento Oltre Quota:</span>
                              <span className="font-mono text-white">{(selectedMarkup as any).extensionOvershoot !== undefined ? (selectedMarkup as any).extensionOvershoot : 5} pt</span>
                            </div>
                            <input
                              type="range"
                              disabled={isLocked}
                              min="0"
                              max="20"
                              step="1"
                              value={(selectedMarkup as any).extensionOvershoot !== undefined ? (selectedMarkup as any).extensionOvershoot : 5}
                              onChange={(e) => updateMarkup(selectedMarkup.id, { extensionOvershoot: parseInt(e.target.value, 10) } as any)}
                              className="w-full accent-[#0078d4]"
                            />
                          </div>

                          {/* Posizione Quota (Sopra / Centrata) */}
                          <div className="flex items-center justify-between">
                            <span className="text-[#888] text-[10px]">Posizione Quota:</span>
                            <select
                              disabled={isLocked}
                              value={(selectedMarkup as any).textPosition || 'above'}
                              onChange={(e) => updateMarkup(selectedMarkup.id, { textPosition: e.target.value } as any)}
                              className="bg-[#252526] border border-[#3e3e42] rounded px-2 py-0.5 text-white text-[11px]"
                            >
                              <option value="above">Sopra la linea (CAD)</option>
                              <option value="center">Centrata sulla linea</option>
                            </select>
                          </div>

                          {/* Sfondo Sotto Quota (Attiva / Disattiva) */}
                          <div className="flex items-center justify-between pt-1 border-t border-[#2a2a2c]">
                            <span className="text-[#888] text-[10px]">Sfondo Sotto Quota:</span>
                            <div className="flex items-center space-x-1.5">
                              <BluebeamColorPicker
                                disabled={isLocked}
                                color={(selectedMarkup as any).showTextBackground ? ((selectedMarkup as any).textFillColor || '#181818') : 'transparent'}
                                onChange={(c) => {
                                  if (c === 'transparent') {
                                    updateMarkup(selectedMarkup.id, { showTextBackground: false } as any);
                                  } else {
                                    updateMarkup(selectedMarkup.id, { showTextBackground: true, textFillColor: c } as any);
                                  }
                                }}
                                allowTransparent={true}
                                title="Sfondo Testo Quota (Trasparente per rimuovere sfondo)"
                                size="sm"
                              />
                              <span className="text-[10px] text-[#aaa]">
                                {(selectedMarkup as any).showTextBackground ? 'Attivo' : 'Trasparente'}
                              </span>
                            </div>
                          </div>

                          {/* Checkbox Mostra Unità */}
                          <label className="flex items-center space-x-2 text-[10px] text-[#aaa] cursor-pointer pt-1">
                            <input
                              type="checkbox"
                              disabled={isLocked}
                              checked={(selectedMarkup as any).showUnit !== false}
                              onChange={(e) => updateMarkup(selectedMarkup.id, { showUnit: e.target.checked } as any)}
                              className="rounded accent-[#0078d4]"
                            />
                            <span>Mostra Unità di Misura (mm, cm, m)</span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. SEZIONE METADATI & REVISIONE */}
                <div className="space-y-2.5 pt-3 border-t border-white/[0.08]">
                  <div className="flex items-center gap-2 text-[#ededed] font-medium text-[12px]">
                    <Info size={14} strokeWidth={1.5} className="text-[#85858b]" />
                    <span>Dati marcatura e revisione</span>
                  </div>

                  <div>
                    <span className="text-[#888] text-[10px] block mb-1 font-semibold">Soggetto / Oggetto (/Subj):</span>
                    <input
                      type="text"
                      disabled={isLocked}
                      value={selectedMarkup.subject || ''}
                      onChange={(e) => updateMarkup(selectedMarkup.id, { subject: e.target.value })}
                      className="w-full bg-[#1a1a1c] border border-[#3e3e42] rounded px-2 py-1 text-white text-[11px] focus:outline-none focus:border-[#0078d4]"
                    />
                  </div>

                  <div>
                    <span className="text-[#888] text-[10px] block mb-1 font-semibold">Commento Note (/Contents):</span>
                    <textarea
                      rows={3}
                      disabled={isLocked}
                      value={selectedMarkup.contents || ''}
                      onChange={(e) => updateMarkup(selectedMarkup.id, {
                        contents: e.target.value,
                        ...('text' in selectedMarkup ? { text: e.target.value } : {})
                      })}
                      className="w-full bg-[#1a1a1c] border border-[#3e3e42] rounded px-2 py-1 text-white text-[11px] focus:outline-none focus:border-[#0078d4] resize-none"
                    />
                  </div>

                  <div>
                    <span className="text-[#888] text-[10px] block mb-1 font-semibold">Livello / Layer:</span>
                    <select
                      disabled={isLocked}
                      value={selectedMarkup.layerId || 'default'}
                      onChange={(e) => {
                        useAppStore.getState().assignMarkupsToLayer([selectedMarkup.id], e.target.value);
                      }}
                      className="w-full bg-[#1a1a1c] border border-[#3e3e42] rounded px-2 py-1 text-white text-[11px] focus:outline-none focus:border-[#0078d4]"
                    >
                      {useAppStore.getState().layers.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <span className="text-[#888] text-[10px] block mb-1 font-semibold">Stato di Revisione:</span>
                    <select
                      disabled={isLocked}
                      value={selectedMarkup.status}
                      onChange={(e) => updateMarkup(selectedMarkup.id, { status: e.target.value as MarkupStatus })}
                      className="w-full bg-[#1a1a1c] border border-[#3e3e42] rounded px-2 py-1 text-white text-[11px] focus:outline-none focus:border-[#0078d4]"
                    >
                      <option value="None">Nessuno</option>
                      <option value="Accepted">Accettato</option>
                      <option value="Rejected">Rifiutato</option>
                      <option value="Completed">Completato</option>
                      <option value="Cancelled">Annullato</option>
                    </select>
                  </div>

                  <div className="text-[10px] text-[#777] space-y-0.5 pt-1">
                    <div>Autore: <span className="text-[#ccc]">{selectedMarkup.author}</span></div>
                    <div>Modificato: <span className="text-[#ccc]">{new Date(selectedMarkup.modificationDate).toLocaleTimeString('it-IT')}</span></div>
                  </div>
                </div>
              </>
            ) : (
              /* NESSUNA MARCATURA SELEZIONATA: PROPRIETÀ PREDEFINITE DELLO STRUMENTO ATTIVO */
              <div className="space-y-4">
                <div className="bg-[#19191b] border border-white/[0.08] rounded-lg p-3 space-y-1">
                  <div className="text-[12px] font-medium text-[#ededed] flex items-center gap-2">
                    <Sliders size={14} strokeWidth={1.5} className="text-[#85858b]" />
                    <span>Strumento attivo: {activeTool}</span>
                  </div>
                  <p className="text-[11px] text-[#85858b]">
                    Proprietà predefinite prima del disegno sul foglio
                  </p>
                </div>

                {/* Colore Predefinito */}
                <div className="space-y-1 bg-[#1a1a1c] p-2.5 rounded border border-[#333333]">
                  <span className="text-[#888] text-[10px] block">Colore Linea Predefinito</span>
                  <div className="flex items-center space-x-2">
                    <input
                      type="color"
                      value={activeColor}
                      onChange={(e) => setActiveColor(e.target.value)}
                      className="w-8 h-7 bg-transparent cursor-pointer rounded"
                    />
                    <span className="font-mono text-xs text-white">{activeColor}</span>
                  </div>
                </div>

                {/* Spessore Predefinito */}
                <div className="space-y-1 bg-[#1a1a1c] p-2.5 rounded border border-[#333333]">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#888]">Spessore Tratto:</span>
                    <span className="font-mono text-white">{activeStrokeWidth} pt</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={activeStrokeWidth}
                    onChange={(e) => setActiveStrokeWidth(parseFloat(e.target.value))}
                    className="w-full accent-[#0078d4]"
                  />
                </div>

                {/* Stile Linea Predefinito */}
                <div className="space-y-1 bg-[#1a1a1c] p-2.5 rounded border border-[#333333]">
                  <span className="text-[#888] text-[10px] block">Stile del Tratto</span>
                  <select
                    value={activeLineStyle}
                    onChange={(e) => setActiveLineStyle(e.target.value as any)}
                    className="w-full bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 text-white text-[11px]"
                  >
                    {LINE_STYLES.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Riempimento Predefinito */}
                <div className="space-y-1 bg-[#1a1a1c] p-2.5 rounded border border-[#333333]">
                  <div className="flex items-center justify-between">
                    <span className="text-[#888] text-[10px]">Riempimento Predefinito</span>
                    <span className="text-[9px] text-[#888]">
                      {activeFillColor === 'transparent' ? 'Nessun riempimento' : activeFillColor}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <BluebeamColorPicker
                      color={activeFillColor}
                      onChange={setActiveFillColor}
                      allowTransparent={true}
                      title="Riempimento Predefinito (Trasparente o Colore)"
                      size="sm"
                    />
                    <span className="font-mono text-xs text-white">
                      {activeFillColor === 'transparent' ? 'Trasparente' : activeFillColor}
                    </span>
                  </div>
                </div>

                {/* Font Predefinito */}
                <div className="space-y-1 bg-[#1a1a1c] p-2.5 rounded border border-[#333333]">
                  <span className="text-[#888] text-[10px] block">Font Predefinito</span>
                  <select
                    value={activeFontFamily}
                    onChange={(e) => setActiveFontFamily(e.target.value)}
                    className="w-full bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 text-white text-[11px]"
                  >
                    {AVAILABLE_FONTS.map((f) => (
                      <option key={f.id} value={f.family}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Striscia Verticale Destra a Icona (Width 36px) Stile Bluebeam Revu */}
      <div className="w-[36px] bg-[#1a1a1c] border-l border-[#303032] flex flex-col items-center py-2 space-y-2">
        <button
          onClick={() => setActiveRightPanel(isOpen ? 'none' : 'properties')}
          className={`w-7 h-7 rounded flex items-center justify-center transition ${
            isOpen
              ? 'bg-[#0078d4] text-white shadow ring-1 ring-white/30'
              : 'text-[#888888] hover:text-white hover:bg-[#2a2a2c]'
          }`}
          title="Mostra / Nascondi Proprietà (Alt+P)"
        >
          <Sliders size={15} />
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setActiveRightPanel(isOpen ? 'none' : 'properties')}
          className="w-7 h-7 rounded flex items-center justify-center text-[#777] hover:text-white hover:bg-[#2a2a2c] transition"
          title={isOpen ? 'Comprimi pannello proprietà' : 'Espandi pannello proprietà'}
        >
          {isOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </div>
  );
};
