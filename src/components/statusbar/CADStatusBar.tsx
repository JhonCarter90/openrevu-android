import React, { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { BluebeamIcon } from '@/components/icons/BluebeamIcon';
import { 
  Magnet, 
  Ruler, 
  FileText,
  MousePointer,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns,
  Rows,
  Link2,
  X,
  Hand,
  Type
} from 'lucide-react';

export const CADStatusBar: React.FC = () => {
  const {
    pagesInfo,
    currentPage,
    numPages,
    setCurrentPage,
    pageViewMode,
    setPageViewMode,
    scaleCalibration,
    snapEnabled,
    setSnapEnabled,
    orthoEnabled,
    setOrthoEnabled,
    viewport,
    setViewport,
    resetViewport,
    splitMode,
    splitTree,
    splitActivePane,
    resetSplitPanes,
    syncSplitViews,
    setSyncSplitViews,
    activeTool,
    setActiveTool,
  } = useAppStore();

  const isSplitActive = splitTree.type === 'split';

  const [pageInputVal, setPageInputVal] = useState<string>('');
  const [isEditingPageInput, setIsEditingPageInput] = useState<boolean>(false);

  const currentPageInfo = pagesInfo[currentPage - 1];

  // Calcola formato foglio stimato (es. 84,10 × 59,40 cm come in Bluebeam)
  const getPageFormatString = () => {
    if (!currentPageInfo) return '-';
    // Conversione pt PDF in cm (1 pt = 2.54 / 72 cm)
    const cmW = ((currentPageInfo.width * 2.54) / 72).toFixed(2).replace('.', ',');
    const cmH = ((currentPageInfo.height * 2.54) / 72).toFixed(2).replace('.', ',');
    return `${cmW} × ${cmH} cm`;
  };

  const handlePageInputSubmit = (rawVal?: string) => {
    const val = parseInt(rawVal ?? pageInputVal, 10);
    if (!isNaN(val) && val >= 1 && val <= numPages) {
      setCurrentPage(val);
    }
    setIsEditingPageInput(false);
  };

  return (
    <footer className="h-9 bg-[#0f0f10] border-t border-white/[0.08] flex items-center justify-between gap-3 px-3 text-[11px] text-[#85858b] select-none z-40 shrink-0 font-sans overflow-x-auto whitespace-nowrap">
      {/* 1. SINISTRA: Modalità Pagina + Divisione Schermo */}
      <div className="flex items-center justify-start gap-2 shrink-0">
        {/* Pagina Singola / Continue */}
        <div className="flex items-center bg-[#19191b] rounded-md border border-white/[0.08] p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => setPageViewMode('single')}
            className={`flex items-center px-1.5 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
              pageViewMode === 'single'
                ? 'bg-[#2563eb] text-white font-medium'
                : 'text-[#a1a1a6] hover:text-[#ededed] hover:bg-[#232325]'
            }`}
            title="Pagina intera singola"
          >
            <BluebeamIcon name="single_page" size={13} />
          </button>
          <button
            type="button"
            onClick={() => setPageViewMode('continuous')}
            className={`flex items-center px-1.5 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
              pageViewMode === 'continuous'
                ? 'bg-[#2563eb] text-white font-medium'
                : 'text-[#a1a1a6] hover:text-[#ededed] hover:bg-[#232325]'
            }`}
            title="Scorrimento pagine continue"
          >
            <BluebeamIcon name="continuous_page" size={13} />
          </button>
        </div>

        <div className="h-4 w-px bg-white/[0.08]" />

        {/* Controlli Divisione Schermo */}
        <div className="flex items-center bg-[#19191b] rounded-md border border-white/[0.08] p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => splitActivePane('vertical')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
              isSplitActive && splitMode === 'vertical'
                ? 'bg-[#2563eb] text-white font-medium'
                : 'text-[#a1a1a6] hover:text-[#ededed] hover:bg-[#232325]'
            }`}
            title="Dividi riquadro attivo verticalmente (Ctrl+2)"
          >
            <Columns size={13} strokeWidth={1.5} />
            <span className="hidden xl:inline">Dividi vert.</span>
          </button>
          <button
            type="button"
            onClick={() => splitActivePane('horizontal')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
              isSplitActive && splitMode === 'horizontal'
                ? 'bg-[#2563eb] text-white font-medium'
                : 'text-[#a1a1a6] hover:text-[#ededed] hover:bg-[#232325]'
            }`}
            title="Dividi riquadro attivo orizzontalmente (Ctrl+H)"
          >
            <Rows size={13} strokeWidth={1.5} />
            <span className="hidden xl:inline">Dividi orizz.</span>
          </button>
          {isSplitActive && (
            <>
              <button
                type="button"
                onClick={() => setSyncSplitViews(!syncSplitViews)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                  syncSplitViews
                    ? 'bg-[#4cc38a]/15 text-[#4cc38a] border border-[#4cc38a]/35 font-medium'
                    : 'text-[#a1a1a6] hover:text-[#ededed] hover:bg-[#232325]'
                }`}
                title="Sincronizza zoom e pan tra le viste divise"
              >
                <Link2 size={12} strokeWidth={1.5} />
                <span className="hidden lg:inline">Sync</span>
              </button>
              <button
                type="button"
                onClick={() => resetSplitPanes()}
                className="p-0.5 text-[#85858b] hover:text-[#e5484d] hover:bg-[#232325] rounded transition-colors cursor-pointer"
                title="Chiudi tutte le divisioni"
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 2. CENTRO: Strumenti Rapidi + Navigazione Pagine */}
      <div className="flex items-center justify-center gap-2 shrink-0">
        <div className="flex items-center bg-[#19191b] rounded-md border border-white/[0.08] p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => setActiveTool('pan')}
            className={`p-1 rounded transition-colors cursor-pointer ${
              activeTool === 'pan' ? 'bg-[#2563eb] text-white' : 'text-[#a1a1a6] hover:text-[#ededed] hover:bg-[#232325]'
            }`}
            title="Panoramica (H)"
          >
            <Hand size={13} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool('select')}
            className={`p-1 rounded transition-colors cursor-pointer ${
              activeTool === 'select' ? 'bg-[#2563eb] text-white' : 'text-[#a1a1a6] hover:text-[#ededed] hover:bg-[#232325]'
            }`}
            title="Seleziona annotazioni (V)"
          >
            <MousePointer size={13} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool('select_text')}
            className={`p-1 rounded transition-colors cursor-pointer ${
              activeTool === 'select_text' ? 'bg-[#2563eb] text-white' : 'text-[#a1a1a6] hover:text-[#ededed] hover:bg-[#232325]'
            }`}
            title="Seleziona testo PDF"
          >
            <Type size={13} strokeWidth={1.5} />
          </button>
        </div>

        {numPages > 0 && (
          <div className="flex items-center bg-[#19191b] rounded-md border border-white/[0.08] px-1 py-0.5 gap-0.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(1)}
              className="p-0.5 hover:bg-[#232325] hover:text-[#ededed] disabled:opacity-30 disabled:hover:bg-transparent rounded text-[#a1a1a6] transition-colors cursor-pointer"
              title="Prima pagina (Home)"
            >
              <ChevronsLeft size={13} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(currentPage - 1)}
              className="p-0.5 hover:bg-[#232325] hover:text-[#ededed] disabled:opacity-30 disabled:hover:bg-transparent rounded text-[#a1a1a6] transition-colors cursor-pointer"
              title="Pagina precedente"
            >
              <ChevronLeft size={13} strokeWidth={1.5} />
            </button>

            <div className="flex items-center justify-center min-w-[96px] px-2 bg-[#141415] border border-white/[0.08] rounded text-[#ededed] font-mono tabular-nums text-[11px]">
              {isEditingPageInput ? (
                <input
                  type="text"
                  autoFocus
                  defaultValue={currentPage}
                  onBlur={(e) => handlePageInputSubmit(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handlePageInputSubmit((e.target as HTMLInputElement).value);
                    } else if (e.key === 'Escape') {
                      setIsEditingPageInput(false);
                    }
                  }}
                  className="w-8 bg-[#19191b] border border-[#2563eb] text-center text-[#ededed] rounded px-0.5 outline-none"
                />
              ) : (
                <span
                  onClick={() => setIsEditingPageInput(true)}
                  className="cursor-pointer hover:text-[#3b82f6] px-1 rounded transition-colors font-medium"
                  title="Clicca per andare a una pagina specifica"
                >
                  {currentPage} di {numPages}
                </span>
              )}
            </div>

            <button
              type="button"
              disabled={currentPage >= numPages}
              onClick={() => setCurrentPage(currentPage + 1)}
              className="p-0.5 hover:bg-[#232325] hover:text-[#ededed] disabled:opacity-30 disabled:hover:bg-transparent rounded text-[#a1a1a6] transition-colors cursor-pointer"
              title="Pagina successiva"
            >
              <ChevronRight size={13} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              disabled={currentPage >= numPages}
              onClick={() => setCurrentPage(numPages)}
              className="p-0.5 hover:bg-[#232325] hover:text-[#ededed] disabled:opacity-30 disabled:hover:bg-transparent rounded text-[#a1a1a6] transition-colors cursor-pointer"
              title="Ultima pagina (Fine)"
            >
              <ChevronsRight size={13} strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>

      {/* 3. DESTRA: Formato Pagina, Scala, Snap e Zoom */}
      <div className="flex items-center justify-end gap-2 shrink-0">
        <div className="hidden md:flex items-center gap-1.5 text-[#a1a1a6] shrink-0" title="Dimensioni foglio della pagina corrente">
          <FileText size={13} strokeWidth={1.5} className="text-[#85858b]" />
          <span className="font-mono tabular-nums text-[#ededed]">{getPageFormatString()}</span>
        </div>

        <div className="hidden md:block h-4 w-px bg-white/[0.08]" />

        <div className="hidden lg:flex items-center gap-1.5 shrink-0">
          <Ruler size={13} strokeWidth={1.5} className="text-[#85858b]" />
          <span className={scaleCalibration ? 'text-[#4cc38a] font-mono tabular-nums font-medium' : 'text-[#85858b] font-mono'}>
            {scaleCalibration ? `1 : ${scaleCalibration.scaleRatio.toFixed(0)} (${scaleCalibration.unit})` : 'Scala non impostata'}
          </span>
        </div>

        <div className="hidden lg:block h-4 w-px bg-white/[0.08]" />

        <button
          type="button"
          onClick={() => setSnapEnabled(!snapEnabled)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
            snapEnabled
              ? 'bg-[#4cc38a]/15 text-[#4cc38a] border-[#4cc38a]/35 font-medium'
              : 'bg-[#19191b] border-white/[0.08] text-[#85858b] hover:text-[#ededed]'
          }`}
          title="Attiva o disattiva Snap magnetico CAD (F8)"
        >
          <Magnet size={12} strokeWidth={1.5} />
          <span>Snap {snapEnabled ? 'On' : 'Off'}</span>
        </button>

        <button
          type="button"
          onClick={() => setOrthoEnabled(!orthoEnabled)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
            orthoEnabled
              ? 'bg-[#2563eb]/20 text-[#4cc2ff] border-[#2563eb]/50 font-medium'
              : 'bg-[#19191b] border-white/[0.08] text-[#85858b] hover:text-[#ededed]'
          }`}
          title="Attiva o disattiva modalità Orto per linee dritte 0°/90°"
        >
          <span>⊥ Orto {orthoEnabled ? 'On' : 'Off'}</span>
        </button>

        <div className="h-4 w-px bg-white/[0.08]" />

        <div className="flex items-center gap-1 font-mono tabular-nums">
          <button
            type="button"
            onClick={() => setViewport({ zoom: Math.max(0.15, viewport.zoom * 0.85) })}
            className="hover:text-[#ededed] px-1.5 py-0.5 hover:bg-[#232325] rounded cursor-pointer transition-colors"
            title="Riduci zoom (Ctrl+-)"
          >
            -
          </button>
          <span className="text-[#ededed] w-11 text-center font-medium">{Math.round(viewport.zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setViewport({ zoom: Math.min(24.0, viewport.zoom * 1.15) })}
            className="hover:text-[#ededed] px-1.5 py-0.5 hover:bg-[#232325] rounded cursor-pointer transition-colors"
            title="Aumenta zoom (Ctrl++)"
          >
            +
          </button>

          <button
            type="button"
            onClick={resetViewport}
            className="ml-0.5 px-2 py-0.5 bg-[#19191b] hover:bg-[#232325] text-[#a1a1a6] hover:text-[#ededed] rounded-md border border-white/[0.08] text-[11px] font-sans transition-colors cursor-pointer"
            title="Adatta pagina a schermo (Ctrl+0)"
          >
            Adatta
          </button>
        </div>
      </div>
    </footer>
  );
};

