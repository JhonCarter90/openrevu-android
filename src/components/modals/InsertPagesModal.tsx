import React, { useRef, useState, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import {
  InsertPageSource,
  insertPagesFromSourcesInActiveDocument,
} from '@/core/pdf/pdfPageOperationsService';
import { PDFDocument } from 'pdf-lib';
import { X, ArrowUp, ArrowDown, Trash2, FilePlus2, FolderOpen } from 'lucide-react';

export const InsertPagesModal: React.FC = () => {
  const {
    isInsertPagesModalOpen,
    setInsertPagesModalOpen,
    fileName,
    numPages,
    currentPage,
    openDocuments,
    activeDocumentId,
  } = useAppStore();

  const [sources, setSources] = useState<InsertPageSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [useFileNameAsLabel, setUseFileNameAsLabel] = useState<boolean>(true);
  const [positionMode, setPositionMode] = useState<'after' | 'before'>('after');
  const [targetType, setTargetType] = useState<'first' | 'last' | 'specific'>('specific');
  const [specificPage, setSpecificPage] = useState<number>(currentPage || 1);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isInsertPagesModalOpen) {
      setSpecificPage(Math.max(1, Math.min(numPages || 1, currentPage || 1)));
      setSources([]);
      setSelectedSourceId(null);
      setIsBusy(false);
    }
  }, [isInsertPagesModalOpen, currentPage, numPages]);

  if (!isInsertPagesModalOpen) return null;

  const handleAddOpenFiles = () => {
    const others = openDocuments.filter((d) => d.id !== activeDocumentId && d.fileBytes);
    if (others.length === 0) {
      alert('Non ci sono altri documenti PDF aperti nelle schede.');
      return;
    }
    setSources((prev) => {
      const existingNames = new Set(prev.map((s) => s.id));
      const toAdd: InsertPageSource[] = others
        .filter((d) => !existingNames.has(`open_${d.id}`))
        .map((d) => ({
          id: `open_${d.id}`,
          fileName: d.fileName,
          filePath: d.nativeFilePath || '(Documento aperto)',
          bytes: d.fileBytes,
          numPages: d.numPages,
        }));
      return [...prev, ...toAdd];
    });
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const added: InsertPageSource[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const buf = await f.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        added.push({
          id: `disk_${crypto.randomUUID()}`,
          fileName: f.name,
          filePath: '(Da computer)',
          bytes,
          numPages: doc.getPageCount(),
        });
      } catch (err) {
        console.warn(`Impossibile leggere ${f.name}:`, err);
        alert(`Impossibile leggere il file PDF "${f.name}".`);
      }
    }
    if (added.length > 0) {
      setSources((prev) => [...prev, ...added]);
    }
    e.target.value = '';
  };

  const moveSelected = (dir: -1 | 1) => {
    if (!selectedSourceId) return;
    setSources((prev) => {
      const idx = prev.findIndex((s) => s.id === selectedSourceId);
      if (idx < 0) return prev;
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, item);
      return copy;
    });
  };

  const removeSelected = () => {
    if (!selectedSourceId) return;
    setSources((prev) => prev.filter((s) => s.id !== selectedSourceId));
    setSelectedSourceId(null);
  };

  const computeInsertIndex = (): number => {
    const total = Math.max(1, numPages);
    let refZeroBased = 0;
    if (targetType === 'first') {
      refZeroBased = 0;
    } else if (targetType === 'last') {
      refZeroBased = total - 1;
    } else {
      refZeroBased = Math.max(0, Math.min(total - 1, specificPage - 1));
    }
    return positionMode === 'before' ? refZeroBased : refZeroBased + 1;
  };

  const handleConfirm = async () => {
    if (sources.length === 0 || isBusy) return;
    setIsBusy(true);
    try {
      const insertAt = computeInsertIndex();
      await insertPagesFromSourcesInActiveDocument(sources, insertAt, {
        useFileNameAsLabel,
      });
      setInsertPagesModalOpen(false);
    } catch (err) {
      console.error('Errore inserimento pagine:', err);
      alert('Si è verificato un errore durante l\'inserimento delle pagine.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/65 flex items-center justify-center p-4 select-none">
      <div className="w-[540px] max-w-full bg-[#252526] border border-[#454545] rounded-lg shadow-2xl text-[#e0e0e0] text-xs overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#1e1e1e] border-b border-[#38383a]">
          <div className="flex items-center space-x-2 font-semibold text-white">
            <FilePlus2 size={15} className="text-[#0078d4]" />
            <span>Inserisci pagine</span>
          </div>
          <button
            onClick={() => setInsertPagesModalOpen(false)}
            className="p-1 text-[#aaa] hover:text-white hover:bg-[#333] rounded"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Sezione Inserisci file */}
          <div className="border border-[#3c3c3c] rounded p-3 bg-[#1e1e1e]/60 space-y-2.5">
            <div className="text-[11px] font-semibold text-[#bbb]">Inserisci file</div>

            <div className="flex space-x-2">
              {/* Controlli ordine a sinistra */}
              <div className="flex flex-col space-y-1">
                <button
                  type="button"
                  onClick={() => moveSelected(-1)}
                  disabled={!selectedSourceId}
                  className="p-1.5 bg-[#2d2d30] hover:bg-[#3e3e42] disabled:opacity-40 rounded border border-[#444]"
                  title="Sposta su"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => moveSelected(1)}
                  disabled={!selectedSourceId}
                  className="p-1.5 bg-[#2d2d30] hover:bg-[#3e3e42] disabled:opacity-40 rounded border border-[#444]"
                  title="Sposta giù"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={removeSelected}
                  disabled={!selectedSourceId}
                  className="p-1.5 bg-[#2d2d30] hover:bg-red-700/70 disabled:opacity-40 rounded border border-[#444]"
                  title="Rimuovi file dalla lista"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Tabella file */}
              <div className="flex-1 h-36 bg-[#181818] border border-[#3c3c3c] rounded overflow-y-auto">
                <div className="grid grid-cols-[1fr_110px_55px] px-2 py-1 bg-[#252526] border-b border-[#333] text-[10px] font-semibold text-[#999]">
                  <span>File</span>
                  <span>Origine</span>
                  <span className="text-right">Pagine</span>
                </div>
                {sources.length === 0 ? (
                  <div className="h-24 flex items-center justify-center text-[#666] italic text-[11px]">
                    Nessun file selezionato. Usa "Aggiungi file aperti" o "Aggiungi...".
                  </div>
                ) : (
                  sources.map((src) => {
                    const isSel = selectedSourceId === src.id;
                    return (
                      <div
                        key={src.id}
                        onClick={() => setSelectedSourceId(src.id)}
                        className={`grid grid-cols-[1fr_110px_55px] px-2 py-1.5 cursor-pointer border-b border-[#262626] text-[11px] ${
                          isSel ? 'bg-[#0078d4]/30 text-white' : 'hover:bg-[#2a2a2c]'
                        }`}
                      >
                        <span className="truncate pr-2" title={src.fileName}>
                          {src.fileName}
                        </span>
                        <span className="truncate text-[#999] text-[10px]">{src.filePath}</span>
                        <span className="text-right font-mono">{src.numPages}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleAddOpenFiles}
                className="px-3 py-1 bg-[#2d2d30] hover:bg-[#3e3e42] border border-[#4c4c4c] rounded text-white transition"
              >
                Aggiungi file aperti
              </button>
              <div className="flex items-center space-x-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={handleFilesSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center space-x-1.5 px-3 py-1 bg-[#0078d4] hover:bg-[#106ebe] rounded text-white font-medium transition"
                >
                  <FolderOpen size={13} />
                  <span>Aggiungi...</span>
                </button>
              </div>
            </div>
          </div>

          {/* Opzioni */}
          <div className="border border-[#3c3c3c] rounded p-3 bg-[#1e1e1e]/60 space-y-2">
            <div className="text-[11px] font-semibold text-[#bbb]">Opzioni</div>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useFileNameAsLabel}
                onChange={(e) => setUseFileNameAsLabel(e.target.checked)}
                className="accent-[#0078d4]"
              />
              <span>Usa nome file come etichetta pagina</span>
            </label>
          </div>

          {/* Posizione nel documento corrente */}
          <div className="border border-[#3c3c3c] rounded p-3 bg-[#1e1e1e]/60 space-y-2.5">
            <div className="text-[11px] font-semibold text-[#bbb] truncate" title={fileName}>
              In &apos;{fileName}&apos;
            </div>

            <select
              value={positionMode}
              onChange={(e) => setPositionMode(e.target.value as 'after' | 'before')}
              className="w-40 bg-[#181818] border border-[#444] rounded px-2 py-1 text-white focus:outline-none"
            >
              <option value="after">Dopo</option>
              <option value="before">Prima</option>
            </select>

            <div className="space-y-1.5 pt-1">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="insertTarget"
                  checked={targetType === 'first'}
                  onChange={() => setTargetType('first')}
                  className="accent-[#0078d4]"
                />
                <span>Prima pagina</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="insertTarget"
                  checked={targetType === 'last'}
                  onChange={() => setTargetType('last')}
                  className="accent-[#0078d4]"
                />
                <span>Ultima pagina</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="insertTarget"
                  checked={targetType === 'specific'}
                  onChange={() => setTargetType('specific')}
                  className="accent-[#0078d4]"
                />
                <span>Pagina:</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, numPages)}
                  value={specificPage}
                  onFocus={() => setTargetType('specific')}
                  onChange={(e) =>
                    setSpecificPage(Math.max(1, Math.min(numPages || 1, Number(e.target.value) || 1)))
                  }
                  className="w-16 bg-[#181818] border border-[#444] rounded px-1.5 py-0.5 text-white font-mono text-center"
                />
                <span className="text-[#999]">di {numPages}</span>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 px-4 py-2.5 bg-[#1e1e1e] border-t border-[#38383a]">
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={sources.length === 0 || isBusy}
            className="px-4 py-1.5 bg-[#0078d4] hover:bg-[#106ebe] disabled:bg-[#333] disabled:text-[#666] text-white rounded font-medium transition"
          >
            {isBusy ? 'Inserimento...' : 'OK'}
          </button>
          <button
            type="button"
            onClick={() => setInsertPagesModalOpen(false)}
            className="px-4 py-1.5 bg-[#2d2d30] hover:bg-[#3e3e42] text-white rounded border border-[#444] transition"
          >
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
};
