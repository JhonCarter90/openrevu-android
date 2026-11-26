import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { PDFManager } from '@/core/pdf/pdfManager';
import {
  deletePagesFromActiveDocument,
  insertBlankPageInActiveDocument,
  renamePageLabelInActiveDocument,
  resetAllPageLabelsInActiveDocument,
  rotatePagesInActiveDocument,
} from '@/core/pdf/pdfPageOperationsService';
import {
  RotateCw,
  RotateCcw,
  CheckCircle2,
  FilePlus2,
  FilePlus,
  Trash2,
  Tag,
} from 'lucide-react';

interface ThumbnailCardProps {
  pageIndex: number;
  pageNumber: number;
  label?: string;
  width: number;
  height: number;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameLabel: () => void;
  fileBytes: Uint8Array | null;
  docId: string;
  rotation: number;
}

const ThumbnailCard: React.FC<ThumbnailCardProps> = ({
  pageNumber,
  label,
  width,
  height,
  isActive,
  isSelected,
  onSelect,
  onContextMenu,
  onRenameLabel,
  fileBytes,
  docId,
  rotation,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !fileBytes) return;

    let isMounted = true;
    let handle: { cancel: () => void; promise: Promise<void> } | null = null;

    (async () => {
      try {
        const pdfManager = PDFManager.getInstance();
        await pdfManager.ensureDocumentLoaded(docId, fileBytes);
        if (!isMounted || !canvasRef.current) return;

        const thumbScale = 140 / Math.max(width, height, 100);
        handle = pdfManager.renderPage(
          canvasRef.current,
          pageNumber,
          thumbScale,
          rotation,
          `thumb_${docId}`
        );
      } catch {
        // ignora se annullato
      }
    })();

    return () => {
      isMounted = false;
      handle?.cancel();
    };
  }, [fileBytes, pageNumber, docId, rotation, width, height]);

  const formatName = () => {
    const maxDim = Math.max(width, height);
    if (maxDim > 2500) return 'A0';
    if (maxDim > 1700) return 'A1';
    if (maxDim > 1200) return 'A2';
    if (maxDim > 900) return 'A3';
    return 'A4';
  };

  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`group flex flex-col items-center p-2 rounded cursor-pointer transition border ${
        isSelected
          ? 'bg-[#0078d4]/25 border-[#0078d4] shadow-md ring-1 ring-[#0078d4]'
          : isActive
          ? 'bg-[#0078d4]/10 border-[#0078d4]/70'
          : 'bg-[#1e1e1e] border-[#333333] hover:border-[#555] hover:bg-[#282829]'
      }`}
    >
      <div className="relative bg-white shadow rounded overflow-hidden flex items-center justify-center min-h-[90px] max-h-[170px] w-full p-1">
        <canvas ref={canvasRef} className="block max-w-full max-h-[160px] w-auto h-auto object-contain mx-auto" />
        {(isActive || isSelected) && (
          <div className="absolute top-1 right-1 bg-[#0078d4] text-white rounded-full p-0.5 shadow">
            <CheckCircle2 size={12} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between w-full mt-2 text-[11px] px-1 gap-1">
        <span
          onDoubleClick={(e) => {
            e.stopPropagation();
            onRenameLabel();
          }}
          className={`font-semibold truncate ${
            isSelected || isActive ? 'text-[#4cc2ff]' : 'text-[#ccc]'
          }`}
          title={
            label
              ? `${label} (Pagina ${pageNumber}) — Doppio click per rinominare etichetta`
              : `Pagina ${pageNumber} — Doppio click per creare etichetta`
          }
        >
          {label ? label : `Pagina ${pageNumber}`}
        </span>
        <span className="text-[10px] text-[#777] font-mono shrink-0">
          {label ? `#${pageNumber} · ` : ''}
          {formatName()}
        </span>
      </div>
    </div>
  );
};

