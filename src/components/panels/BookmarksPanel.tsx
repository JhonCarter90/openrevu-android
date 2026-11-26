import React, { useState, useEffect } from 'react';
import { useAppStore, DocumentBookmark } from '@/store/useAppStore';
import { 
  Bookmark, 
  Plus, 
  Trash2, 
  Wand2, 
  Loader2, 
  X
} from 'lucide-react';
import { 
  AutoMarkService, 
  AutoMarkRegion 
} from '@/core/automark/automarkService';
import { PDFManager } from '@/core/pdf/pdfManager';

export const BookmarksPanel: React.FC = () => {
  const { 
    currentPage, 
    setCurrentPage, 
    numPages,
    isSelectingAutoMarkRegion,
    setIsSelectingAutoMarkRegion,
    autoMarkPendingRegion,
    setAutoMarkPendingRegion,
    activeDocumentId,
    openDocuments,
    setDocumentBookmarks,
  } = useAppStore();

  const activeDoc = openDocuments.find((d) => d.id === activeDocumentId);
  const bookmarks: DocumentBookmark[] = activeDoc?.bookmarks ?? [];
  const [newTitle, setNewTitle] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  // Reset selezione multipla al cambio documento
  useEffect(() => {
    setSelectedIds(new Set());
    setLastClickedIndex(null);
  }, [activeDocumentId]);

  // Carica i segnalibri nativi dal PDF solo la prima volta per il documento (non crea nulla in automatico se assenti)
  useEffect(() => {
    if (!activeDocumentId || activeDocumentId === 'home') return;
    if (activeDoc?.bookmarks !== undefined) return;

    let isMounted = true;
    (async () => {
      const outline = await PDFManager.getInstance().getDocumentOutline(activeDocumentId);
      if (!isMounted) return;
      setDocumentBookmarks(activeDocumentId, outline, false);
    })();
    return () => {
      isMounted = false;
    };
  }, [activeDocumentId, activeDoc?.bookmarks, setDocumentBookmarks]);

  // 1. Stato Dialog Principale: "Crea segnalibri"
  const [isMainDialogOpen, setIsMainDialogOpen] = useState(false);
  const [generationMode, setGenerationMode] = useState<'page_labels' | 'page_region'>('page_region');
  const [pageScaleMode, setPageScaleMode] = useState<'fit' | 'actual'>('fit');
  const [pageRangeMode, setPageRangeMode] = useState<'all' | 'current' | 'custom'>('all');
  const [customRangeText, setCustomRangeText] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, title: '' });

  // 2. Stato Sub-Dialog: "AutoMark" (Inizialmente vuoto, nessuna area finché l'utente non seleziona)
  const [isAutoMarkSubDialogOpen, setIsAutoMarkSubDialogOpen] = useState(false);
  const [selectionExpression, setSelectionExpression] = useState<string>('');
  const [areasMap, setAreasMap] = useState<Record<string, AutoMarkRegion>>({});
  const [livePreviewText, setLivePreviewText] = useState<string>('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Monitora il rilascio della selezione rettangolo sul canvas
  useEffect(() => {
    if (autoMarkPendingRegion) {
      // Determina il prossimo identificatore [AreaN]
      const existingAreaKeys = Object.keys(areasMap);
      const nextIndex = existingAreaKeys.length + 1;
      const nextKey = `Area${nextIndex}`;

      const updatedMap = {
        ...areasMap,
        [nextKey]: autoMarkPendingRegion,
      };
      setAreasMap(updatedMap);

      // Aggiorna l'espressione inserendo il token [AreaN]
      let newExpr = selectionExpression.trim();
      if (!newExpr) {
        newExpr = `[${nextKey}]`;
      } else if (!newExpr.includes(`[${nextKey}]`)) {
        newExpr = `${newExpr} - [${nextKey}]`;
      }
      setSelectionExpression(newExpr);

      // Reset stato selezione e riapri sub-dialog AutoMark
      setAutoMarkPendingRegion(null);
      setIsAutoMarkSubDialogOpen(true);

      // Ricalcola subito l'anteprima
      updateLivePreview(newExpr, updatedMap);
    }
  }, [autoMarkPendingRegion]);

  // Ricalcola anteprima stringa combinata
  const updateLivePreview = async (expr: string, areas: Record<string, AutoMarkRegion>) => {
    if (!expr) {
      setLivePreviewText('');
      return;
    }
    setIsLoadingPreview(true);
    try {
      const evaluated = await AutoMarkService.extractFromExpression(
        currentPage,
        expr,
        areas,
        true,
        activeDocumentId
      );
      setLivePreviewText(evaluated);
    } catch (err: any) {
      setLivePreviewText(`Errore anteprima: ${err.message}`);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Quando l'utente modifica l'espressione digitando nel campo "Selezione:"
  const handleExpressionChange = (newExpr: string) => {
    setSelectionExpression(newExpr);
    updateLivePreview(newExpr, areasMap);
  };

  // Pulsante "Aggiungi" nella finestra AutoMark: minimizza e attiva selezione canvas
  const handleStartAddArea = () => {
    setIsAutoMarkSubDialogOpen(false);
    setIsSelectingAutoMarkRegion(true);
  };

  const parsePageRange = (input: string, total: number): number[] => {
    const pages = new Set<number>();
    const parts = input.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const dashMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (dashMatch) {
        const a = Math.max(1, Math.min(total, parseInt(dashMatch[1], 10)));
        const b = Math.max(1, Math.min(total, parseInt(dashMatch[2], 10)));
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        for (let p = lo; p <= hi; p++) pages.add(p);
      } else if (/^\d+$/.test(part)) {
        const p = parseInt(part, 10);
        if (p >= 1 && p <= total) pages.add(p);
      }
    }
    return Array.from(pages).sort((a, b) => a - b);
  };

  // Esecuzione finale generazione segnalibri da "Crea segnalibri"
  const handleExecuteGenerate = async () => {
    const totalDocsPages = Math.max(1, numPages);
    let targetPages: number[] = [];

    if (pageRangeMode === 'all') {
      targetPages = Array.from({ length: totalDocsPages }, (_, i) => i + 1);
    } else if (pageRangeMode === 'current') {
      targetPages = [Math.max(1, Math.min(totalDocsPages, currentPage))];
    } else {
      targetPages = parsePageRange(customRangeText, totalDocsPages);
      if (targetPages.length === 0) {
        alert(`Inserisci un intervallo pagine valido tra 1 e ${totalDocsPages} (es. 6-${totalDocsPages} oppure 1, 3, 5-10).`);
        return;
      }
    }

    setIsRunning(true);
    try {
      let generated: DocumentBookmark[] = [];
      const isContiguous =
        targetPages.length > 0 &&
        targetPages[targetPages.length - 1] - targetPages[0] + 1 === targetPages.length;

      if (isContiguous) {
        generated = await AutoMarkService.generateBookmarksFromExpression(
          targetPages[0],
          targetPages[targetPages.length - 1],
          selectionExpression,
          areasMap,
          (current, total, title) => {
            setProgress({ current, total, title });
          },
          activeDocumentId
        );
      } else {
        for (let i = 0; i < targetPages.length; i++) {
          const p = targetPages[i];
          const single = await AutoMarkService.generateBookmarksFromExpression(
            p,
            p,
            selectionExpression,
            areasMap,
            undefined,
            activeDocumentId
          );
          generated.push(...single);
          setProgress({
            current: i + 1,
            total: targetPages.length,
            title: single[0]?.title || `Pagina ${p}`,
          });
        }
      }

      if (pageRangeMode === 'custom' && bookmarks.length > 0) {
        const targetSet = new Set(targetPages);
        const kept = bookmarks.filter((b) => !targetSet.has(b.pageNumber));
        const merged = [...kept, ...generated].sort((a, b) => a.pageNumber - b.pageNumber);
        setDocumentBookmarks(activeDocumentId, merged, true);
      } else {
        setDocumentBookmarks(activeDocumentId, generated, true);
      }
      setIsMainDialogOpen(false);
    } catch (err: any) {
      alert(`Errore creazione segnalibri: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleAddBookmark = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDocumentId || activeDocumentId === 'home') return;
    const title = newTitle.trim() || `Segnalibro Pagina ${currentPage}`;
    setDocumentBookmarks(
      activeDocumentId,
      [...bookmarks, { id: crypto.randomUUID(), title, pageNumber: currentPage }],
      true
    );
    setNewTitle('');
  };

  const handleDeleteBookmark = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeDocumentId || activeDocumentId === 'home') return;
    setDocumentBookmarks(
      activeDocumentId,
      bookmarks.filter((b) => b.id !== id),
      true
    );
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleSelectBookmark = (id: string, index: number, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedIndex !== null && lastClickedIndex < bookmarks.length) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        for (let i = start; i <= end; i++) {
          next.add(bookmarks[i].id);
        }
      } else {
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
    setLastClickedIndex(index);
  };

  const handleRowClick = (b: DocumentBookmark, index: number, e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleSelectBookmark(b.id, index, e.shiftKey);
      return;
    }
    setLastClickedIndex(index);
    setCurrentPage(b.pageNumber);
  };

  const allSelected = bookmarks.length > 0 && selectedIds.size === bookmarks.length;

  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(bookmarks.map((b) => b.id)));
    }
  };

  const handleDeleteSelected = () => {
    if (!activeDocumentId || activeDocumentId === 'home' || selectedIds.size === 0) return;
    setDocumentBookmarks(
      activeDocumentId,
      bookmarks.filter((b) => !selectedIds.has(b.id)),
      true
    );
    setSelectedIds(new Set());
    setLastClickedIndex(null);
  };

  return (
    <div
      className="flex flex-col h-full min-h-0 bg-[#202022] text-xs select-none"
      onKeyDown={(e) => {
        if (e.key === 'Delete' && selectedIds.size > 0) {
          const tag = (e.target as HTMLElement)?.tagName;
          if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
            e.preventDefault();
            handleDeleteSelected();
          }
        }
      }}
      tabIndex={-1}
    >
      {/* Header pannello */}
      <div className="h-9 px-3 bg-[#1e1e1e] border-b border-[#333333] flex items-center justify-between font-bold text-white shrink-0">
        <div className="flex items-center space-x-1.5">
          <Bookmark size={13} className="text-[#0078d4]" />
          <span className="text-[12px]">Segnalibri</span>
          <span className="text-[10px] text-[#888] font-mono">({bookmarks.length})</span>
        </div>

        {/* Pulsante Crea Segnalibri / AutoMark */}
        <button
          onClick={() => {
            setIsMainDialogOpen(true);
            updateLivePreview(selectionExpression, areasMap);
          }}
          className="flex items-center space-x-1 px-2 py-0.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded transition text-[11px]"
          title="Crea segnalibri da cartiglio con OCR"
        >
          <Wand2 size={11} />
          <span>Crea segnalibri</span>
        </button>
      </div>

      {/* Input manuale nuovo segnalibro */}
      <div className="p-2 border-b border-[#333333] bg-[#1a1a1c]">
        <form onSubmit={handleAddBookmark} className="flex items-center space-x-1">
          <input
            type="text"
            placeholder={`Aggiungi per Pag. ${currentPage}...`}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="flex-1 bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 text-white text-[11px] focus:outline-none focus:border-[#0078d4]"
          />
          <button
            type="submit"
            className="p-1.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded transition"
            title="Aggiungi Segnalibro alla pagina corrente"
          >
            <Plus size={13} />
          </button>
        </form>
      </div>

      {/* Barra selezione multipla */}
      {bookmarks.length > 0 && (
        <div className="px-2.5 py-1.5 border-b border-[#333333] bg-[#1c1c1e] flex items-center justify-between shrink-0">
          <label className="flex items-center space-x-1.5 cursor-pointer text-[11px] text-[#bbb] hover:text-white">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={handleToggleSelectAll}
              className="accent-[#0078d4] cursor-pointer"
            />
            <span>
              {selectedIds.size > 0
                ? `${selectedIds.size} selezionat${selectedIds.size === 1 ? 'o' : 'i'}`
                : 'Seleziona tutti'}
            </span>
          </label>

          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-700/80 hover:bg-red-600 text-white text-[10.5px] font-medium transition cursor-pointer"
              title="Elimina tutti i segnalibri selezionati (Canc)"
            >
              <Trash2 size={11} />
              <span>Elimina ({selectedIds.size})</span>
            </button>
          )}
        </div>
      )}

      {/* Elenco Segnalibri con barra di scorrimento visibile a destra */}
      <div className="flex-1 min-h-0 overflow-y-scroll bookmarks-scrollbar p-2 space-y-1">
        {bookmarks.length === 0 ? (
          <div className="text-center py-8 text-[#777]">
            <p className="mb-2">Nessun segnalibro presente.</p>
            <p className="text-[10px] text-[#555]">
              Usa <strong>Crea segnalibri</strong> per estrarre automaticamente i codici e titoli dai cartigli.
            </p>
          </div>
        ) : (
          bookmarks.map((b, idx) => {
            const isCurrent = b.pageNumber === currentPage;
            const isSelected = selectedIds.has(b.id);
            return (
              <div
                key={b.id}
                onClick={(e) => handleRowClick(b, idx, e)}
                className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition ${
                  isSelected
                    ? 'bg-[#0078d4]/30 border border-[#0078d4] text-white'
                    : isCurrent
                    ? 'bg-[#0078d4]/15 border border-[#0078d4]/50 text-white font-medium'
                    : 'text-[#cccccc] hover:bg-[#2a2a2c] hover:text-white border border-transparent'
                }`}
              >
                <div className="flex items-center space-x-2 truncate min-w-0">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectBookmark(b.id, idx, e.shiftKey);
                    }}
                    onChange={() => {}}
                    className="accent-[#0078d4] shrink-0 cursor-pointer"
                    title="Seleziona segnalibro (Shift+Click per intervallo)"
                  />
                  <Bookmark
                    size={12}
                    className={`shrink-0 ${isCurrent ? 'text-[#0078d4] fill-[#0078d4]' : 'text-[#888888]'}`}
                  />
                  <span className="truncate">{b.title}</span>
                </div>

                <div className="flex items-center space-x-1 shrink-0 ml-1">
                  <span className="text-[10px] text-[#777] font-mono px-1 rounded bg-[#1a1a1c]">
                    P.{b.pageNumber}
                  </span>
                  <button
                    onClick={(e) => handleDeleteBookmark(b.id, e)}
                    className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 rounded transition"
                    title="Elimina segnalibro"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ========================================================================= */}
      {/* DIALOG 1: "Crea segnalibri" (Stile identico allo Screenshot 1)           */}
      {/* ========================================================================= */}
      {!isSelectingAutoMarkRegion && isMainDialogOpen && !isAutoMarkSubDialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[#262628] border border-[#3e3e42] rounded shadow-2xl w-[360px] overflow-hidden flex flex-col text-xs text-[#cccccc]">
            {/* Header Finestra */}
            <div className="h-8 px-3 bg-[#1f1f20] border-b border-[#333333] flex items-center justify-between text-white font-medium">
              <span>Crea segnalibri</span>
              <button
                onClick={() => !isRunning && setIsMainDialogOpen(false)}
                disabled={isRunning}
                className="hover:text-white text-[#888]"
              >
                <X size={14} />
              </button>
            </div>

            {/* Contenuto Finestra */}
            <div className="p-3.5 space-y-3">
              {/* Fieldset 1: Opzioni */}
              <fieldset className="border border-[#444446] rounded p-3 relative">
                <legend className="text-white text-[11px] font-medium px-1.5 ml-1">
                  Opzioni
                </legend>

                <div className="space-y-2.5 pt-0.5">
                  <label className="flex items-center space-x-2 cursor-pointer text-[#ccc] hover:text-white">
                    <input
                      type="radio"
                      name="gen_opt"
                      checked={generationMode === 'page_labels'}
                      onChange={() => setGenerationMode('page_labels')}
                      className="accent-[#0078d4]"
                    />
                    <span>Etichette pagina</span>
                  </label>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center space-x-2 cursor-pointer text-white font-medium">
                        <input
                          type="radio"
                          name="gen_opt"
                          checked={generationMode === 'page_region'}
                          onChange={() => setGenerationMode('page_region')}
                          className="accent-[#0078d4]"
                        />
                        <span>Regione pagina</span>
                      </label>

                      {/* Pulsante Seleziona -> Apre finestra AutoMark o avvia selezione se vuoto */}
                      <button
                        type="button"
                        onClick={() => {
                          setIsAutoMarkSubDialogOpen(true);
                          if (Object.keys(areasMap).length === 0) {
                            setIsSelectingAutoMarkRegion(true);
                          } else {
                            updateLivePreview(selectionExpression, areasMap);
                          }
                        }}
                        className="px-5 py-1 bg-[#38383a] hover:bg-[#444448] text-white border border-[#555] rounded text-[11px] transition shadow-xs"
                      >
                        Seleziona
                      </button>
                    </div>

                    <div className="flex items-center justify-between pl-6 text-[11px]">
                      <span className="text-[#aaa]">Scala pagina:</span>
                      <select
                        value={pageScaleMode}
                        onChange={(e) => setPageScaleMode(e.target.value as any)}
                        className="bg-[#1e1e1e] border border-[#444] rounded px-2 py-0.5 text-white text-[11px] w-36"
                      >
                        <option value="fit">Adatta a pagina</option>
                        <option value="actual">Dimensioni effettive</option>
                      </select>
                    </div>
                  </div>
                </div>
              </fieldset>

              {/* Fieldset 2: Intervallo pagine */}
              <fieldset className="border border-[#444446] rounded p-3 relative">
                <legend className="text-white text-[11px] font-medium px-1.5 ml-1">
                  Intervallo pagine
                </legend>

                <div className="space-y-2 pt-0.5 text-[11px]">
                  <div className="flex items-center space-x-2">
                    <span className="text-[#ccc]">Pagine:</span>
                    <select
                      value={pageRangeMode}
                      onChange={(e) => {
                        const mode = e.target.value as 'all' | 'current' | 'custom';
                        setPageRangeMode(mode);
                        if (mode === 'custom' && !customRangeText.trim()) {
                          setCustomRangeText(`1-${Math.max(1, numPages)}`);
                        }
                      }}
                      className="flex-1 bg-[#1e1e1e] border border-[#444] rounded px-2 py-0.5 text-white text-[11px]"
                    >
                      <option value="all">Tutte le pagine (1 - {Math.max(1, numPages)})</option>
                      <option value="current">Pagina corrente ({currentPage})</option>
                      <option value="custom">Intervallo personalizzato...</option>
                    </select>
                    <span className="text-[#888] font-mono whitespace-nowrap">di {Math.max(1, numPages)}</span>
                  </div>

                  {pageRangeMode === 'custom' && (
                    <div className="flex items-center space-x-2 pl-12">
                      <input
                        type="text"
                        value={customRangeText}
                        onChange={(e) => setCustomRangeText(e.target.value)}
                        placeholder={`es. 6-${Math.max(1, numPages)} oppure 1, 3, 5-10`}
                        className="flex-1 bg-[#1e1e1e] border border-[#0078d4] rounded px-2 py-1 text-white text-[11px] font-mono focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              </fieldset>

              {/* Barra di avanzamento batch */}
              {isRunning && (
                <div className="space-y-1 bg-[#1e1e1e] p-2 rounded border border-[#0078d4]">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white font-medium flex items-center space-x-1">
                      <Loader2 size={11} className="animate-spin text-[#0078d4]" />
                      <span>Elaborazione OCR...</span>
                    </span>
                    <span className="font-mono text-[#00b7c3]">
                      {progress.current} / {progress.total}
                    </span>
                  </div>
                  <div className="w-full bg-[#333] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[#0078d4] h-full transition-all duration-150"
                      style={{
                        width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer con pulsanti OK / Annulla */}
            <div className="p-3 bg-[#1f1f20] border-t border-[#333333] flex justify-end space-x-2">
              <button
                onClick={handleExecuteGenerate}
                disabled={isRunning}
                className="px-5 py-1 bg-[#3a3a3c] hover:bg-[#48484c] text-white border border-[#555] rounded text-[11px] font-medium transition"
              >
                {isRunning ? 'Generazione...' : 'OK'}
              </button>
              <button
                onClick={() => setIsMainDialogOpen(false)}
                disabled={isRunning}
                className="px-4 py-1 bg-[#3a3a3c] hover:bg-[#48484c] text-white border border-[#555] rounded text-[11px] transition"
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DIALOG 2: Sub-Dialog "AutoMark" (Stile identico allo Screenshot 2)        */}
      {/* ========================================================================= */}
      {!isSelectingAutoMarkRegion && isAutoMarkSubDialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[#ffffff] text-[#1e1e1e] border border-[#999999] rounded-md shadow-2xl w-[420px] overflow-hidden flex flex-col text-xs font-sans">
            {/* Header Finestra */}
            <div className="h-7 px-3 bg-[#f0f0f0] border-b border-[#cccccc] flex items-center justify-between font-normal text-[#333]">
              <span className="text-[12px]">AutoMark</span>
              <button
                onClick={() => setIsAutoMarkSubDialogOpen(false)}
                className="hover:text-black text-[#666]"
              >
                <X size={14} />
              </button>
            </div>

            {/* Contenuto Finestra AutoMark */}
            <div className="p-4 space-y-3">
              {/* 1. Selezione: Input libero con token [Area1], [Area2] ecc. */}
              <div>
                <label className="block text-[11px] text-[#333333] mb-1 font-normal">
                  Selezione:
                </label>
                <input
                  type="text"
                  value={selectionExpression}
                  onChange={(e) => handleExpressionChange(e.target.value)}
                  placeholder="[Area1] testo aggiunto - [Area2]"
                  className="w-full bg-white border border-[#7a7a7a] rounded-xs px-2 py-1 text-black text-[12px] font-mono focus:outline-none focus:border-[#0078d4]"
                />
              </div>

              {/* 2. Anteprima: Risultato valutato in tempo reale */}
              <div>
                <label className="block text-[11px] text-[#333333] mb-1 font-normal">
                  Anteprima:
                </label>
                <div className="min-h-[44px] bg-white border border-[#d9d9d9] rounded-xs p-1.5 text-[11px] font-sans text-black leading-snug break-words">
                  {isLoadingPreview ? (
                    <span className="text-[#888] italic">Caricamento ed estrazione OCR...</span>
                  ) : livePreviewText ? (
                    <span>{livePreviewText}</span>
                  ) : (
                    <span className="text-[#888] italic">Nessun testo estratto. Clicca su Aggiungi per selezionare un'area.</span>
                  )}
                </div>
              </div>

              {/* Informazioni aree attive */}
              <div className="text-[10px] text-[#666] pt-1 flex flex-wrap gap-2 border-t border-gray-200">
                {Object.keys(areasMap).map((k) => (
                  <span key={k} className="px-1.5 py-0.5 bg-gray-100 rounded border border-gray-300 font-mono">
                    [{k}] {(areasMap[k].widthPct * 100).toFixed(0)}% × {(areasMap[k].heightPct * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
            </div>

            {/* Footer con pulsanti Aggiungi a sinistra, OK e Annulla a destra */}
            <div className="px-4 py-2.5 bg-[#f6f6f6] border-t border-[#e5e5e5] flex items-center justify-between">
              <button
                type="button"
                onClick={handleStartAddArea}
                className="px-3.5 py-1 bg-white hover:bg-gray-100 text-black border border-[#adadad] rounded-xs text-[11px] shadow-2xs transition"
                title="Minimizza la finestra per tracciare un rettangolo sul cartiglio"
              >
                Aggiungi
              </button>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setIsAutoMarkSubDialogOpen(false)}
                  className="px-4 py-1 bg-[#0078d4] hover:bg-[#106ebe] text-white border border-[#0078d4] rounded-xs text-[11px] transition shadow-2xs"
                >
                  OK
                </button>
                <button
                  type="button"
                  onClick={() => setIsAutoMarkSubDialogOpen(false)}
                  className="px-3 py-1 bg-white hover:bg-gray-100 text-black border border-[#adadad] rounded-xs text-[11px] shadow-2xs transition"
                >
                  Annulla
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
