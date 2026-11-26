import React, { useState, useRef } from 'react';
import { useAppStore, RecentDocumentItem } from '@/store/useAppStore';
import { PDFManager } from '@/core/pdf/pdfManager';
import { BlankPdfGenerator, PageFormat, PageOrientation } from '@/core/pdf/blankPdfGenerator';
import { SamplePdfGenerator } from '@/core/pdf/samplePdfGenerator';
import { loadRecentFileData } from '@/core/storage/recentFilesDb';
import { openPdfFilesWithPicker } from '@/core/storage/pdfFileService';
import {
  FileUp,
  FilePlus,
  Clock,
  Trash2,
  FileText,
  Check,
  ChevronRight,
  FolderOpen,
} from 'lucide-react';

export const HomePage: React.FC = () => {
  const multiFileInputRef = useRef<HTMLInputElement>(null);

  const {
    recentDocuments,
    openDocuments,
    switchDocument,
    removeRecentDocument,
    openDocument,
    openMultipleDocuments,
    currentUser,
  } = useAppStore();

  const [selectedFormat, setSelectedFormat] = useState<PageFormat>('A3');
  const [orientation, setOrientation] = useState<PageOrientation>('landscape');
  const [pageCount, setPageCount] = useState<number>(1);
  const [docTitle, setDocTitle] = useState<string>('SCHEMA TECNICO GENERALE');
  const [includeBorder, setIncludeBorder] = useState<boolean>(true);
  const [includeTitleBlock, setIncludeTitleBlock] = useState<boolean>(true);
  const [gridStyle, setGridStyle] = useState<'none' | 'cad_grid'>('cad_grid');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const handleOpenFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      } catch (err) {
        console.error(`Errore caricamento [${file.name}]:`, err);
      }
    }

    if (loadedDocs.length > 0) {
      openMultipleDocuments(loadedDocs);
    }

    e.target.value = '';
  };

  const handleCreateNewDocument = async () => {
    setIsGenerating(true);
    try {
      const bytes = await BlankPdfGenerator.createBlankDocument({
        format: selectedFormat,
        orientation,
        pageCount,
        title: docTitle,
        author: currentUser,
        includeBorder,
        includeTitleBlock,
        gridStyle,
      });

      const pdfManager = PDFManager.getInstance();
      const fileName = `Nuovo_${selectedFormat}_${orientation === 'landscape' ? 'Orizz' : 'Vert'}.pdf`;
      const docId = crypto.randomUUID();
      const { numPages, pagesInfo } = await pdfManager.loadDocument(bytes, docId);

      openDocument(fileName, bytes, numPages, pagesInfo, [], docId);
    } catch (err) {
      console.error('Errore creazione nuovo PDF:', err);
      alert('Errore durante la creazione del documento.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleBrowseFiles = async () => {
    await openPdfFilesWithPicker(() => multiFileInputRef.current?.click());
  };

  const handleOpenRecent = async (recent: RecentDocumentItem) => {
    if (recent.isSample) {
      try {
        const bytes = await SamplePdfGenerator.generateSampleDrawing();
        const pdfManager = PDFManager.getInstance();
        const docId = crypto.randomUUID();
        const { numPages, pagesInfo } = await pdfManager.loadDocument(bytes, docId);
        openDocument(recent.fileName, bytes, numPages, pagesInfo, [], docId);
      } catch (e) {
        console.error('Errore apertura sample:', e);
      }
      return;
    }

    const alreadyOpen = openDocuments.find((d) => d.fileName === recent.fileName);
    if (alreadyOpen) {
      switchDocument(alreadyOpen.id);
      return;
    }

    try {
      const stored = await loadRecentFileData(recent.fileName);
      if (stored?.bytes && stored.bytes.byteLength > 0) {
        const pdfManager = PDFManager.getInstance();
        const docId = crypto.randomUUID();
        const { numPages, pagesInfo, existingMarkups } = await pdfManager.loadDocument(stored.bytes, docId);
        openDocument(recent.fileName, stored.bytes, numPages, pagesInfo, existingMarkups, docId);
        return;
      }
    } catch (err) {
      console.error('Errore riapertura documento recente:', err);
    }

    void handleBrowseFiles();
  };

  // Calcolo proporzioni reali della tavola per l'anteprima tecnica live
  const selectedDim = BlankPdfGenerator.FORMAT_DIMENSIONS_MM[selectedFormat];
  const sheetW = orientation === 'landscape' ? Math.max(selectedDim.width, selectedDim.height) : Math.min(selectedDim.width, selectedDim.height);
  const sheetH = orientation === 'landscape' ? Math.min(selectedDim.width, selectedDim.height) : Math.max(selectedDim.width, selectedDim.height);
  const aspectRatio = sheetW / sheetH;
  const previewMaxW = 200;
  const previewMaxH = 116;
  const previewW = aspectRatio >= previewMaxW / previewMaxH ? previewMaxW : Math.round(previewMaxH * aspectRatio);
  const previewH = aspectRatio >= previewMaxW / previewMaxH ? Math.round(previewMaxW / aspectRatio) : previewMaxH;

  return (
    <div className="flex-1 h-full w-full bg-[#141415] overflow-y-auto text-[#ededed] p-6 select-none font-sans">
      <input
        type="file"
        ref={multiFileInputRef}
        onChange={handleOpenFiles}
        accept="application/pdf"
        multiple
        className="hidden"
      />

      <div className="max-w-[1280px] mx-auto space-y-6">
        {/* Intestazione essenziale di contesto */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-white/[0.08]">
          <div className="space-y-1">
            <h1 className="text-2xl font-medium text-[#ededed] tracking-[-0.01em]">
              Archivio e nuove tavole
            </h1>
            <p className="text-[13px] text-[#a1a1a6]">
              Revisione disegni PDF ISO 32000 con markup vettoriali compatibili Bluebeam Revu
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleBrowseFiles()}
              className="h-9 px-4 bg-[#ededed] hover:bg-white text-[#141415] rounded-lg font-medium text-[13px] transition-colors flex items-center gap-2 cursor-pointer"
            >
              <FileUp size={16} strokeWidth={1.5} />
              <span>Apri PDF</span>
            </button>
          </div>
        </div>

        {/* Griglia asimmetrica 5 / 7 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Colonna sinistra: Documenti recenti */}
          <section className="lg:col-span-5 bg-[#19191b] border border-white/[0.08] rounded-xl p-5 flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Clock size={16} strokeWidth={1.5} className="text-[#85858b]" />
                <h2 className="text-[14px] font-medium text-[#ededed]">Documenti recenti</h2>
              </div>
              <span className="text-[12px] text-[#85858b] font-mono tabular-nums">
                {recentDocuments.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto mt-3 space-y-1.5 max-h-[440px] pr-1">
              {recentDocuments.length === 0 ? (
                <div className="py-12 text-center text-[#85858b] text-[13px]">
                  <FolderOpen size={24} strokeWidth={1.5} className="mx-auto mb-3 text-[#85858b]" />
                  <p className="text-[#a1a1a6]">Nessun documento in cronologia</p>
                  <p className="text-[12px] mt-1 text-[#85858b]">
                    Apri uno o più file PDF dal disco o dalla rete
                  </p>
                </div>
              ) : (
                recentDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => handleOpenRecent(doc)}
                    className="group bg-[#19191b] hover:bg-[#232325] border border-transparent hover:border-white/[0.08] rounded-lg px-3 py-2 flex items-center justify-between cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-md bg-[#141415] border border-white/[0.08] flex items-center justify-center shrink-0 text-[#85858b] group-hover:text-[#ededed] transition-colors">
                        <FileText size={16} strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-[#ededed] truncate" title={doc.fileName}>
                          {doc.fileName}
                        </div>
                        <div className="text-[12px] text-[#85858b] flex items-center gap-2 mt-0.5 font-mono tabular-nums">
                          <span className="text-[#a1a1a6]">{doc.format || 'A3'}</span>
                          <span>·</span>
                          <span>{doc.numPages} {doc.numPages === 1 ? 'pag' : 'pag'}</span>
                          <span>·</span>
                          <span>{new Date(doc.lastOpened).toLocaleDateString('it-IT')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecentDocument(doc.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-[#85858b] hover:text-[#e5484d] rounded-md transition-colors cursor-pointer"
                        title="Rimuovi dalla cronologia"
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                      <ChevronRight size={15} strokeWidth={1.5} className="text-[#85858b] group-hover:text-[#ededed] transition-colors" />
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 mt-4 border-t border-white/[0.08] flex justify-between items-center text-[12px] text-[#85858b]">
              <span>Selezione multipla supportata</span>
              <button
                type="button"
                onClick={() => void handleBrowseFiles()}
                className="text-[#ededed] hover:text-[#3b82f6] transition-colors cursor-pointer"
              >
                Sfoglia cartelle
              </button>
            </div>
          </section>

          {/* Colonna destra: Nuova tavola tecnica con anteprima CAD dal vivo */}
          <section className="lg:col-span-7 bg-[#19191b] border border-white/[0.08] rounded-xl p-5 flex flex-col space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <FilePlus size={16} strokeWidth={1.5} className="text-[#85858b]" />
                <h2 className="text-[14px] font-medium text-[#ededed]">Nuova tavola tecnica</h2>
              </div>
              <span className="text-[12px] text-[#85858b] font-mono tabular-nums">
                {sheetW} × {sheetH} mm
              </span>
            </div>

            {/* Momento visivo: anteprima reale della tavola CAD sul tappetino tecnico */}
            <div className="bg-[#0f0f10] border border-white/[0.08] rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center justify-center w-full sm:w-[224px] h-[132px] shrink-0">
                <svg
                  width={previewW}
                  height={previewH}
                  viewBox={`0 0 ${previewW} ${previewH}`}
                  className="rounded-[2px] shadow-[0_6px_20px_rgba(0,0,0,0.45)]"
                  aria-label={`Anteprima tavola ${selectedFormat}`}
                >
                  <rect x="0" y="0" width={previewW} height={previewH} fill="#f7f7f5" />
                  {gridStyle === 'cad_grid' && (
                    <g stroke="#d4dae2" strokeWidth="0.6">
                      {Array.from({ length: Math.floor(previewW / 12) }).map((_, i) => (
                        <line key={`vx-${i}`} x1={(i + 1) * 12} y1={0} x2={(i + 1) * 12} y2={previewH} />
                      ))}
                      {Array.from({ length: Math.floor(previewH / 12) }).map((_, i) => (
                        <line key={`hy-${i}`} x1={0} y1={(i + 1) * 12} x2={previewW} y2={(i + 1) * 12} />
                      ))}
                    </g>
                  )}
                  {includeBorder && (
                    <rect
                      x="6"
                      y="6"
                      width={previewW - 12}
                      height={previewH - 12}
                      fill="none"
                      stroke="#1f2937"
                      strokeWidth="1.2"
                    />
                  )}
                  {includeTitleBlock && (
                    <g>
                      <rect
                        x={previewW - Math.min(82, previewW * 0.45) - 6}
                        y={previewH - 26}
                        width={Math.min(82, previewW * 0.45)}
                        height={20}
                        fill="#ffffff"
                        stroke="#1f2937"
                        strokeWidth="1"
                      />
                      <line
                        x1={previewW - Math.min(82, previewW * 0.45) - 6}
                        y1={previewH - 15}
                        x2={previewW - 6}
                        y2={previewH - 15}
                        stroke="#1f2937"
                        strokeWidth="0.7"
                      />
                      <text
                        x={previewW - Math.min(82, previewW * 0.45) - 2}
                        y={previewH - 18}
                        fill="#111827"
                        fontSize="5.5"
                        fontFamily="monospace"
                        fontWeight="600"
                      >
                        {(docTitle || 'TAVOLA').slice(0, 16)}
                      </text>
                      <text
                        x={previewW - Math.min(82, previewW * 0.45) - 2}
                        y={previewH - 9}
                        fill="#2563eb"
                        fontSize="5"
                        fontFamily="monospace"
                      >
                        {selectedFormat} · {pageCount}P
                      </text>
                    </g>
                  )}
                </svg>
              </div>

              <div className="flex-1 w-full space-y-2 text-[12px]">
                <div className="flex items-center justify-between py-1 border-b border-white/[0.06]">
                  <span className="text-[#85858b]">Formato</span>
                  <span className="font-mono tabular-nums text-[#ededed]">{selectedFormat} ({orientation === 'landscape' ? 'Orizzontale' : 'Verticale'})</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-white/[0.06]">
                  <span className="text-[#85858b]">Dimensioni</span>
                  <span className="font-mono tabular-nums text-[#ededed]">{sheetW} × {sheetH} mm</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-white/[0.06]">
                  <span className="text-[#85858b]">Pagine</span>
                  <span className="font-mono tabular-nums text-[#ededed]">{pageCount}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-[#85858b]">Autore</span>
                  <span className="text-[#a1a1a6] truncate max-w-[160px]">{currentUser}</span>
                </div>
              </div>
            </div>

            {/* Formati ISO / UNI / ANSI */}
            <div className="space-y-2">
              <label className="block text-[12px] font-medium text-[#a1a1a6]">
                Formato tavola
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(['A4', 'A3', 'A2', 'A1', 'A0', 'Letter', 'Tabloid', 'ArchD'] as PageFormat[]).map((fmt) => {
                  const isSel = selectedFormat === fmt;
                  const dim = BlankPdfGenerator.FORMAT_DIMENSIONS_MM[fmt];
                  return (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setSelectedFormat(fmt)}
                      className={`p-2 rounded-lg border text-left transition-colors flex flex-col justify-between cursor-pointer ${
                        isSel
                          ? 'bg-[#232325] border-[#2563eb] text-[#ededed]'
                          : 'bg-[#141415] border-white/[0.08] text-[#a1a1a6] hover:bg-[#232325] hover:text-[#ededed]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-[13px]">{fmt}</span>
                        {isSel && <Check size={14} strokeWidth={1.75} className="text-[#3b82f6]" />}
                      </div>
                      <span className="text-[11px] text-[#85858b] mt-1 font-mono tabular-nums">
                        {dim.width}×{dim.height}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Orientamento e numero pagine */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-[12px] font-medium text-[#a1a1a6]">
                  Orientamento
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOrientation('landscape')}
                    className={`h-9 px-3 rounded-lg border text-[12px] font-medium transition-colors cursor-pointer ${
                      orientation === 'landscape'
                        ? 'bg-[#232325] border-[#2563eb] text-[#ededed]'
                        : 'bg-[#141415] border-white/[0.08] text-[#a1a1a6] hover:bg-[#232325]'
                    }`}
                  >
                    Orizzontale
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrientation('portrait')}
                    className={`h-9 px-3 rounded-lg border text-[12px] font-medium transition-colors cursor-pointer ${
                      orientation === 'portrait'
                        ? 'bg-[#232325] border-[#2563eb] text-[#ededed]'
                        : 'bg-[#141415] border-white/[0.08] text-[#a1a1a6] hover:bg-[#232325]'
                    }`}
                  >
                    Verticale
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[12px] font-medium text-[#a1a1a6]">
                  Numero pagine
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 5].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setPageCount(cnt)}
                      className={`h-9 rounded-lg border text-[12px] font-mono tabular-nums transition-colors cursor-pointer ${
                        pageCount === cnt
                          ? 'bg-[#232325] border-[#2563eb] text-[#ededed] font-medium'
                          : 'bg-[#141415] border-white/[0.08] text-[#a1a1a6] hover:bg-[#232325]'
                      }`}
                    >
                      {cnt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Titolo cartiglio */}
            <div className="space-y-2">
              <label className="block text-[12px] font-medium text-[#a1a1a6]">
                Titolo cartiglio
              </label>
              <input
                type="text"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="Schema P&ID impianto"
                className="w-full h-9 bg-[#141415] border border-white/[0.08] rounded-lg px-3 text-[13px] text-[#ededed] placeholder:text-[#85858b] focus:outline-none focus:border-[#2563eb]"
              />
            </div>

            {/* Opzioni tavola */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px] text-[#a1a1a6]">
              <label className="flex items-center gap-2 bg-[#141415] px-3 h-9 rounded-lg border border-white/[0.08] cursor-pointer hover:border-white/[0.14] transition-colors">
                <input
                  type="checkbox"
                  checked={includeBorder}
                  onChange={(e) => setIncludeBorder(e.target.checked)}
                  className="accent-[#2563eb]"
                />
                <span>Squadratura UNI/ISO</span>
              </label>

              <label className="flex items-center gap-2 bg-[#141415] px-3 h-9 rounded-lg border border-white/[0.08] cursor-pointer hover:border-white/[0.14] transition-colors">
                <input
                  type="checkbox"
                  checked={includeTitleBlock}
                  onChange={(e) => setIncludeTitleBlock(e.target.checked)}
                  className="accent-[#2563eb]"
                />
                <span>Cartiglio tecnico</span>
              </label>

              <label className="flex items-center gap-2 bg-[#141415] px-3 h-9 rounded-lg border border-white/[0.08] cursor-pointer hover:border-white/[0.14] transition-colors">
                <input
                  type="checkbox"
                  checked={gridStyle === 'cad_grid'}
                  onChange={(e) => setGridStyle(e.target.checked ? 'cad_grid' : 'none')}
                  className="accent-[#2563eb]"
                />
                <span>Griglia CAD 50pt</span>
              </label>
            </div>

            {/* Azione di creazione */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleCreateNewDocument}
                disabled={isGenerating}
                className="w-full h-10 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#232325] disabled:text-[#85858b] text-white rounded-lg font-medium text-[13px] transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <FilePlus size={16} strokeWidth={1.5} />
                <span>
                  {isGenerating
                    ? 'Generazione tavola in corso'
                    : `Crea tavola ${selectedFormat} ${orientation === 'landscape' ? 'orizzontale' : 'verticale'}`}
                </span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