export const ThumbnailsPanel: React.FC = () => {
  const {
    pagesInfo,
    currentPage,
    setCurrentPage,
    fileBytes,
    activeDocumentId,
    viewport,
    setInsertPagesModalOpen,
  } = useAppStore();

  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; pageIndex: number } | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Sincronizza selezione se cambia documento o numero pagine
  useEffect(() => {
    setSelectedIndices((prev) => prev.filter((idx) => idx >= 0 && idx < pagesInfo.length));
  }, [pagesInfo.length, activeDocumentId]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('mousedown', closeMenu);
    return () => window.removeEventListener('mousedown', closeMenu);
  }, []);

  const getTargetIndices = (fallbackIdx?: number): number[] => {
    if (selectedIndices.length > 0) return selectedIndices;
    if (fallbackIdx !== undefined) return [fallbackIdx];
    return [Math.max(0, Math.min(pagesInfo.length - 1, currentPage - 1))];
  };

  const handleCardSelect = (idx: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIdx !== null) {
      const start = Math.min(lastClickedIdx, idx);
      const end = Math.max(lastClickedIdx, idx);
      const range: number[] = [];
      for (let i = start; i <= end; i++) range.push(i);
      setSelectedIndices(range);
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIndices((prev) =>
        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx].sort((a, b) => a - b)
      );
      setLastClickedIdx(idx);
    } else {
      setSelectedIndices([idx]);
      setLastClickedIdx(idx);
    }
    setCurrentPage(idx + 1);
  };

  const handleCardContextMenu = (idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedIndices.includes(idx)) {
      setSelectedIndices([idx]);
      setLastClickedIdx(idx);
    }
    setCurrentPage(idx + 1);
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 230),
      y: Math.min(e.clientY, window.innerHeight - 310),
      pageIndex: idx,
    });
  };

  const runOp = async (fn: () => Promise<void>) => {
    if (isBusy) return;
    setIsBusy(true);
    setContextMenu(null);
    try {
      await fn();
    } catch (err) {
      console.error('Errore operazione pagina:', err);
      alert('Errore durante l\'operazione sulle pagine del PDF.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRotate = (delta: number, fallbackIdx?: number) => {
    const targets = getTargetIndices(fallbackIdx);
    void runOp(() => rotatePagesInActiveDocument(targets, delta));
  };

  const handleDelete = (fallbackIdx?: number) => {
    const targets = getTargetIndices(fallbackIdx);
    if (pagesInfo.length <= 1 || targets.length >= pagesInfo.length) {
      alert('Il documento deve mantenere almeno una pagina.');
      return;
    }
    const ok = window.confirm(
      targets.length === 1
        ? `Eliminare definitivamente la pagina ${targets[0] + 1}?`
        : `Eliminare definitivamente le ${targets.length} pagine selezionate?`
    );
    if (!ok) return;
    setSelectedIndices([]);
    void runOp(() => deletePagesFromActiveDocument(targets));
  };

  const handleRenameLabel = (pageIdx: number) => {
    const currentLabel = pagesInfo[pageIdx]?.label || '';
    const next = window.prompt(
      `Etichetta per Pagina ${pageIdx + 1} (lascia vuoto per usare il numero standard):`,
      currentLabel
    );
    if (next === null) return;
    void runOp(() => renamePageLabelInActiveDocument(pageIdx, next));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' && selectedIndices.length > 0 && pagesInfo.length > 1) {
      e.preventDefault();
      handleDelete();
    }
  };

  const menuItemClass =
    'flex items-center justify-between px-3 py-1.5 hover:bg-[#0078d4] hover:text-white cursor-pointer text-[11.5px] text-[#e0e0e0]';

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex flex-col h-full bg-[#202022] text-xs select-none focus:outline-none"
    >
      {/* Intestazione Pannello Miniature */}
      <div className="h-9 px-2.5 bg-[#1e1e1e] border-b border-[#333333] flex items-center justify-between font-bold text-white shrink-0">
        <span className="text-[11.5px] truncate">
          Anteprime ({pagesInfo.length})
          {selectedIndices.length > 1 && (
            <span className="ml-1 text-[10px] text-[#4cc2ff] font-normal">
              · {selectedIndices.length} sel.
            </span>
          )}
        </span>
        <div className="flex items-center space-x-0.5">
          <button
            onClick={() => setInsertPagesModalOpen(true)}
            disabled={!fileBytes || isBusy}
            className="p-1 hover:bg-[#333333] text-[#4cc2ff] hover:text-white disabled:opacity-40 rounded transition"
            title="Inserisci pagine da file aperti o dal computer (Ctrl+Shift+I)"
          >
            <FilePlus2 size={13} />
          </button>
          <button
            onClick={() =>
              void runOp(() =>
                insertBlankPageInActiveDocument(Math.max(0, currentPage - 1), 'after')
              )
            }
            disabled={!fileBytes || isBusy}
            className="p-1 hover:bg-[#333333] text-[#aaa] hover:text-white disabled:opacity-40 rounded transition"
            title="Inserisci pagina vuota dopo la pagina corrente"
          >
            <FilePlus size={13} />
          </button>
          <button
            onClick={() => handleRotate(-90)}
            disabled={!fileBytes || isBusy}
            className="p-1 hover:bg-[#333333] text-[#f5b942] hover:text-white disabled:opacity-40 rounded transition"
            title="Ruota pagine selezionate 90° Antiorario"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={() => handleRotate(90)}
            disabled={!fileBytes || isBusy}
            className="p-1 hover:bg-[#333333] text-[#f5b942] hover:text-white disabled:opacity-40 rounded transition"
            title="Ruota pagine selezionate 90° Orario"
          >
            <RotateCw size={13} />
          </button>
          <button
            onClick={() => handleRenameLabel(getTargetIndices()[0])}
            disabled={!fileBytes || isBusy || pagesInfo.length === 0}
            className="p-1 hover:bg-[#333333] text-[#aaa] hover:text-white disabled:opacity-40 rounded transition"
            title="Crea / Rinomina etichetta pagina"
          >
            <Tag size={13} />
          </button>
          <button
            onClick={() => handleDelete()}
            disabled={!fileBytes || isBusy || pagesInfo.length <= 1}
            className="p-1 hover:bg-red-700/70 text-[#aaa] hover:text-white disabled:opacity-30 rounded transition"
            title="Elimina pagine selezionate (Canc)"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Griglia Miniature */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {pagesInfo.length === 0 ? (
          <div className="p-4 text-center text-[#666] text-xs italic">
            Nessun documento caricato.
          </div>
        ) : (
          pagesInfo.map((p, idx) => (
            <ThumbnailCard
              key={`${activeDocumentId}_${p.pageNumber}_${p.width}_${p.height}_${p.rotation}`}
              pageIndex={idx}
              pageNumber={p.pageNumber}
              label={p.label}
              width={p.width}
              height={p.height}
              isActive={currentPage === p.pageNumber}
              isSelected={selectedIndices.includes(idx)}
              onSelect={(e) => handleCardSelect(idx, e)}
              onContextMenu={(e) => handleCardContextMenu(idx, e)}
              onRenameLabel={() => handleRenameLabel(idx)}
              fileBytes={fileBytes}
              docId={activeDocumentId}
              rotation={viewport.rotation || 0}
            />
          ))
        )}
      </div>

      {/* Menu Contestuale Miniature (stile Bluebeam Revu) */}
      {contextMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          className="fixed z-[950] w-60 bg-[#252526] border border-[#454545] rounded shadow-2xl py-1"
        >
          <div
            className={menuItemClass}
            onClick={() =>
              void runOp(() => insertBlankPageInActiveDocument(contextMenu.pageIndex, 'after'))
            }
          >
            <span>Inserisci pagina vuota (dopo)</span>
          </div>
          <div
            className={menuItemClass}
            onClick={() =>
              void runOp(() => insertBlankPageInActiveDocument(contextMenu.pageIndex, 'before'))
            }
          >
            <span>Inserisci pagina vuota (prima)</span>
          </div>
          <div
            className={menuItemClass}
            onClick={() => {
              setContextMenu(null);
              setInsertPagesModalOpen(true);
            }}
          >
            <span className="font-semibold text-white">Inserisci pagine...</span>
            <span className="text-[10px] text-[#888]">Ctrl+Shift+I</span>
          </div>
          <div className="h-px bg-[#3e3e42] my-1" />
          <div
            className={`${menuItemClass} ${
              pagesInfo.length <= 1 ? 'opacity-40 pointer-events-none' : 'text-red-300'
            }`}
            onClick={() => handleDelete(contextMenu.pageIndex)}
          >
            <span>Elimina pagine...</span>
            <span className="text-[10px] text-[#888]">Canc</span>
          </div>
          <div className="h-px bg-[#3e3e42] my-1" />
          <div
            className={menuItemClass}
            onClick={() => handleRotate(90, contextMenu.pageIndex)}
          >
            <span>Ruota pagina 90° Orario</span>
          </div>
          <div
            className={menuItemClass}
            onClick={() => handleRotate(-90, contextMenu.pageIndex)}
          >
            <span>Ruota pagina 90° Antiorario</span>
          </div>
          <div
            className={menuItemClass}
            onClick={() => handleRotate(180, contextMenu.pageIndex)}
          >
            <span>Ruota pagina 180°</span>
          </div>
          <div className="h-px bg-[#3e3e42] my-1" />
          <div
            className={menuItemClass}
            onClick={() => {
              const target = contextMenu.pageIndex;
              setContextMenu(null);
              handleRenameLabel(target);
            }}
          >
            <span>Rinomina l&apos;etichetta della pagina...</span>
          </div>
          <div
            className={menuItemClass}
            onClick={() => void runOp(() => resetAllPageLabelsInActiveDocument())}
          >
            <span>Ripristina tutte le etichette pagina</span>
          </div>
        </div>
      )}
    </div>
  );
};
