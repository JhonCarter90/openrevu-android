import React, { useRef, useEffect, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { PDFManager } from '@/core/pdf/pdfManager';
import { openPdfFilesWithPicker, saveActiveDocument } from '@/core/storage/pdfFileService';
import { rotatePagesInActiveDocument } from '@/core/pdf/pdfPageOperationsService';
import { studioLiveService, StudioLiveState } from '@/core/storage/studioLiveService';
import { FileUp, Download, Undo2, Redo2, User, Check, Save, RotateCcw, RotateCw, FilePlus2, Users, FileText } from 'lucide-react';

export const TopHeader: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [studioState, setStudioState] = useState<StudioLiveState>(() => studioLiveService.getState());

  useEffect(() => {
    return studioLiveService.subscribe(setStudioState);
  }, []);

  const {
    fileName,
    fileBytes,
    activeDocumentId,
    openDocuments,
    currentUser,
    setCurrentUser,
    markups,
    undoStack,
    redoStack,
    openMultipleDocuments,
    splitActivePane,
    resetSplitPanes,
    currentPage,
    setInsertPagesModalOpen,
  } = useAppStore();

  const activeDoc = openDocuments.find((d) => d.id === activeDocumentId);
  const isActiveReadOnly = Boolean(activeDoc?.isReadOnly);

  const handleExportPDF = async (saveAs: boolean = false) => {
    if (!fileBytes) {
      alert('Nessun file PDF aperto da salvare.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await saveActiveDocument({ saveAs });
      if (res.saved) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (err) {
      console.error('Errore salvataggio PDF annotato:', err);
      alert('Errore durante il salvataggio del PDF con annotazioni.');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const isTextInputFocused = (el: HTMLElement | null) => {
      if (!el) return false;
      if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
      if (el.tagName === 'INPUT') {
        const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
        return ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(type);
      }
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inTextInput = isTextInputFocused(target);

      // Cerca testo nel documento (Ctrl+F) stile Bluebeam Revu
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        const st = useAppStore.getState();
        if (st.activeDocumentId !== 'home') {
          if (st.activeLeftPanel !== 'search') {
            st.setActiveLeftPanel('search');
          }
        }
        return;
      }

      // Salva / Salva con nome (Ctrl+S / Ctrl+Shift+S)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (fileBytes) {
          void handleExportPDF(e.shiftKey);
        }
        return;
      }

      // Undo / Redo globale (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) - funziona anche dopo aver usato slider/color picker
      if (!inTextInput && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          useAppStore.getState().redo();
        } else {
          useAppStore.getState().undo();
        }
        return;
      }
      if (!inTextInput && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useAppStore.getState().redo();
        return;
      }

      // Taglia (Ctrl+X), Copia (Ctrl+C) e Incolla sul posto (Ctrl+Shift+V) per i markup selezionati
      if (!inTextInput && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'x') {
        const st = useAppStore.getState();
        if (st.selectedMarkupIds.length > 0) {
          e.preventDefault();
          st.cutSelectedMarkups();
        }
        return;
      }
      if (!inTextInput && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c') {
        const hasTextSel = Boolean(window.getSelection()?.toString());
        const st = useAppStore.getState();
        if (!hasTextSel && st.activeTool !== 'select_text' && st.selectedMarkupIds.length > 0) {
          e.preventDefault();
          st.copySelectedMarkups();
        }
        return;
      }
      if (!inTextInput && (e.ctrlKey || e.metaKey) && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'v') {
        const st = useAppStore.getState();
        if (st.clipboardMarkups.length > 0) {
          e.preventDefault();
          st.pasteMarkups({ inPlace: true });
        }
        return;
      }

      // Inserisci pagine (Ctrl+Shift+I)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        if (fileBytes) {
          setInsertPagesModalOpen(true);
        }
        return;
      }

      if (inTextInput) return;

      // Collegamento ipertestuale (Shift+H) stile Bluebeam Revu
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        useAppStore.getState().setActiveTool('hyperlink');
        return;
      }

      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === '2') {
        e.preventDefault();
        splitActivePane('vertical');
      } else if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        splitActivePane('horizontal');
      } else if (e.ctrlKey && e.shiftKey && e.key === '2') {
        e.preventDefault();
        resetSplitPanes();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [splitActivePane, resetSplitPanes, fileBytes, markups, fileName]);

  const handleOpenFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const pdfManager = PDFManager.getInstance();
    const loadedDocs: {
      id: string;
      fileName: string;
      bytes: Uint8Array;
      numPages: number;
      pagesInfo: any[];
      markups: any[];
    }[] = [];

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
        alert(
          `Impossibile aprire il file PDF [${file.name}]:\n${
            err?.message || 'Formato non supportato o protetto da password.'
          }`
        );
      }
    }

    if (loadedDocs.length > 0) {
      openMultipleDocuments(loadedDocs);
    }

    e.target.value = '';
  };

  return (
    <header className="h-10 bg-[#0f0f10] border-b border-white/[0.08] flex items-center justify-between px-3 text-[12px] select-none">
      {/* Brand & File Operations */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-2 text-[#ededed]">
          <div className="w-6 h-6 bg-[#2563eb] rounded-md flex items-center justify-center text-white text-[12px] font-semibold">
            R
          </div>
          <span className="text-[14px] font-medium">OpenRevu</span>
          <span className="text-[11px] bg-[#19191b] border border-white/[0.08] text-[#a1a1a6] px-1.5 py-0.5 rounded font-mono">
            CAD Rev 3
          </span>
        </div>

        <div className="h-4 w-px bg-white/[0.08] mx-1" />

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleOpenFile}
          accept="application/pdf"
          multiple
          className="hidden"
        />

        <button
          type="button"
          onClick={() => void openPdfFilesWithPicker(() => fileInputRef.current?.click())}
          className="flex items-center gap-1.5 px-2.5 h-7 bg-[#19191b] hover:bg-[#232325] border border-white/[0.08] text-[#ededed] rounded-md transition-colors cursor-pointer"
          title="Apri uno o più PDF tecnici"
        >
          <FileUp size={14} strokeWidth={1.5} className="text-[#a1a1a6]" />
          <span>Apri PDF</span>
        </button>

        <button
          type="button"
          onClick={() => void handleExportPDF(false)}
          disabled={!fileBytes || isSaving || isActiveReadOnly}
          className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md font-medium transition-colors cursor-pointer ${
            saveSuccess
              ? 'bg-[#4cc38a]/20 border border-[#4cc38a]/40 text-[#4cc38a]'
              : 'bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#19191b] disabled:border disabled:border-white/[0.08] disabled:text-[#85858b] disabled:cursor-not-allowed text-white'
          }`}
          title={
            isActiveReadOnly
              ? 'File aperto in sola lettura: usa Salva con nome'
              : 'Salva sovrascrivendo il PDF aperto (Ctrl+S)'
          }
        >
          {saveSuccess ? <Check size={14} strokeWidth={1.5} /> : <Save size={14} strokeWidth={1.5} />}
          <span>{isSaving ? 'Salvataggio' : saveSuccess ? 'Salvato' : 'Salva'}</span>
          {!isSaving && !saveSuccess && (
            <kbd className="kbd-keycap !bg-black/25 !border-white/20 !text-white/80 ml-0.5">Ctrl+S</kbd>
          )}
        </button>

        <button
          type="button"
          onClick={() => void handleExportPDF(true)}
          disabled={!fileBytes || isSaving}
          className="flex items-center gap-1.5 px-2.5 h-7 bg-[#19191b] hover:bg-[#232325] border border-white/[0.08] disabled:opacity-40 text-[#ededed] rounded-md transition-colors cursor-pointer"
          title="Salva una nuova copia del PDF con nome diverso (Ctrl+Shift+S)"
        >
          <Download size={14} strokeWidth={1.5} className="text-[#a1a1a6]" />
          <span>Salva con nome</span>
        </button>

        <div className="h-4 w-px bg-white/[0.08] mx-0.5" />

        <button
          type="button"
          onClick={() => useAppStore.getState().undo()}
          disabled={undoStack.length === 0}
          className="w-7 h-7 flex items-center justify-center text-[#ededed] hover:bg-[#232325] disabled:text-[#55555b] disabled:hover:bg-transparent disabled:cursor-not-allowed rounded-md cursor-pointer transition-colors"
          title="Annulla (Ctrl+Z)"
        >
          <Undo2 size={15} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={() => useAppStore.getState().redo()}
          disabled={redoStack.length === 0}
          className="w-7 h-7 flex items-center justify-center text-[#ededed] hover:bg-[#232325] disabled:text-[#55555b] disabled:hover:bg-transparent disabled:cursor-not-allowed rounded-md cursor-pointer transition-colors"
          title="Ripeti (Ctrl+Y)"
        >
          <Redo2 size={15} strokeWidth={1.5} />
        </button>

        <div className="h-4 w-px bg-white/[0.08] mx-0.5" />

        {/* Comandi rapidi pagine */}
        <button
          type="button"
          onClick={() => void rotatePagesInActiveDocument([Math.max(0, currentPage - 1)], -90)}
          disabled={!fileBytes}
          className="w-7 h-7 flex items-center justify-center text-[#a1a1a6] hover:text-[#ededed] hover:bg-[#232325] disabled:text-[#55555b] disabled:hover:bg-transparent rounded-md cursor-pointer transition-colors"
          title="Ruota pagina corrente di 90° in senso antiorario"
        >
          <RotateCcw size={15} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={() => void rotatePagesInActiveDocument([Math.max(0, currentPage - 1)], 90)}
          disabled={!fileBytes}
          className="w-7 h-7 flex items-center justify-center text-[#a1a1a6] hover:text-[#ededed] hover:bg-[#232325] disabled:text-[#55555b] disabled:hover:bg-transparent rounded-md cursor-pointer transition-colors"
          title="Ruota pagina corrente di 90° in senso orario"
        >
          <RotateCw size={15} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={() => setInsertPagesModalOpen(true)}
          disabled={!fileBytes}
          className="w-7 h-7 flex items-center justify-center text-[#a1a1a6] hover:text-[#ededed] hover:bg-[#232325] disabled:text-[#55555b] disabled:hover:bg-transparent rounded-md cursor-pointer transition-colors"
          title="Inserisci pagine (Ctrl+Shift+I)"
        >
          <FilePlus2 size={15} strokeWidth={1.5} />
        </button>

        {fileName && (
          <div className="flex items-center gap-1.5 pl-1 min-w-0">
            <FileText size={14} strokeWidth={1.5} className="text-[#85858b] shrink-0" />
            <span className="text-[#a1a1a6] truncate max-w-[280px]" title={fileName}>
              {fileName}
            </span>
            {isActiveReadOnly && (
              <span
                className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[10px] font-medium shrink-0"
                title="File aperto da un altro programma o protetto: salva le modifiche con Salva con nome"
              >
                Sola lettura
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right: Studio Live + Author */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void studioLiveService.toggleForActiveDocument()}
          className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md border text-[12px] font-medium transition-colors cursor-pointer ${
            studioState.active
              ? 'bg-[#4cc38a]/15 border-[#4cc38a]/40 text-[#4cc38a]'
              : 'bg-[#19191b] hover:bg-[#232325] border-white/[0.08] text-[#a1a1a6] hover:text-[#ededed]'
          }`}
          title={
            studioState.active
              ? `Studio Live attivo su: ${studioState.nativeFilePath}\nColleghi connessi: ${
                  studioState.peers.filter((p) => p.isOnline).map((p) => p.author).join(', ') || 'solo tu'
                }`
              : 'Avvia Studio Live su cartella condivisa di rete'
          }
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              studioState.active ? 'bg-[#4cc38a]' : 'bg-[#85858b]'
            }`}
          />
          <Users size={14} strokeWidth={1.5} />
          <span className="tabular-nums">
            {studioState.active
              ? `Studio Live (${studioState.peers.filter((p) => p.isOnline).length + 1})`
              : 'Studio Live'}
          </span>
        </button>

        <div className="flex items-center gap-1.5 bg-[#19191b] px-2.5 h-7 rounded-md border border-white/[0.08]">
          <User size={14} strokeWidth={1.5} className="text-[#85858b]" />
          <span className="text-[#85858b]">Autore</span>
          <input
            type="text"
            value={currentUser}
            onChange={(e) => setCurrentUser(e.target.value)}
            className="bg-transparent text-[#ededed] font-medium text-[12px] focus:outline-none w-28"
            placeholder="Nome autore"
            title="Nome autore scritto nei metadati PDF (/T)"
          />
        </div>
      </div>
    </header>
  );
};
