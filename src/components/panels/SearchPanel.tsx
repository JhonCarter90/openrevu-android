import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import {
  searchDocuments,
  SearchProgress,
  SearchResultItem,
} from '@/core/pdf/pdfSearchService';
import {
  Search,
  X,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  ScanText,
  MessageSquare,
  Loader2,
} from 'lucide-react';

export const SearchPanel: React.FC = () => {
  const {
    openDocuments,
    activeDocumentId,
    markups,
    searchResults,
    activeSearchResultId,
    setSearchResults,
    focusSearchResult,
    clearSearchResults,
  } = useAppStore();

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'current' | 'all_open'>('current');
  const [searchPages, setSearchPages] = useState(true);
  const [searchMarkups, setSearchMarkups] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useOcrOnScanned, setUseOcrOnScanned] = useState(false);

  const [optionsOpen, setOptionsOpen] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleRunSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      clearSearchResults();
      setHasSearched(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Assicura che il documento attivo abbia i markup aggiornati dallo store
    const syncedDocs = openDocuments.map((d) =>
      d.id === activeDocumentId ? { ...d, markups } : d
    );
    const targetDocs =
      scope === 'all_open'
        ? syncedDocs
        : syncedDocs.filter((d) => d.id === activeDocumentId);

    if (targetDocs.length === 0) {
      setSearchResults([]);
      setHasSearched(true);
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setOcrError(null);
    setProgress({
      currentDocName: targetDocs[0].fileName,
      processedPages: 0,
      totalPages: targetDocs.reduce((acc, d) => acc + Math.max(1, d.numPages), 0),
      matchesFound: 0,
    });

    try {
      const found = await searchDocuments(
        targetDocs,
        {
          query: trimmed,
          scope,
          searchPages,
          searchMarkups,
          caseSensitive,
          wholeWord,
          useOcrOnScanned,
        },
        (p) => {
          setProgress(p);
          if (p.ocrError) setOcrError(p.ocrError);
        },
        controller.signal
      );

      if (!controller.signal.aborted) {
        setSearchResults(found);
        if (found.length > 0) {
          focusSearchResult(found[0]);
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  };

  const handleCancelSearch = () => {
    abortRef.current?.abort();
    setIsSearching(false);
  };

  const handleClear = () => {
    handleCancelSearch();
    setQuery('');
    clearSearchResults();
    setHasSearched(false);
    setProgress(null);
    inputRef.current?.focus();
  };

  const navigateMatch = (dir: -1 | 1) => {
    if (searchResults.length === 0) return;
    const curIdx = searchResults.findIndex((r) => r.id === activeSearchResultId);
    const nextIdx =
      curIdx < 0
        ? 0
        : (curIdx + dir + searchResults.length) % searchResults.length;
    focusSearchResult(searchResults[nextIdx]);
  };

  const renderHighlightedSnippet = (snippet: string, matchText: string) => {
    if (!matchText) return snippet;
    const idx = caseSensitive
      ? snippet.indexOf(matchText)
      : snippet.toLowerCase().indexOf(matchText.toLowerCase());
    if (idx < 0) return snippet;
    return (
      <>
        {snippet.slice(0, idx)}
        <span className="bg-[#f5b942]/30 text-[#ffd97d] font-semibold px-0.5 rounded-xs">
          {snippet.slice(idx, idx + matchText.length)}
        </span>
        {snippet.slice(idx + matchText.length)}
      </>
    );
  };

  const pct =
    progress && progress.totalPages > 0
      ? Math.min(100, Math.round((progress.processedPages / progress.totalPages) * 100))
      : 0;

  return (
    <div className="flex flex-col h-full bg-[#202022] text-xs select-none text-[#e0e0e0]">
      {/* Intestazione Cerca */}
      <div className="h-9 px-3 bg-[#1e1e1e] border-b border-[#333333] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2 font-bold text-white">
          <Search size={14} className="text-[#4cc2ff]" />
          <span className="text-[12px]">Cerca</span>
        </div>
        {searchResults.length > 0 && (
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={() => navigateMatch(-1)}
              className="p-0.5 hover:bg-[#333] rounded text-[#bbb] hover:text-white"
              title="Risultato precedente"
            >
              <ChevronUp size={13} />
            </button>
            <button
              type="button"
              onClick={() => navigateMatch(1)}
              className="p-0.5 hover:bg-[#333] rounded text-[#bbb] hover:text-white"
              title="Risultato successivo"
            >
              <ChevronDown size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Campo ricerca + ambito */}
      <div className="p-2.5 space-y-2 border-b border-[#303034] shrink-0">
        <div className="flex items-center space-x-1.5">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleRunSearch();
                } else if (e.key === 'Escape') {
                  handleClear();
                }
              }}
              placeholder="Cerca testo (es. flange, V-101)..."
              className="w-full bg-[#181818] border border-[#444] focus:border-[#0078d4] rounded px-2 py-1 pr-6 text-white text-[11.5px] focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#888] hover:text-white"
                title="Pulisci"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {isSearching ? (
            <button
              type="button"
              onClick={handleCancelSearch}
              className="px-2.5 py-1 bg-red-700/80 hover:bg-red-600 text-white rounded text-[11px] font-medium shrink-0 cursor-pointer"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleRunSearch()}
              disabled={!query.trim()}
              className="px-2.5 py-1 bg-[#0078d4] hover:bg-[#106ebe] disabled:bg-[#333] disabled:text-[#666] text-white rounded text-[11px] font-medium shrink-0 cursor-pointer"
            >
              Cerca
            </button>
          )}
        </div>

        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as 'current' | 'all_open')}
          className="w-full bg-[#181818] border border-[#444] rounded px-2 py-1 text-[11px] text-white focus:outline-none"
        >
          <option value="current">Documento corrente</option>
          <option value="all_open">
            Tutti i documenti aperti ({openDocuments.length})
          </option>
        </select>

        {/* Barra di avanzamento */}
        {isSearching && progress && (
          <div className="space-y-1 pt-0.5">
            <div className="flex items-center justify-between text-[10px] text-[#aaa]">
              <span className="flex items-center space-x-1 truncate">
                <Loader2 size={11} className="animate-spin text-[#4cc2ff] shrink-0" />
                <span className="truncate">
                  {progress.ocrRunning
                    ? `OCR pagina ${progress.processedPages + 1}...`
                    : `Pagina ${progress.processedPages}/${progress.totalPages}`}
                </span>
              </span>
              <span className="font-mono text-[#4cc2ff] shrink-0 ml-1">
                {progress.matchesFound} trovati
              </span>
            </div>
            <div className="w-full h-1.5 bg-[#181818] rounded overflow-hidden">
              <div
                className="h-full bg-[#0078d4] transition-all duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Sezione Opzioni stile Bluebeam */}
      <div className="border-b border-[#303034] shrink-0">
        <button
          type="button"
          onClick={() => setOptionsOpen((v) => !v)}
          className="w-full flex items-center space-x-1.5 px-2.5 py-1.5 hover:bg-[#2a2a2d] text-[11.5px] font-semibold text-[#ccc]"
        >
          {optionsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>Opzioni</span>
        </button>

        {optionsOpen && (
          <div className="px-3 pb-2.5 space-y-1.5 text-[11px] text-[#ccc]">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={searchPages}
                onChange={(e) => setSearchPages(e.target.checked)}
                className="accent-[#0078d4]"
              />
              <span>Cerca nelle pagine</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={searchMarkups}
                onChange={(e) => setSearchMarkups(e.target.checked)}
                className="accent-[#0078d4]"
              />
              <span>Cerca nelle marcature</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="accent-[#0078d4]"
              />
              <span>Maiuscole/minuscole</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={(e) => setWholeWord(e.target.checked)}
                className="accent-[#0078d4]"
              />
              <span>Solo parole intere</span>
            </label>
            <label
              className="flex items-center space-x-2 cursor-pointer pt-0.5 text-[#9cdcfe]"
              title="Avvia il riconoscimento OCR solo sulle pagine scansionate prive di testo nativo"
            >
              <input
                type="checkbox"
                checked={useOcrOnScanned}
                onChange={(e) => setUseOcrOnScanned(e.target.checked)}
                className="accent-[#0078d4]"
              />
              <span className="flex items-center space-x-1">
                <ScanText size={12} />
                <span>OCR su pagine scansionate</span>
              </span>
            </label>
          </div>
        )}
      </div>

      {/* Sezione Risultati */}
      <div className="flex-1 flex flex-col min-h-0">
        <button
          type="button"
          onClick={() => setResultsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-[#2a2a2d] text-[11.5px] font-semibold text-[#ccc] shrink-0"
        >
          <span className="flex items-center space-x-1.5">
            {resultsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span>Risultati</span>
          </span>
          <span className="text-[10px] font-mono text-[#4cc2ff]">
            {searchResults.length}
          </span>
        </button>

        {resultsOpen && (
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
            {ocrError && (
              <div className="p-2 rounded bg-amber-950/50 border border-amber-600/50 text-amber-300 text-[10.5px] break-words">
                Avviso OCR: {ocrError}
              </div>
            )}
            {!hasSearched ? (
              <div className="p-3 text-center text-[#777] text-[11px] italic">
                Inserisci un termine e premi Invio o Cerca (Ctrl+F).
              </div>
            ) : !isSearching && searchResults.length === 0 ? (
              <div className="p-3 text-center text-[#888] text-[11px]">
                Nessun risultato trovato per &ldquo;{query}&rdquo;.
                {ocrError && (
                  <div className="mt-1.5 text-[10px] text-amber-400 break-words">
                    Errore OCR: {ocrError}
                  </div>
                )}
                {!useOcrOnScanned && (
                  <div className="mt-1.5 text-[10px] text-[#9cdcfe]">
                    Se il PDF è una scansione o contiene testo in immagini/CAD, attiva &ldquo;OCR su pagine scansionate&rdquo;.
                  </div>
                )}
              </div>
            ) : (
              searchResults.map((item: SearchResultItem) => {
                const isSelected = activeSearchResultId === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => focusSearchResult(item)}
                    className={`p-2 rounded cursor-pointer border transition ${
                      isSelected
                        ? 'bg-[#0078d4]/25 border-[#0078d4] text-white'
                        : 'bg-[#1a1a1c] border-[#2e2e32] hover:bg-[#28282c] hover:border-[#444] text-[#d0d0d0]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-[#999] mb-0.5 gap-1">
                      <span className="flex items-center space-x-1 truncate">
                        {item.source === 'markup' ? (
                          <MessageSquare size={10} className="text-[#f5b942] shrink-0" />
                        ) : item.source === 'ocr' ? (
                          <ScanText size={10} className="text-[#4cc2ff] shrink-0" />
                        ) : (
                          <FileText size={10} className="text-[#888] shrink-0" />
                        )}
                        {scope === 'all_open' && (
                          <span className="truncate max-w-[120px] text-[#bbb]" title={item.fileName}>
                            {item.fileName}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[#4cc2ff] shrink-0">
                        {item.pageLabel ? `${item.pageLabel} (P.${item.pageIndex + 1})` : `Pag. ${item.pageIndex + 1}`}
                      </span>
                    </div>
                    <div className="text-[11px] leading-snug break-words">
                      {renderHighlightedSnippet(item.snippet, item.matchText)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
