import React, { useLayoutEffect, useRef, useState } from 'react';
import { AnyMarkup } from '@/types/markup';
import { useAppStore, extractFormatStyle } from '@/store/useAppStore';
import { flattenMarkupsIntoPdfBytes } from '@/core/pdf/pdfFlattenService';
import { MarkupRenderer } from '@/core/markup/markupRenderer';
import {
  Scissors,
  Copy,
  Clipboard,
  CopyPlus,
  Paintbrush,
  X,
  MessageSquare,
  Palette,
  Layers,
  ArrowUpDown,
  AlignLeft,
  Lock,
  Unlock,
  EyeOff,
  Reply,
  CheckCircle2,
  Wrench,
  Settings,
  StickyNote,
  BookmarkPlus,
  Flag,
  ChevronRight,
  CornerDownRight,
  Trash2,
  Printer,
  Search,
  CheckSquare,
  Square,
  Ungroup,
  Group,
} from 'lucide-react';

export interface ContextMenuState {
  x: number;
  y: number;
  pageIndex: number;
  pdfPt: { x: number; y: number };
  hitMarkupId: string | null;
}

interface BluebeamContextMenuProps {
  menu: ContextMenuState;
  docId: 'primary' | 'secondary';
  currentPage: number;
  numPages: number;
  onSetCurrentPage: (p: number) => void;
  onClose: () => void;
  onToast: (msg: string) => void;
}

const COLOR_SWATCHES = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#000000',
  '#ffffff',
];

let internalClipboard: AnyMarkup[] = [];
let internalStyleClipboard: Partial<AnyMarkup> | null = null;

