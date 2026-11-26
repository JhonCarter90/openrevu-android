import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { PDFAnnotationSerializer } from '@/core/serialization/pdfAnnotationSerializer';
import { triggerFlattenActiveDocument } from '@/core/pdf/pdfFlattenService';
import { openPdfFilesWithPicker, saveActiveDocument } from '@/core/storage/pdfFileService';
import {
  deletePagesFromActiveDocument,
  insertBlankPageInActiveDocument,
  renamePageLabelInActiveDocument,
  rotatePagesInActiveDocument,
} from '@/core/pdf/pdfPageOperationsService';
import { BluebeamIcon } from '@/components/icons/BluebeamIcon';
import { triggerImageImportToPdf } from '@/core/utils/imageImport';
import { 
  File, 
  FolderOpen, 
  Save, 
  Download, 
  Undo, 
  Redo, 
  Scissors, 
  Copy, 
  Trash2, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Split, 
  Columns, 
  Rows, 
  Magnet, 
  Layers,
  Wrench,
  Sliders,
  Table,
  Check
} from 'lucide-react';

export const BluebeamMenuBar: React.FC = () => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    fileName,
    fileBytes,
    markups,
    selectedMarkupIds,
    deleteMarkup,
    selectMarkup,
    undo,
    redo,
    undoStack,
    redoStack,
    splitMode,
    setSplitMode,
    syncSplitViews,
    setSyncSplitViews,
    viewport,
    setViewport,
    resetViewport,
    snapEnabled,
    setSnapEnabled,
    mouseWheelMode,
    toggleMouseWheelMode,
    activeLeftPanel,
    setActiveLeftPanel,
    activeRightPanel,
    setActiveRightPanel,
    setActiveTool,
    openMultipleDocuments,
    switchDocument,
    numPages,
    currentPage,
    setCurrentPage,
  } = useAppStore();

  // Chiudi menu al clic esterno
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExportPDF = async (saveAs: boolean = false) => {
    if (!fileBytes) {
      alert('Nessun documento PDF aperto da salvare.');
      return;
    }

    try {
      await saveActiveDocument({ saveAs });
    } catch (err) {
      console.error('Errore esportazione PDF:', err);
      alert('Si è verificato un errore durante il salvataggio del PDF.');
    }
  };

  const handleOpenFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const { PDFManager } = await import('@/core/pdf/pdfManager');
    const pdfManager = PDFManager.getInstance();
    const loadedDocs: any[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const buffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(buffer);
        const docId = crypto.randomUUID();
        const { numPages, pagesInfo, existingMarkups } = await pdfManager.loadDocument(uint8, docId);
        loadedDocs.push({
          id: docId,
          fileName: file.name,
          bytes: uint8,
          numPages,
          pagesInfo,
          markups: existingMarkups,
        });
      } catch (err: any) {
        console.error(`Errore caricamento [${file.name}]:`, err);
        alert(`Impossibile aprire il file PDF [${file.name}]:\n${err?.message || 'Formato non supportato o protetto da password.'}`);
      }
    }

    if (loadedDocs.length > 0) {
      openMultipleDocuments(loadedDocs);
    }
    e.target.value = '';
    setOpenMenu(null);
  };

  const menuClass =
    'px-2.5 py-1 text-[#cccccc] hover:bg-[#0078d4] hover:text-white rounded cursor-pointer transition select-none text-[11px]';
  const dropdownClass =
    'absolute top-full left-0 mt-0.5 w-64 bg-[#252526] border border-[#3e3e42] shadow-2xl rounded py-1 z-50 text-[11px] text-[#cccccc] animate-in fade-in-50 duration-75';
  const itemClass =
    'flex items-center justify-between px-3 py-1.5 hover:bg-[#0078d4] hover:text-white cursor-pointer transition';
  const shortcutClass = 'text-[10px] text-[#888888] group-hover:text-white/80 font-mono ml-3';

  return (
    <div ref={menuBarRef} className="h-6 bg-[#181818] border-b border-[#2d2d30] flex items-center px-1 text-xs relative select-none">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleOpenFiles}
        accept="application/pdf"
        multiple
        className="hidden"
      />

      {/* MENU FILE */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
          className={`${menuClass} ${openMenu === 'file' ? 'bg-[#0078d4] text-white' : ''}`}
        >
          File
        </button>
        {openMenu === 'file' && (
          <div className={dropdownClass}>
            <div
              className={itemClass}
              onClick={() => {
                switchDocument('home');
                setOpenMenu(null);
              }}
            >
              <span>Nuovo Documento / Formati CAD</span>
              <span className={shortcutClass}>Ctrl+N</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                setOpenMenu(null);
                void openPdfFilesWithPicker(() => fileInputRef.current?.click());
              }}
            >
              <span>Apri PDF dal computer...</span>
              <span className={shortcutClass}>Ctrl+O</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={`${itemClass} ${!fileBytes ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                const st = useAppStore.getState();
                if (st.activeDocumentId !== 'home') st.closeDocument(st.activeDocumentId);
                setOpenMenu(null);
              }}
            >
              <span>Chiudi</span>
              <span className={shortcutClass}>Ctrl+F4</span>
            </div>
            <div
              className={`${itemClass} ${!fileBytes ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                useAppStore.getState().closeAllDocuments();
                setOpenMenu(null);
              }}
            >
              <span>Chiudi tutto</span>
              <span className={shortcutClass}>Ctrl+Shift+W</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={itemClass}
              onClick={() => {
                void handleExportPDF(false);
                setOpenMenu(null);
              }}
            >
              <span className="font-semibold text-white">Salva</span>
              <span className={shortcutClass}>Ctrl+S</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                void handleExportPDF(true);
                setOpenMenu(null);
              }}
            >
              <span>Salva con nome...</span>
              <span className={shortcutClass}>Ctrl+Shift+S</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={`${itemClass} ${!fileBytes ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                setOpenMenu(null);
                window.print();
              }}
            >
              <span>Stampa...</span>
              <span className={shortcutClass}>Ctrl+P</span>
            </div>
          </div>
        )}
      </div>

      {/* MENU MODIFICA */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}
          className={`${menuClass} ${openMenu === 'edit' ? 'bg-[#0078d4] text-white' : ''}`}
        >
          Modifica
        </button>
        {openMenu === 'edit' && (
          <div className={dropdownClass}>
            <div
              className={`${itemClass} ${undoStack.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                undo();
                setOpenMenu(null);
              }}
            >
              <span>Annulla</span>
              <span className={shortcutClass}>Ctrl+Z</span>
            </div>
            <div
              className={`${itemClass} ${redoStack.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                redo();
                setOpenMenu(null);
              }}
            >
              <span>Ripristina</span>
              <span className={shortcutClass}>Ctrl+Y</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={`${itemClass} ${selectedMarkupIds.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                useAppStore.getState().cutSelectedMarkups();
                setOpenMenu(null);
              }}
            >
              <span>Taglia</span>
              <span className={shortcutClass}>Ctrl+X</span>
            </div>
            <div
              className={`${itemClass} ${selectedMarkupIds.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                useAppStore.getState().copySelectedMarkups();
                setOpenMenu(null);
              }}
            >
              <span>Copia</span>
              <span className={shortcutClass}>Ctrl+C</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                useAppStore.getState().pasteMarkups({ inPlace: false });
                setOpenMenu(null);
              }}
            >
              <span>Incolla</span>
              <span className={shortcutClass}>Ctrl+V</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                useAppStore.getState().pasteMarkups({ inPlace: true });
                setOpenMenu(null);
              }}
            >
              <span>Incolla sul posto</span>
              <span className={shortcutClass}>Ctrl+Shift+V</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={`${itemClass} ${selectedMarkupIds.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                selectedMarkupIds.forEach((id) => deleteMarkup(id));
                setOpenMenu(null);
              }}
            >
              <span>Elimina Marcatura Selezionata</span>
              <span className={shortcutClass}>Canc</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                const st = useAppStore.getState();
                const pageIds = st.markups
                  .filter((m) => (m.pageIndex ?? 0) === st.currentPage - 1)
                  .map((m) => m.id);
                st.selectMultipleMarkups(pageIds);
                setOpenMenu(null);
              }}
            >
              <span>Seleziona tutto (pagina)</span>
              <span className={shortcutClass}>Ctrl+A</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                selectMarkup(null);
                setOpenMenu(null);
              }}
            >
              <span>Deseleziona Tutto</span>
              <span className={shortcutClass}>Esc</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={itemClass}
              onClick={() => {
                setActiveTool('pan');
                setOpenMenu(null);
              }}
            >
              <span>Panoramica (Mano)</span>
              <span className={shortcutClass}>H</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                setActiveTool('select');
                setOpenMenu(null);
              }}
            >
              <span>Seleziona</span>
              <span className={shortcutClass}>V</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                setActiveTool('snapshot');
                setOpenMenu(null);
              }}
            >
              <span>Istantanea</span>
              <span className={shortcutClass}>G</span>
            </div>
          </div>
        )}
      </div>

      {/* MENU VISUALIZZA */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
          className={`${menuClass} ${openMenu === 'view' ? 'bg-[#0078d4] text-white' : ''}`}
        >
          Visualizza
        </button>
        {openMenu === 'view' && (
          <div className={dropdownClass}>
            <div
              className={itemClass}
              onClick={() => {
                setSplitMode(splitMode === 'vertical' ? 'none' : 'vertical');
                setOpenMenu(null);
              }}
            >
              <span>Dividi Schermo Verticale</span>
              <span className={shortcutClass}>Ctrl+2</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                setSplitMode(splitMode === 'horizontal' ? 'none' : 'horizontal');
                setOpenMenu(null);
              }}
            >
              <span>Dividi Schermo Orizzontale</span>
              <span className={shortcutClass}>Ctrl+H</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                setSyncSplitViews(!syncSplitViews);
                setOpenMenu(null);
              }}
            >
              <span>Sincronizza Viste (Pan/Zoom)</span>
              {syncSplitViews && <Check size={12} className="text-[#00ff66]" />}
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={itemClass}
              onClick={() => {
                setViewport({ zoom: Math.min(24.0, viewport.zoom * 1.25) });
                setOpenMenu(null);
              }}
            >
              <span>Ingrandisci (Zoom In)</span>
              <span className={shortcutClass}>Ctrl++</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                setViewport({ zoom: Math.max(0.15, viewport.zoom * 0.8) });
                setOpenMenu(null);
              }}
            >
              <span>Riduci (Zoom Out)</span>
              <span className={shortcutClass}>Ctrl+-</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                resetViewport();
                setOpenMenu(null);
              }}
            >
              <span>Adatta Pagina Intera</span>
              <span className={shortcutClass}>Ctrl+0</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={itemClass}
              onClick={() => {
                setSnapEnabled(!snapEnabled);
                setOpenMenu(null);
              }}
            >
              <span>Snap Magnetico CAD a Oggetti</span>
              {snapEnabled && <Check size={12} className="text-[#00ff66]" />}
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={itemClass}
              onClick={() => {
                toggleMouseWheelMode();
                setOpenMenu(null);
              }}
            >
              <span>Rotellina Mouse: {mouseWheelMode === 'zoom' ? 'Zoom (Standard Bluebeam)' : 'Scorrimento Pagine'}</span>
              <span className="text-[10px] text-[#00b7c3] font-mono">{mouseWheelMode === 'zoom' ? 'ZOOM' : 'SCORRI'}</span>
            </div>
          </div>
        )}
      </div>

      {/* MENU DOCUMENTO */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === 'doc' ? null : 'doc')}
          className={`${menuClass} ${openMenu === 'doc' ? 'bg-[#0078d4] text-white' : ''}`}
        >
          Documento
        </button>
        {openMenu === 'doc' && (
          <div className={dropdownClass}>
            <div
              className={`${itemClass} ${!fileBytes ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                setOpenMenu(null);
                const st = useAppStore.getState();
                const p = st.pagesInfo[st.currentPage - 1];
                const dims = p
                  ? `${((p.width / 72) * 2.54).toFixed(2)} × ${((p.height / 72) * 2.54).toFixed(2)} cm (${Math.round(p.width)} × ${Math.round(p.height)} pt)`
                  : 'N/D';
                alert(
                  `Proprietà documento\n\nFile: ${st.fileName}\nPagine: ${st.numPages}\nDimensioni Pagina ${st.currentPage}: ${dims}\nRotazione nativa: ${p?.rotation ?? 0}°\nMarcature totali: ${st.markups.length}`
                );
              }}
            >
              <span>Proprietà documento</span>
              <span className={shortcutClass}>Ctrl+D</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={`${itemClass} ${!fileBytes ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                setOpenMenu(null);
                useAppStore.getState().setInsertPagesModalOpen(true);
              }}
            >
              <span className="font-semibold text-white">Inserisci pagine...</span>
              <span className={shortcutClass}>Ctrl+Shift+I</span>
            </div>
            <div
              className={`${itemClass} ${!fileBytes ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                setOpenMenu(null);
                void insertBlankPageInActiveDocument(Math.max(0, currentPage - 1), 'after');
              }}
            >
              <span>Inserisci pagina vuota</span>
              <span className={shortcutClass}>Ctrl+Shift+N</span>
            </div>
            <div
              className={`${itemClass} ${!fileBytes || numPages <= 1 ? 'opacity-40 pointer-events-none' : 'text-red-300'}`}
              onClick={() => {
                setOpenMenu(null);
                if (window.confirm(`Eliminare la pagina ${currentPage}?`)) {
                  void deletePagesFromActiveDocument([Math.max(0, currentPage - 1)]);
                }
              }}
            >
              <span>Elimina pagina corrente</span>
              <span className={shortcutClass}>Canc</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={`${itemClass} ${!fileBytes ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                setOpenMenu(null);
                void rotatePagesInActiveDocument([Math.max(0, currentPage - 1)], 90);
              }}
            >
              <span>Ruota Pagina 90° (Orario)</span>
              <span className={shortcutClass}>Ctrl+Shift+R</span>
            </div>
            <div
              className={`${itemClass} ${!fileBytes ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                setOpenMenu(null);
                void rotatePagesInActiveDocument([Math.max(0, currentPage - 1)], -90);
              }}
            >
              <span>Ruota Pagina 90° (Antiorario)</span>
            </div>
            <div
              className={`${itemClass} ${!fileBytes ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                setOpenMenu(null);
                const st = useAppStore.getState();
                const idx = Math.max(0, currentPage - 1);
                const next = window.prompt(
                  `Etichetta per Pagina ${currentPage}:`,
                  st.pagesInfo[idx]?.label || ''
                );
                if (next !== null) void renamePageLabelInActiveDocument(idx, next);
              }}
            >
              <span>Rinomina etichetta pagina...</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={`${itemClass} ${markups.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                setOpenMenu(null);
                void triggerFlattenActiveDocument();
              }}
            >
              <span className="flex items-center gap-2">
                <BluebeamIcon name="flatten" size={14} /> Unisci livelli (Rendi fissi i commenti)...
              </span>
              <span className={shortcutClass}>Ctrl+Maiusc+M</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={`${itemClass} ${currentPage <= 1 ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                setCurrentPage(Math.max(1, currentPage - 1));
                setOpenMenu(null);
              }}
            >
              <span>Pagina Precedente</span>
              <span className={shortcutClass}>PgUp</span>
            </div>
            <div
              className={`${itemClass} ${currentPage >= numPages ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                setCurrentPage(Math.min(numPages, currentPage + 1));
                setOpenMenu(null);
              }}
            >
              <span>Pagina Successiva</span>
              <span className={shortcutClass}>PgDn</span>
            </div>
          </div>
        )}
      </div>

      {/* MENU STRUMENTI */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === 'tools' ? null : 'tools')}
          className={`${menuClass} ${openMenu === 'tools' ? 'bg-[#0078d4] text-white' : ''}`}
        >
          Strumenti
        </button>
        {openMenu === 'tools' && (
          <div className={dropdownClass}>
            <div className="px-3 py-1 text-[9px] uppercase font-bold text-[#888]">Marcature & Forme</div>
            <div className={itemClass} onClick={() => { setActiveTool('select'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="select" size={14} /> Seleziona</span>
              <span className={shortcutClass}>V</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('pan'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="pan" size={14} /> Panoramica</span>
              <span className={shortcutClass}>H</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('textbox'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="textbox" size={14} /> Casella di testo</span>
              <span className={shortcutClass}>T</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('callout'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="callout" size={14} /> Fumetto</span>
              <span className={shortcutClass}>Q</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('pen'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="pen" size={14} /> Penna</span>
              <span className={shortcutClass}>P</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('highlighter'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="highlighter" size={14} /> Evidenziatore</span>
              <span className={shortcutClass}>H</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div className={itemClass} onClick={() => { setActiveTool('line'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="line" size={14} /> Linea</span>
              <span className={shortcutClass}>L</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('arrow'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="arrow" size={14} /> Freccia</span>
              <span className={shortcutClass}>A</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('polyline'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="polyline" size={14} /> Polilinea</span>
              <span className={shortcutClass}>Maiusc+N</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('connector'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="connector" size={14} /> Connettore ortogonale</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('rectangle'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="rectangle" size={14} /> Rettangolo</span>
              <span className={shortcutClass}>R</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('ellipse'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="ellipse" size={14} /> Ellisse</span>
              <span className={shortcutClass}>E</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('polygon'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="polygon" size={14} /> Poligono</span>
              <span className={shortcutClass}>Maiusc+P</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('cloud_rect'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="cloud_rect" size={14} /> Nuvola</span>
              <span className={shortcutClass}>C</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('cloud_plus'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="cloud_plus" size={14} /> Nuvola+</span>
              <span className={shortcutClass}>K</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div className={itemClass} onClick={() => { setOpenMenu(null); triggerImageImportToPdf(); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="image" size={14} /> Immagine...</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('stamp'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="stamp" size={14} /> Timbro</span>
              <span className={shortcutClass}>S</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('snapshot'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="snapshot" size={14} /> Istantanea</span>
              <span className={shortcutClass}>G</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('hyperlink'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2 text-[#4cc2ff] font-medium">🔗 Collegamento ipertestuale</span>
              <span className={shortcutClass}>Maiusc+H</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('erase_content'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="erase_content" size={14} /> Cancella contenuto</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div className="px-3 py-1 text-[9px] uppercase font-bold text-[#888]">Misure & Computo</div>
            <div className={itemClass} onClick={() => { setActiveTool('measure_length'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="measure_length" size={14} /> Dimensione</span>
              <span className={shortcutClass}>M</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('measure_polyline'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="measure_polyline" size={14} /> Polilinea misura</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('measure_area'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="measure_area" size={14} /> Area poligonale</span>
              <span className={shortcutClass}>Maiusc+Alt+A</span>
            </div>
            <div className={itemClass} onClick={() => { setActiveTool('calibrate'); setOpenMenu(null); }}>
              <span className="flex items-center gap-2"><BluebeamIcon name="calibrate" size={14} /> Calibra Scala Disegno</span>
            </div>
          </div>
        )}
      </div>

      {/* MENU FINESTRA */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === 'window' ? null : 'window')}
          className={`${menuClass} ${openMenu === 'window' ? 'bg-[#0078d4] text-white' : ''}`}
        >
          Finestra
        </button>
        {openMenu === 'window' && (
          <div className={dropdownClass}>
            <div
              className={itemClass}
              onClick={() => {
                setActiveLeftPanel('thumbnails');
                setOpenMenu(null);
              }}
            >
              <span>Pannello Miniature</span>
              <span className={shortcutClass}>Alt+T</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                setActiveLeftPanel('bookmarks');
                setOpenMenu(null);
              }}
            >
              <span>Pannello Segnalibri</span>
              <span className={shortcutClass}>Alt+B</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                setActiveLeftPanel('layers');
                setOpenMenu(null);
              }}
            >
              <span>Pannello Livelli (Layer)</span>
              <span className={shortcutClass}>Alt+Y</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                setActiveLeftPanel('toolchest');
                setOpenMenu(null);
              }}
            >
              <span>Tool Chest (Librerie Simboli)</span>
              <span className={shortcutClass}>Alt+X</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                setActiveLeftPanel('measurements');
                setOpenMenu(null);
              }}
            >
              <span>Pannello Misure & Computo</span>
              <span className={shortcutClass}>Alt+U</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={itemClass}
              onClick={() => {
                setActiveRightPanel(activeRightPanel === 'none' ? 'properties' : 'none');
                setOpenMenu(null);
              }}
            >
              <span>Pannello Proprietà</span>
              <span className={shortcutClass}>Alt+P</span>
            </div>
            <div className="h-px bg-[#3e3e42] my-1" />
            <div
              className={itemClass}
              onClick={() => {
                if (document.fullscreenElement) {
                  void document.exitFullscreen().catch(() => {});
                } else {
                  void document.documentElement.requestFullscreen?.().catch(() => {});
                }
                setOpenMenu(null);
              }}
            >
              <span>Schermo intero</span>
              <span className={shortcutClass}>F11</span>
            </div>
            <div
              className={itemClass}
              onClick={() => {
                setActiveLeftPanel('none' as any);
                setActiveRightPanel('none');
                setOpenMenu(null);
              }}
            >
              <span>Nascondi pannelli</span>
              <span className={shortcutClass}>Maiusc+F4</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Tag Versione e Compatibilità Bluebeam */}
      <div className="text-[10px] text-[#777] font-mono pr-2">
        OpenRevu <span className="text-[#0078d4] font-semibold">CAD Pro</span> • Revu 21 UI
      </div>
    </div>
  );
};
