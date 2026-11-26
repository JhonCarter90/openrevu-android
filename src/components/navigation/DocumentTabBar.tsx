import React, { useRef, useState } from 'react';
import { useAppStore, OpenDocumentItem } from '@/store/useAppStore';
import { BluebeamIcon } from '@/components/icons/BluebeamIcon';
import { PDFManager } from '@/core/pdf/pdfManager';
import { PDFAnnotationSerializer } from '@/core/serialization/pdfAnnotationSerializer';
import { Plus, X, FileText } from 'lucide-react';

export const DocumentTabBar: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingCloseDoc, setPendingCloseDoc] = useState<OpenDocumentItem | null>(null);
  const [isSavingClose, setIsSavingClose] = useState(false);
  const {
    openDocuments,
    activeDocumentId,
    switchDocument,
    closeDocument,
    markDocumentSaved,
    openMultipleDocuments,
    setSecondaryFromOpenDoc,
  } = useAppStore();

  const handleRequestCloseDoc = (doc: OpenDocumentItem) => {
    if (doc.isDirty) {
      setPendingCloseDoc(doc);
    } else {
      closeDocument(doc.id);
    }
  };

  const handleSaveAndClose = async () => {
    if (!pendingCloseDoc) return;
    setIsSavingClose(true);
    try {
      const curState = useAppStore.getState();
      const docMarkups =
        curState.activeDocumentId === pendingCloseDoc.id
          ? curState.markups
          : pendingCloseDoc.markups;
      const bookmarksToSave = pendingCloseDoc.bookmarksDirty
        ? pendingCloseDoc.bookmarks
        : undefined;
      const exportedBytes = await PDFAnnotationSerializer.exportMarkupsToPDF(
        pendingCloseDoc.fileBytes,
        docMarkups,
        bookmarksToSave
      );
      const suggestedName = pendingCloseDoc.fileName.replace(/\.pdf$/i, '') + '_annotato.pdf';
      if (typeof (window as any).showSaveFilePicker === 'function') {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName,
            types: [{ description: 'Documento PDF con Annotazioni', accept: { 'application/pdf': ['.pdf'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(exportedBytes);
          await writable.close();
          markDocumentSaved(pendingCloseDoc.id);
          closeDocument(pendingCloseDoc.id);
          setPendingCloseDoc(null);
          return;
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
        }
      }
      const blob = new Blob([exportedBytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      markDocumentSaved(pendingCloseDoc.id);
      closeDocument(pendingCloseDoc.id);
      setPendingCloseDoc(null);
    } catch (err) {
      console.error('Errore salvataggio in chiusura:', err);
      alert('Errore durante il salvataggio del PDF.');
    } finally {
      setIsSavingClose(false);
    }
  };

  const handleOpenFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const pdfManager = PDFManager.getInstance();
    const loadedDocs: { id: string; fileName: string; bytes: Uint8Array; numPages: number; pagesInfo: any[]; markups: any[] }[] = [];

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
        console.error(`Errore caricamento file [${file.name}]:`, err);
        alert(`Impossibile aprire il file PDF [${file.name}]:\n${err?.message || 'Formato non supportato o protetto da password.'}`);
      }
    }

    if (loadedDocs.length > 0) {
      openMultipleDocuments(loadedDocs);
    }

    // Reset input
    e.target.value = '';
  };

  return (
    <div className="h-8 bg-[#141415] border-b border-white/[0.08] flex items-center px-2 text-[12px] select-none overflow-x-auto">
      {/* Hidden input per aprire più file contemporaneamente */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleOpenFiles}
        accept="application/pdf"
        multiple
        className="hidden"
      />

      {/* Tab HOME (Dashboard) */}
      <button
        type="button"
        onClick={() => switchDocument('home')}
        className={`h-7 px-3 flex items-center gap-1.5 rounded-t-md border-t-2 transition-colors text-[12px] font-medium cursor-pointer ${
          activeDocumentId === 'home'
            ? 'bg-[#19191b] border-[#2563eb] text-[#ededed]'
            : 'border-transparent text-[#85858b] hover:text-[#ededed] hover:bg-[#19191b]/60'
        }`}
        title="Schermata iniziale"
      >
        <BluebeamIcon name="home" size={13} className={activeDocumentId === 'home' ? 'text-[#3b82f6]' : 'text-[#85858b]'} />
        <span>Home</span>
      </button>

      <div className="h-4 w-px bg-white/[0.08] mx-1.5" />

      {/* Schede dei Documenti Aperti */}
      <div className="flex items-center gap-1 overflow-x-auto flex-1">
        {openDocuments.map((doc) => {
          const isActive = activeDocumentId === doc.id;
          return (
            <div
              key={doc.id}
              onClick={() => switchDocument(doc.id)}
              className={`group h-7 px-2.5 flex items-center gap-2 rounded-t-md border-t-2 cursor-pointer transition-colors text-[12px] max-w-[220px] ${
                isActive
                  ? 'bg-[#19191b] border-[#2563eb] text-[#ededed] font-medium'
                  : 'border-transparent text-[#85858b] hover:text-[#ededed] hover:bg-[#19191b]/60'
              }`}
              title={doc.fileName}
            >
              <FileText size={13} strokeWidth={1.5} className={isActive ? 'text-[#3b82f6] shrink-0' : 'text-[#85858b] shrink-0'} />
              <span className="truncate flex-1">
                {doc.fileName}
                {doc.isDirty ? ' *' : ''}
              </span>

              {doc.numPages > 1 && (
                <span className="text-[11px] text-[#85858b] font-mono tabular-nums shrink-0">
                  {doc.numPages}p
                </span>
              )}

              {openDocuments.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSecondaryFromOpenDoc(doc.id);
                  }}
                  className="opacity-60 group-hover:opacity-100 hover:bg-[#232325] text-[#85858b] hover:text-[#ededed] rounded p-0.5 transition-colors cursor-pointer"
                  title="Visualizza a destra in vista divisa (Ctrl+2)"
                >
                  <BluebeamIcon name="split_vertical" size={11} />
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRequestCloseDoc(doc);
                }}
                className="opacity-40 group-hover:opacity-100 hover:bg-[#232325] text-[#85858b] hover:text-[#ededed] rounded p-0.5 transition-colors cursor-pointer"
                title="Chiudi documento"
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </div>
          );
        })}

        {/* Pulsante + per aprire uno o più file */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="h-6 w-6 ml-1 flex items-center justify-center rounded hover:bg-[#333333] text-[#888888] hover:text-white transition"
          title="Apri uno o più file PDF dal computer (Selezione multipla)"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Modale conferma salvataggio alla chiusura di un documento modificato */}
      {pendingCloseDoc && (
        <div
          className="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-4"
          onClick={() => !isSavingClose && setPendingCloseDoc(null)}
        >
          <div
            className="bg-[#252526] border border-[#3e3e42] rounded-md shadow-2xl max-w-md w-full p-4 space-y-3 text-[#e0e0e0]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-white">Modifiche non salvate</h3>
            <p className="text-xs text-[#cccccc] leading-relaxed">
              Il documento <span className="font-semibold text-[#50e6ff]">{pendingCloseDoc.fileName}</span>{' '}
              contiene modifiche non salvate. Vuoi salvarle prima di chiudere?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                disabled={isSavingClose}
                onClick={() => setPendingCloseDoc(null)}
                className="px-3 py-1.5 rounded bg-[#333337] hover:bg-[#3e3e42] text-xs text-[#dddddd]"
              >
                Annulla
              </button>
              <button
                disabled={isSavingClose}
                onClick={() => {
                  const id = pendingCloseDoc.id;
                  setPendingCloseDoc(null);
                  closeDocument(id);
                }}
                className="px-3 py-1.5 rounded bg-[#5a2222] hover:bg-[#752a2a] text-xs text-white"
              >
                Chiudi senza salvare
              </button>
              <button
                disabled={isSavingClose}
                onClick={handleSaveAndClose}
                className="px-3 py-1.5 rounded bg-[#0078d4] hover:bg-[#106ebe] text-xs font-semibold text-white"
              >
                {isSavingClose ? 'Salvataggio...' : 'Salva e chiudi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