function translateMarkup(m: AnyMarkup, dx: number, dy: number): AnyMarkup {
  const c = JSON.parse(JSON.stringify(m)) as AnyMarkup;
  if ('boxRect' in c && c.boxRect) {
    c.boxRect.x += dx;
    c.boxRect.y += dy;
  }
  if ('points' in c && Array.isArray(c.points)) {
    c.points = c.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  if (c.type === 'line') {
    c.startPoint = { x: c.startPoint.x + dx, y: c.startPoint.y + dy };
    c.endPoint = { x: c.endPoint.x + dx, y: c.endPoint.y + dy };
  }
  if (c.type === 'callout') {
    c.arrowPoint = { x: c.arrowPoint.x + dx, y: c.arrowPoint.y + dy };
    if (c.elbowPoint) {
      c.elbowPoint = { x: c.elbowPoint.x + dx, y: c.elbowPoint.y + dy };
    }
  }
  return c;
}

export const BluebeamContextMenu: React.FC<BluebeamContextMenuProps> = ({
  menu,
  docId,
  currentPage,
  numPages,
  onSetCurrentPage,
  onClose,
  onToast,
}) => {
  const {
    markups,
    selectedMarkupIds,
    addMarkup,
    updateMarkup,
    deleteMarkup,
    selectMarkup,
    groupSelectedMarkups,
    ungroupSelectedMarkup,
    saveSelectedToToolChest,
    toolSets,
    layers,
    createLayer,
    assignMarkupsToLayer,
    setActiveTool,
    setAddingCalloutLeaderId,
    setActiveRightPanel,
    setActiveColor,
    setActiveFillColor,
    setActiveStrokeWidth,
  } = useAppStore();

  const [openSub, setOpenSub] = useState<string | null>(null);
  const [subAnchor, setSubAnchor] = useState<{ left: number; right: number; top: number } | null>(null);

  const activateSub = (id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setOpenSub(id);
    setSubAnchor({ left: r.left, right: r.right, top: r.top });
  };

  const getSubStyle = (width: number, estHeight = 260): React.CSSProperties => {
    if (!subAnchor) return { position: 'fixed', left: pos.left + 238, top: pos.top, width, zIndex: 120 };
    const openLeft = subAnchor.right + width + 8 > window.innerWidth;
    const left = openLeft
      ? Math.max(8, subAnchor.left - width + 2)
      : Math.min(window.innerWidth - width - 8, subAnchor.right - 2);
    const top = Math.max(8, Math.min(subAnchor.top, window.innerHeight - estHeight - 8));
    return { position: 'fixed', left, top, width, zIndex: 120 };
  };
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: Math.max(8, Math.min(menu.x, window.innerWidth - 252)),
    top: Math.max(8, Math.min(menu.y, window.innerHeight - 400)),
  });

  const selectedList = markups.filter((m) => selectedMarkupIds.includes(m.id));
  const primaryMarkup = selectedList[0] || null;
  const hasSelection = selectedList.length > 0;
  const canGroup = selectedList.length >= 2;
  const canUngroup = selectedList.some((m) => m.compoundPaths && m.compoundPaths.length > 1);
  const allLocked = hasSelection && selectedList.every((m) => m.locked);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedLeft = Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8));
    const clampedTop = Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8));
    setPos({ left: clampedLeft, top: clampedTop });
  }, [menu.x, menu.y, hasSelection, canGroup, canUngroup]);

  const handleCut = () => {
    internalClipboard = selectedList.map((m) => JSON.parse(JSON.stringify(m)));
    selectedList.forEach((m) => deleteMarkup(m.id));
    selectMarkup(null);
    onToast(`Tagliati ${internalClipboard.length} elementi`);
    onClose();
  };

  const handleCopy = () => {
    internalClipboard = selectedList.map((m) => JSON.parse(JSON.stringify(m)));
    onToast(`Copiati ${internalClipboard.length} elementi`);
    onClose();
  };

  const handlePaste = () => {
    if (internalClipboard.length === 0) {
      onToast('Appunti vuoti');
      onClose();
      return;
    }
    const newIds: string[] = [];
    internalClipboard.forEach((src) => {
      const cloned = translateMarkup(src, 18, 18);
      cloned.id = crypto.randomUUID();
      cloned.docId = docId;
      cloned.pageIndex = menu.pageIndex;
      cloned.creationDate = new Date().toISOString();
      cloned.modificationDate = new Date().toISOString();
      addMarkup(cloned);
      newIds.push(cloned.id);
    });
    useAppStore.setState({ selectedMarkupIds: newIds });
    onClose();
  };

  const handleDuplicate = () => {
    const newIds: string[] = [];
    selectedList.forEach((src) => {
      const cloned = translateMarkup(src, 20, 20);
      cloned.id = crypto.randomUUID();
      cloned.creationDate = new Date().toISOString();
      cloned.modificationDate = new Date().toISOString();
      addMarkup(cloned);
      newIds.push(cloned.id);
    });
    useAppStore.setState({ selectedMarkupIds: newIds });
    onClose();
  };

  const handleCopyFormat = () => {
    if (!primaryMarkup) return;
    const style = extractFormatStyle(primaryMarkup);
    internalStyleClipboard = style;
    useAppStore.getState().setActiveTool('select');
    useAppStore.getState().setFormatPainterStyle(style);
    onToast('Copia formato attivo: clicca sugli oggetti di destinazione (Esc per uscire)');
    onClose();
  };

  const handlePasteFormat = () => {
    if (!internalStyleClipboard) return;
    selectedList.forEach((m) => updateMarkup(m.id, internalStyleClipboard!));
    onToast('Formato applicato');
    onClose();
  };

  const handleDelete = () => {
    selectedList.forEach((m) => deleteMarkup(m.id));
    selectMarkup(null);
    onClose();
  };

  const recolorImageDataUrl = (dataUrl: string, targetHex: string): Promise<string> => {
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

        const clean = targetHex.replace('#', '');
        const tr = parseInt(clean.slice(0, 2), 16) || 0;
        const tg = parseInt(clean.slice(2, 4), 16) || 0;
        const tb = parseInt(clean.slice(4, 6), 16) || 0;

        for (let i = 0; i < d.length; i += 4) {
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          const a = d[i + 3];
          if (a < 12) continue;

          // Luminosità [0=nero .. 1=bianco]
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          if (lum >= 0.94) {
            // Mantiene intatto lo sfondo bianco
            continue;
          }
          // Miscela proporzionale rispetto al bianco per preservare anti-aliasing nitido sui tratti
          const ink = Math.min(1, (1 - lum) / 0.85);
          d[i] = Math.round(255 * (1 - ink) + tr * ink);
          d[i + 1] = Math.round(255 * (1 - ink) + tg * ink);
          d[i + 2] = Math.round(255 * (1 - ink) + tb * ink);
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  const handleRecolor = async (hex: string) => {
    for (const m of selectedList) {
      if (m.type === 'stamp' && (m as any).imageDataUrl) {
        const newUrl = await recolorImageDataUrl((m as any).imageDataUrl, hex);
        await MarkupRenderer.preloadStampImage(m.id, newUrl);
        updateMarkup(m.id, { imageDataUrl: newUrl, strokeColor: hex } as any);
        continue;
      }
      const updates: any = {};
      if (m.strokeColor !== 'transparent') {
        updates.strokeColor = hex;
      }
      if (m.type === 'textbox' || m.type === 'callout' || m.type === 'cloud_plus') {
        updates.textColor = hex;
      }
      if (m.compoundPaths && m.compoundPaths.length > 0) {
        updates.compoundPaths = m.compoundPaths.map((cp) => ({
          ...cp,
          strokeColor: cp.strokeColor === 'transparent' ? 'transparent' : hex,
          fillColor: cp.fillColor && cp.fillColor !== 'transparent' ? hex : cp.fillColor,
        }));
      }
      updateMarkup(m.id, updates);
    }
    onToast(`Colore applicato (${hex})`);
    onClose();
  };

  const handleReorder = (dir: 'front' | 'back' | 'forward' | 'backward') => {
    const all = [...markups];
    const selSet = new Set(selectedMarkupIds);
    const nonSelected = all.filter((m) => !selSet.has(m.id));
    const selected = all.filter((m) => selSet.has(m.id));
    let next = all;
    if (dir === 'front') {
      next = [...nonSelected, ...selected];
    } else if (dir === 'back') {
      next = [...selected, ...nonSelected];
    } else if (dir === 'forward' && selected.length === 1) {
      const idx = all.findIndex((m) => m.id === selected[0].id);
      if (idx >= 0 && idx < all.length - 1) {
        next = [...all];
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      }
    } else if (dir === 'backward' && selected.length === 1) {
      const idx = all.findIndex((m) => m.id === selected[0].id);
      if (idx > 0) {
        next = [...all];
        [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
      }
    }
    useAppStore.setState({ markups: next });
    onClose();
  };

  const handleAlign = (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (selectedList.length < 2) return;
    const boxes = selectedList.map((m) => {
      if ('boxRect' in m && m.boxRect) {
        return { m, ...m.boxRect };
      }
      if ('points' in m && m.points && m.points.length > 0) {
        const xs = m.points.map((p) => p.x);
        const ys = m.points.map((p) => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        return { m, x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
      }
      return { m, x: 0, y: 0, width: 0, height: 0 };
    });

    const minX = Math.min(...boxes.map((b) => b.x));
    const maxX = Math.max(...boxes.map((b) => b.x + b.width));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxY = Math.max(...boxes.map((b) => b.y + b.height));
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    boxes.forEach((b) => {
      let dx = 0;
      let dy = 0;
      if (mode === 'left') dx = minX - b.x;
      if (mode === 'right') dx = maxX - (b.x + b.width);
      if (mode === 'center') dx = midX - (b.x + b.width / 2);
      if (mode === 'top') dy = minY - b.y;
      if (mode === 'bottom') dy = maxY - (b.y + b.height);
      if (mode === 'middle') dy = midY - (b.y + b.height / 2);
      if (dx !== 0 || dy !== 0) {
        const moved = translateMarkup(b.m, dx, dy);
        updateMarkup(b.m.id, moved);
      }
    });
    onClose();
  };

  const handleToggleLock = () => {
    const nextLocked = !allLocked;
    selectedList.forEach((m) => updateMarkup(m.id, { locked: nextLocked }));
    onToast(nextLocked ? 'Oggetto bloccato' : 'Oggetto sbloccato');
    onClose();
  };

  const handleSetStatus = (status: AnyMarkup['status']) => {
    selectedList.forEach((m) => updateMarkup(m.id, { status }));
    onClose();
  };

  const handleOpenPopupNote = () => {
    if (!primaryMarkup) return;
    const note = window.prompt('Nota / Commento:', primaryMarkup.contents || '');
    if (note !== null) {
      updateMarkup(primaryMarkup.id, { contents: note });
    }
    onClose();
  };

  const handleAddNoteAtCursor = () => {
    const noteId = crypto.randomUUID();
    addMarkup({
      id: noteId,
      docId,
      type: 'rectangle',
      pageIndex: menu.pageIndex,
      author: 'Fabio Ferreri',
      subject: 'Nota',
      contents: 'Nuova nota',
      creationDate: new Date().toISOString(),
      modificationDate: new Date().toISOString(),
      status: 'None',
      strokeColor: '#996600',
      fillColor: '#ffc100',
      fillOpacity: 0.95,
      strokeWidth: 1.5,
      opacity: 1,
      boxRect: { x: menu.pdfPt.x - 10, y: menu.pdfPt.y - 10, width: 22, height: 22 },
    });
    selectMarkup(noteId);
    onClose();
  };

  const handleApplyToAllPages = () => {
    if (!primaryMarkup || numPages <= 1) return;
    for (let p = 0; p < numPages; p++) {
      if (p === primaryMarkup.pageIndex) continue;
      const cloned = JSON.parse(JSON.stringify(primaryMarkup)) as AnyMarkup;
      cloned.id = crypto.randomUUID();
      cloned.pageIndex = p;
      cloned.creationDate = new Date().toISOString();
      cloned.modificationDate = new Date().toISOString();
      addMarkup(cloned);
    }
    onToast(`Applicato a tutte le ${numPages} pagine`);
    onClose();
  };

  const rowCls =
    'w-full px-3 py-1.5 flex items-center justify-between text-[12px] text-[#e4e4e4] hover:bg-[#0078d4] hover:text-white transition text-left cursor-pointer';
  const disabledCls =
    'w-full px-3 py-1.5 flex items-center justify-between text-[12px] text-[#6a6a6e] cursor-not-allowed text-left';
  const sepCls = 'my-1 border-t border-[#3b3b40]';

  return (
    <div
      className="fixed inset-0 z-[100]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="fixed w-[240px] max-h-[calc(100vh-16px)] overflow-y-auto bg-[#2a2a2d] border border-[#45454a] shadow-2xl rounded py-1 select-none text-[#e4e4e4]"
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!hasSelection ? (
          /* MENU CONTESTUALE PAGINA VUOTA (Fedele allo screenshot Bluebeam Revu) */
          <>
            <button
              onClick={handlePaste}
              className={internalClipboard.length > 0 ? rowCls : disabledCls}
              disabled={internalClipboard.length === 0}
            >
              <span className="flex items-center gap-2.5">
                <Clipboard size={13} />
                <span>Incolla</span>
              </span>
              <span className="text-[11px] opacity-75">Ctrl+V</span>
            </button>
            <button onClick={handleAddNoteAtCursor} className={rowCls}>
              <span className="flex items-center gap-2.5">
                <StickyNote size={13} />
                <span>Aggiungi nota</span>
              </span>
            </button>
            <button
              onClick={() => {
                onToast(`Segnalibro aggiunto a Pagina ${currentPage}`);
                onClose();
              }}
              className={rowCls}
            >
              <span className="flex items-center gap-2.5">
                <BookmarkPlus size={13} />
                <span>Aggiungi segnalibro</span>
              </span>
              <span className="text-[11px] opacity-75">Ctrl+B</span>
            </button>
            <button
              onClick={() => {
                onToast(`Flag aggiunto a Pagina ${currentPage}`);
                onClose();
              }}
              className={rowCls}
            >
              <span className="flex items-center gap-2.5">
                <Flag size={13} className="text-[#4ade80]" />
                <span>Aggiungi flag</span>
              </span>
            </button>

            <div className={sepCls} />

            <button
              onClick={() => {
                if (currentPage < numPages) onSetCurrentPage(currentPage + 1);
                onClose();
              }}
              disabled={currentPage >= numPages}
              className={currentPage < numPages ? rowCls : disabledCls}
            >
              <span className="pl-5">Pagina successiva</span>
              <span className="text-[11px] opacity-75">Ctrl+Destra</span>
            </button>
            <button
              onClick={() => {
                if (currentPage > 1) onSetCurrentPage(currentPage - 1);
                onClose();
              }}
              disabled={currentPage <= 1}
              className={currentPage > 1 ? rowCls : disabledCls}
            >
              <span className="pl-5">Pagina precedente</span>
              <span className="text-[11px] opacity-75">Ctrl+Sinistra</span>
            </button>

            <div className={sepCls} />

            <button
              onClick={() => {
                const pageIds = markups
                  .filter((m) => m.pageIndex === menu.pageIndex && (!m.docId || m.docId === docId))
                  .map((m) => m.id);
                useAppStore.setState({ selectedMarkupIds: pageIds });
                onClose();
              }}
              className={rowCls}
            >
              <span className="flex items-center gap-2.5">
                <CheckSquare size={13} />
                <span>Seleziona tutto</span>
              </span>
              <span className="text-[11px] opacity-75">Ctrl+A</span>
            </button>
            <button
              onClick={() => {
                setActiveTool('select_text');
                onClose();
              }}
              className={rowCls}
            >
              <span className="pl-5">Seleziona tutto il testo</span>
              <span className="text-[11px] opacity-75">Ctrl+Maiusc+A</span>
            </button>
            <button
              onClick={() => {
                selectMarkup(null);
                onClose();
              }}
              className={rowCls}
            >
              <span className="flex items-center gap-2.5">
                <Square size={13} />
                <span>Deseleziona tutto</span>
              </span>
            </button>

            <div className={sepCls} />

            <button
              onClick={() => {
                onClose();
                window.print();
              }}
              className={rowCls}
            >
              <span className="flex items-center gap-2.5">
                <Printer size={13} />
                <span>Stampa...</span>
              </span>
              <span className="text-[11px] opacity-75">Ctrl+P</span>
            </button>
            <button
              onClick={() => {
                useAppStore.getState().setActiveLeftPanel('bookmarks');
                onClose();
              }}
              className={rowCls}
            >
              <span className="flex items-center gap-2.5">
                <Search size={13} />
                <span>Cerca...</span>
              </span>
            </button>
          </>
        ) : (
          /* MENU CONTESTUALE MARKUP / SIMBOLI SELEZIONATI (Fedele agli screenshot Bluebeam Revu) */
          <>
            <button onClick={handleCut} className={rowCls}>
              <span className="flex items-center gap-2.5">
                <Scissors size={13} />
                <span>Taglia</span>
              </span>
              <span className="text-[11px] opacity-75">Ctrl+X</span>
            </button>
            <button onClick={handleCopy} className={rowCls}>
              <span className="flex items-center gap-2.5">
                <Copy size={13} />
                <span>Copia</span>
              </span>
              <span className="text-[11px] opacity-75">Ctrl+C</span>
            </button>
            <button
              onClick={handlePaste}
              disabled={internalClipboard.length === 0}
              className={internalClipboard.length > 0 ? rowCls : disabledCls}
            >
              <span className="flex items-center gap-2.5">
                <Clipboard size={13} />
                <span>Incolla</span>
              </span>
              <span className="text-[11px] opacity-75">Ctrl+V</span>
            </button>
            <button onClick={handleDuplicate} className={rowCls}>
              <span className="flex items-center gap-2.5">
                <CopyPlus size={13} />
                <span>Moltiplica...</span>
              </span>
              <span className="text-[11px] opacity-75">Ctrl+M</span>
            </button>
            <button onClick={handleCopyFormat} className={rowCls}>
              <span className="flex items-center gap-2.5">
                <Paintbrush size={13} />
                <span>Copia formato</span>
              </span>
              <span className="text-[11px] opacity-75">Ctrl+Maiusc+C</span>
            </button>
            {internalStyleClipboard && (
              <button onClick={handlePasteFormat} className={rowCls}>
                <span className="pl-5">Incolla formato</span>
              </button>
            )}
            <button onClick={handleDelete} className={rowCls}>
              <span className="flex items-center gap-2.5">
                <X size={13} />
                <span>Elimina</span>
              </span>
              <span className="text-[11px] opacity-75">CANC</span>
            </button>

            <div className={sepCls} />

            <button onClick={handleOpenPopupNote} className={rowCls}>
              <span className="flex items-center gap-2.5">
                <MessageSquare size={13} />
                <span>Apri nota popup</span>
              </span>
            </button>

            <div className={sepCls} />

            {/* Cambia colori */}
            {(() => {
              const hasSnapshot = selectedList.some(
                (m) => m.type === 'stamp' && Boolean((m as any).imageDataUrl)
              );
              const openColorDialog = () => {
                useAppStore.getState().setColorProcessingIds(selectedList.map((m) => m.id));
                onClose();
              };
              return (
                <div
                  className="relative"
                  onMouseEnter={(e) => activateSub('colors', e.currentTarget)}
                  onMouseLeave={() => setOpenSub(null)}
                >
                  <button
                    className={rowCls}
                    onClick={hasSnapshot ? openColorDialog : undefined}
                  >
                    <span className="flex items-center gap-2.5">
                      <Palette size={13} />
                      <span>{hasSnapshot ? 'Cambia colori...' : 'Cambia colori'}</span>
                    </span>
                    <ChevronRight size={13} />
                  </button>
                  {openSub === 'colors' && (
                    <div
                      style={getSubStyle(192, hasSnapshot ? 210 : 170)}
                      className="bg-[#2a2a2d] border border-[#45454a] shadow-2xl rounded p-2"
                    >
                      {hasSnapshot && (
                        <button
                          onClick={openColorDialog}
                          className="w-full mb-2 px-2 py-1.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded text-[11px] font-medium text-center cursor-pointer transition"
                        >
                          Elaborazione colore...
                        </button>
                      )}
                      <div className="text-[10px] text-[#999] mb-1.5">
                        {hasSnapshot ? 'Tinta rapida:' : 'Colore simbolo / linea'}
                      </div>
                      <div className="grid grid-cols-5 gap-1.5">
                        {COLOR_SWATCHES.map((hex) => (
                          <button
                            key={hex}
                            onClick={() => void handleRecolor(hex)}
                            className="w-6 h-6 rounded border border-[#555] hover:scale-110 transition"
                            style={{ backgroundColor: hex }}
                            title={hex}
                          />
                        ))}
                      </div>
                      <div className="mt-2 pt-1.5 border-t border-[#3e3e44] flex items-center justify-between gap-2">
                        <span className="text-[10px] text-[#bbb]">Personalizzato:</span>
                        <input
                          type="color"
                          defaultValue="#ff0000"
                          onChange={(e) => void handleRecolor(e.target.value)}
                          className="w-6 h-5 bg-transparent cursor-pointer rounded border border-[#555]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className={sepCls} />

            {/* Ordine */}
            <div
              className="relative"
              onMouseEnter={(e) => activateSub('order', e.currentTarget)}
              onMouseLeave={() => setOpenSub(null)}
            >
              <button className={rowCls}>
                <span className="flex items-center gap-2.5">
                  <ArrowUpDown size={13} />
                  <span>Ordine</span>
                </span>
                <ChevronRight size={13} />
              </button>
              {openSub === 'order' && (
                <div
                  style={getSubStyle(192, 140)}
                  className="bg-[#2a2a2d] border border-[#45454a] shadow-2xl rounded py-1"
                >
                  <button onClick={() => handleReorder('front')} className={rowCls}>
                    <span>Porta in primo piano</span>
                  </button>
                  <button onClick={() => handleReorder('forward')} className={rowCls}>
                    <span>Porta avanti</span>
                  </button>
                  <button onClick={() => handleReorder('backward')} className={rowCls}>
                    <span>Porta indietro</span>
                  </button>
                  <button onClick={() => handleReorder('back')} className={rowCls}>
                    <span>Porta in secondo piano</span>
                  </button>
                </div>
              )}
            </div>

            {/* Allineamento */}
            <div
              className="relative"
              onMouseEnter={(e) => activateSub('align', e.currentTarget)}
              onMouseLeave={() => setOpenSub(null)}
            >
              <button className={selectedList.length >= 2 ? rowCls : disabledCls}>
                <span className="flex items-center gap-2.5">
                  <AlignLeft size={13} />
                  <span>Allineamento</span>
                </span>
                <ChevronRight size={13} />
              </button>
              {openSub === 'align' && selectedList.length >= 2 && (
                <div
                  style={getSubStyle(192, 210)}
                  className="bg-[#2a2a2d] border border-[#45454a] shadow-2xl rounded py-1"
                >
                  <button onClick={() => handleAlign('left')} className={rowCls}>
                    <span>Allinea a sinistra</span>
                  </button>
                  <button onClick={() => handleAlign('center')} className={rowCls}>
                    <span>Allinea al centro</span>
                  </button>
                  <button onClick={() => handleAlign('right')} className={rowCls}>
                    <span>Allinea a destra</span>
                  </button>
                  <div className={sepCls} />
                  <button onClick={() => handleAlign('top')} className={rowCls}>
                    <span>Allinea in alto</span>
                  </button>
                  <button onClick={() => handleAlign('middle')} className={rowCls}>
                    <span>Allinea al centro verticale</span>
                  </button>
                  <button onClick={() => handleAlign('bottom')} className={rowCls}>
                    <span>Allinea in basso</span>
                  </button>
                </div>
              )}
            </div>

            <div className={sepCls} />

            {selectedList.length >= 1 && (() => {
              const rotateAllBy = (deltaDeg: number, label: string) => {
                const rad = (deltaDeg * Math.PI) / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                selectedList.forEach((m) => {
                  if ('boxRect' in m && (m as any).boxRect) {
                    const cur = (m as any).rotation || 0;
                    updateMarkup(m.id, { rotation: ((cur + deltaDeg) % 360 + 360) % 360 } as any);
                  } else if ('points' in m && Array.isArray((m as any).points) && (m as any).points.length > 0) {
                    const pts = (m as any).points as { x: number; y: number }[];
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    for (const pt of pts) {
                      if (pt.x < minX) minX = pt.x;
                      if (pt.x > maxX) maxX = pt.x;
                      if (pt.y < minY) minY = pt.y;
                      if (pt.y > maxY) maxY = pt.y;
                    }
                    const cx = (minX + maxX) / 2;
                    const cy = (minY + maxY) / 2;
                    updateMarkup(m.id, {
                      points: pts.map((pt) => {
                        const dx = pt.x - cx;
                        const dy = pt.y - cy;
                        return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
                      }),
                    } as any);
                  } else if ('startPoint' in m && 'endPoint' in m && (m as any).startPoint && (m as any).endPoint) {
                    const sp = (m as any).startPoint as { x: number; y: number };
                    const ep = (m as any).endPoint as { x: number; y: number };
                    const cx = (sp.x + ep.x) / 2;
                    const cy = (sp.y + ep.y) / 2;
                    const rotPt = (pt: { x: number; y: number }) => {
                      const dx = pt.x - cx;
                      const dy = pt.y - cy;
                      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
                    };
                    updateMarkup(m.id, { startPoint: rotPt(sp), endPoint: rotPt(ep) } as any);
                  }
                });
                onToast(label);
                onClose();
              };
              return (
                <>
                  <div
                    className="relative"
                    onMouseEnter={(e) => activateSub('rotate', e.currentTarget)}
                    onMouseLeave={() => setOpenSub(null)}
                  >
                    <button className={rowCls}>
                      <span className="flex items-center gap-2.5">
                        <span className="w-[13px] text-center">↻</span>
                        <span>Ruota</span>
                      </span>
                      <ChevronRight size={13} />
                    </button>
                    {openSub === 'rotate' && (
                      <div
                        style={getSubStyle(184, 110)}
                        className="bg-[#2a2a2d] border border-[#45454a] shadow-2xl rounded py-1"
                      >
                        <button onClick={() => rotateAllBy(90, 'Ruotato di 90° in senso orario')} className={rowCls}>
                          <span className="flex items-center gap-2.5">
                            <span>↻</span>
                            <span>Ruota 90° Orario</span>
                          </span>
                        </button>
                        <button onClick={() => rotateAllBy(270, 'Ruotato di 90° in senso antiorario')} className={rowCls}>
                          <span className="flex items-center gap-2.5">
                            <span>↺</span>
                            <span>Ruota 90° Antiorario</span>
                          </span>
                        </button>
                        <button onClick={() => rotateAllBy(180, 'Ruotato di 180°')} className={rowCls}>
                          <span className="flex items-center gap-2.5">
                            <span>⇄</span>
                            <span>Ruota 180°</span>
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                  <div className={sepCls} />
                </>
              );
            })()}

            {selectedList.length === 1 && primaryMarkup?.type === 'callout' && (
              <>
                <button
                  onClick={() => {
                    setAddingCalloutLeaderId(primaryMarkup.id);
                    onToast('Clicca sul foglio per aggiungere una freccia al Callout (Esc per annullare)');
                    onClose();
                  }}
                  className={rowCls}
                >
                  <span className="flex items-center gap-2.5">
                    <CornerDownRight size={13} className="text-[#50e6ff]" />
                    <span>Aggiungi freccia</span>
                  </span>
                </button>
                <button
                  disabled={!((primaryMarkup as any).extraArrows && (primaryMarkup as any).extraArrows.length > 0)}
                  onClick={() => {
                    const cm = primaryMarkup as any;
                    const extras: { x: number; y: number }[] = cm.extraArrows || [];
                    if (extras.length === 0) return;
                    if (menu.pdfPt) {
                      const allTips = [cm.arrowPoint, ...extras];
                      let bestIdx = extras.length;
                      let bestDist = Infinity;
                      allTips.forEach((tip, i) => {
                        const d = Math.hypot(tip.x - menu.pdfPt!.x, tip.y - menu.pdfPt!.y);
                        if (d < bestDist) {
                          bestDist = d;
                          bestIdx = i;
                        }
                      });
                      if (bestIdx === 0) {
                        const [newMain, ...rest] = extras;
                        updateMarkup(cm.id, { arrowPoint: newMain, extraArrows: rest } as any);
                      } else {
                        updateMarkup(cm.id, {
                          extraArrows: extras.filter((_, idx) => idx !== bestIdx - 1),
                        } as any);
                      }
                    } else {
                      updateMarkup(cm.id, { extraArrows: extras.slice(0, -1) } as any);
                    }
                    onToast('Freccia rimossa dal Callout');
                    onClose();
                  }}
                  className={`${rowCls} ${
                    !((primaryMarkup as any).extraArrows && (primaryMarkup as any).extraArrows.length > 0)
                      ? 'opacity-40 pointer-events-none'
                      : ''
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Trash2 size={13} className="text-[#f87171]" />
                    <span>Elimina freccia</span>
                  </span>
                </button>
                <div className={sepCls} />
              </>
            )}

            {/* Livello (Sposta su altro Layer) */}
            <div
              className="relative"
              onMouseEnter={(e) => activateSub('layer', e.currentTarget)}
              onMouseLeave={() => setOpenSub(null)}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (openSub === 'layer') {
                    setOpenSub(null);
                  } else if (e.currentTarget.parentElement) {
                    activateSub('layer', e.currentTarget.parentElement);
                  }
                }}
                className={rowCls}
              >
                <span className="flex items-center gap-2.5">
                  <Layers size={13} className="text-[#50e6ff]" />
                  <span>Livello</span>
                </span>
                <ChevronRight size={13} />
              </button>
              {openSub === 'layer' && (
                <div
                  style={getSubStyle(224, Math.min(320, layers.length * 32 + 72))}
                  className="bg-[#2a2a2d] border border-[#45454a] shadow-2xl rounded py-1 max-h-80 overflow-y-auto"
                >
                  <div className="px-3 py-1 text-[10px] text-[#999] uppercase font-semibold border-b border-[#3a3a40] mb-0.5">
                    Livelli disponibili
                  </div>
                  {layers.map((l) => {
                    const allOnThis = selectedList.every((m) => (m.layerId || 'default') === l.id);
                    const someOnThis = selectedList.some((m) => (m.layerId || 'default') === l.id);
                    return (
                      <button
                        key={l.id}
                        onClick={() => {
                          assignMarkupsToLayer(selectedMarkupIds, l.id);
                          onToast(`Spostato su livello "${l.name}"`);
                          onClose();
                        }}
                        className={rowCls}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span className="w-3.5 text-center text-[#50e6ff] font-bold">
                            {allOnThis ? '✓' : someOnThis ? '•' : ''}
                          </span>
                          <span className={`truncate ${allOnThis ? 'text-[#50e6ff] font-semibold' : ''}`}>
                            {l.name}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  <div className={sepCls} />
                  <button
                    onClick={() => {
                      const name = window.prompt('Nome del nuovo livello:', `Livello ${layers.length + 1}`);
                      if (name && name.trim()) {
                        const newId = createLayer(name.trim());
                        assignMarkupsToLayer(selectedMarkupIds, newId);
                        onToast(`Creato livello "${name.trim()}" e spostata la selezione`);
                      }
                      onClose();
                    }}
                    className={rowCls}
                  >
                    <span className="text-[#6ee7b7] font-medium">+ Nuovo livello...</span>
                  </button>
                </div>
              )}
            </div>

            {/* Gruppo / Separa / Unisci livelli / Blocca / Nascondi */}
            {canGroup && (
              <button
                onClick={() => {
                  groupSelectedMarkups();
                  onClose();
                }}
                className={rowCls}
              >
                <span className="flex items-center gap-2.5">
                  <Group size={13} />
                  <span>Gruppo</span>
                </span>
                <span className="text-[11px] opacity-75">Ctrl+G</span>
              </button>
            )}
            {canUngroup && (
              <button
                onClick={() => {
                  ungroupSelectedMarkup();
                  onClose();
                }}
                className={rowCls}
              >
                <span className="flex items-center gap-2.5">
                  <Ungroup size={13} />
                  <span>Separa</span>
                </span>
                <span className="text-[11px] opacity-75">Ctrl+Maiusc+G</span>
              </button>
            )}
            <button
              onClick={async () => {
                const st = useAppStore.getState();
                const docId = st.activeDocumentId;
                if (!st.fileBytes || docId === 'home' || selectedList.length === 0) return;
                const ok = window.confirm(
                  `Vuoi unire i livelli per ${selectedList.length} elementi?\nI commenti selezionati verranno fusi nel PDF e non saranno più modificabili.`
                );
                if (!ok) return;
                try {
                  const flattenedBytes = await flattenMarkupsIntoPdfBytes(
                    st.fileBytes,
                    st.pagesInfo,
                    selectedList,
                    st.scaleCalibration
                  );
                  const { PDFManager } = await import('@/core/pdf/pdfManager');
                  await PDFManager.getInstance().loadDocument(flattenedBytes, docId);
                  const selIds = new Set(selectedList.map((m) => m.id));
                  const remaining = st.markups.filter((m) => !selIds.has(m.id));
                  st.applyFlattenedDocument(docId, flattenedBytes, remaining);
                  onToast(`Uniti ${selectedList.length} elementi nel PDF`);
                } catch (err) {
                  console.error('Errore unione livelli:', err);
                  alert('Errore durante l\'unione dei livelli.');
                }
                onClose();
              }}
              className={rowCls}
            >
              <span className="flex items-center gap-2.5">
                <Layers size={13} className="text-[#fbbf24]" />
                <span>Unisci livelli (Fissa nel PDF)</span>
              </span>
            </button>
            <button onClick={handleToggleLock} className={rowCls}>
              <span className="flex items-center gap-2.5">
                {allLocked ? <Unlock size={13} /> : <Lock size={13} />}
                <span>{allLocked ? 'Sblocca' : 'Blocca'}</span>
              </span>
              <span className="text-[11px] opacity-75">Ctrl+Maiusc+L</span>
            </button>
            <button onClick={handleDelete} className={rowCls}>
              <span className="flex items-center gap-2.5">
                <EyeOff size={13} />
                <span>Nascondi</span>
              </span>
            </button>

            <div className={sepCls} />

            <button onClick={handleOpenPopupNote} className={rowCls}>
              <span className="flex items-center gap-2.5">
                <Reply size={13} />
                <span>Rispondi</span>
              </span>
            </button>

            {/* Imposta stato */}
            <div
              className="relative"
              onMouseEnter={(e) => activateSub('status', e.currentTarget)}
              onMouseLeave={() => setOpenSub(null)}
            >
              <button className={rowCls}>
                <span className="flex items-center gap-2.5">
                  <CheckCircle2 size={13} />
                  <span>Imposta stato</span>
                </span>
                <ChevronRight size={13} />
              </button>
              {openSub === 'status' && (
                <div
                  style={getSubStyle(160, 170)}
                  className="bg-[#2a2a2d] border border-[#45454a] shadow-2xl rounded py-1"
                >
                  {(['Accepted', 'Rejected', 'Cancelled', 'Completed', 'None'] as const).map((st) => (
                    <button key={st} onClick={() => handleSetStatus(st)} className={rowCls}>
                      <span>{st}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={sepCls} />

            {/* Aggiungi a Tool Chest */}
            <div
              className="relative"
              onMouseEnter={(e) => activateSub('toolchest', e.currentTarget)}
              onMouseLeave={() => setOpenSub(null)}
            >
              <button className={rowCls}>
                <span className="flex items-center gap-2.5">
                  <Wrench size={13} />
                  <span>Aggiungi a Tool Chest</span>
                </span>
                <ChevronRight size={13} />
              </button>
              {openSub === 'toolchest' && (
                <div
                  style={getSubStyle(208, 256)}
                  className="bg-[#2a2a2d] border border-[#45454a] shadow-2xl rounded py-1 max-h-64 overflow-y-auto"
                >
                  <button
                    onClick={() => {
                      const saved = saveSelectedToToolChest('myTools');
                      if (saved) onToast(`Salvato in Strumenti personali`);
                      onClose();
                    }}
                    className={rowCls}
                  >
                    <span>Strumenti personali</span>
                  </button>
                  {toolSets.length > 0 && <div className={sepCls} />}
                  {toolSets.map((ts, idx) => (
                    <button
                      key={ts.id || idx}
                      onClick={() => {
                        const saved = saveSelectedToToolChest(idx);
                        if (saved) onToast(`Salvato in ${ts.title}`);
                        onClose();
                      }}
                      className={rowCls}
                    >
                      <span className="truncate">{ts.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                if (primaryMarkup) {
                  setActiveColor(primaryMarkup.strokeColor);
                  if (primaryMarkup.fillColor) setActiveFillColor(primaryMarkup.fillColor);
                  if (primaryMarkup.strokeWidth) setActiveStrokeWidth(primaryMarkup.strokeWidth);
                  onToast('Impostato come predefinito');
                }
                onClose();
              }}
              className={rowCls}
            >
              <span className="flex items-center gap-2.5">
                <Layers size={13} />
                <span>Imposta come predefinito</span>
              </span>
            </button>
            <button
              onClick={handleApplyToAllPages}
              disabled={numPages <= 1}
              className={numPages > 1 ? rowCls : disabledCls}
            >
              <span className="pl-5">Applica a tutte le pagine</span>
            </button>

            <div className={sepCls} />

            <button
              onClick={() => {
                setActiveRightPanel('properties');
                onClose();
              }}
              className={rowCls}
            >
              <span className="flex items-center gap-2.5">
                <Settings size={13} />
                <span>Proprietà</span>
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
