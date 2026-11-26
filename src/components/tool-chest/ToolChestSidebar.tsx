import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useAppStore, sanitizeToolMarkup } from '@/store/useAppStore';
import { BTXParser, BTXToolSet, symbolToolToMarkup } from '@/core/btx/btxParser';
import deskelyPidCatalog from '@/core/btx/deskelyPidCatalog.json';
import { AnyMarkup } from '@/types/markup';
import { ToolIconPreview } from './ToolIconPreview';
import {
  Wrench,
  FolderPlus,
  Clock,
  Sparkles,
  Trash2,
  ChevronDown,
  ChevronRight,
  Settings,
  Plus,
  Download,
  Layers,
  Search,
  FolderOpen,
  Check,
} from 'lucide-react';

/**
 * Set predefinito di 15 strumenti personali (fedeli allo screenshot originale Bluebeam Revu)
 * Tutti con schema geometrico valido (boxRect, startPoint/endPoint, arrowPoint, points)
 */
export const DEFAULT_MY_TOOLS: AnyMarkup[] = [
  {
    id: 'mytool-1',
    type: 'cloud',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Nuvoletta Revisione Gialla',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#eab308',
    fillColor: '#eab308',
    fillOpacity: 0.25,
    strokeWidth: 2,
    opacity: 1,
    points: [
      { x: 6, y: 6 },
      { x: 34, y: 6 },
      { x: 34, y: 34 },
      { x: 6, y: 34 },
    ],
  },
  {
    id: 'mytool-2',
    type: 'cloud',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Nuvoletta Revisione Rossa',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#ef4444',
    fillColor: '#ef4444',
    fillOpacity: 0.28,
    strokeWidth: 2,
    opacity: 1,
    points: [
      { x: 6, y: 6 },
      { x: 34, y: 6 },
      { x: 34, y: 34 },
      { x: 6, y: 34 },
    ],
  },
  {
    id: 'mytool-3',
    type: 'textbox',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Casella di Testo Gialla',
    contents: 'T',
    text: 'Nota tecnica',
    fontSize: 12,
    fontFamily: 'Arial, sans-serif',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#eab308',
    fillColor: 'transparent',
    strokeWidth: 1.5,
    opacity: 1,
    boxRect: { x: 5, y: 5, width: 80, height: 32 },
  },
  {
    id: 'mytool-4',
    type: 'textbox',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Casella di Testo Grigia',
    contents: 'T',
    text: 'Nota tecnica',
    fontSize: 12,
    fontFamily: 'Arial, sans-serif',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#737373',
    fillColor: 'transparent',
    strokeWidth: 1.5,
    opacity: 1,
    boxRect: { x: 5, y: 5, width: 80, height: 32 },
  },
  {
    id: 'mytool-5',
    type: 'pen',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Penna Blu Tecnica',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#0284c7',
    strokeWidth: 2.5,
    opacity: 1,
    points: [
      { x: 6, y: 30 },
      { x: 18, y: 12 },
      { x: 34, y: 10 },
    ],
  },
  {
    id: 'mytool-6',
    type: 'arrow',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Freccia Direttrice Bianca',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#e5e5e5',
    strokeWidth: 1.5,
    opacity: 1,
    endHead: 'arrow',
    startPoint: { x: 5, y: 35 },
    endPoint: { x: 35, y: 5 },
  },
  {
    id: 'mytool-7',
    type: 'callout',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Callout Annotazione Rossa',
    contents: 'Nota revisione',
    text: 'Nota revisione',
    fontSize: 11,
    fontFamily: 'Arial, sans-serif',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#ef4444',
    fillColor: '#ffffff',
    strokeWidth: 1.5,
    opacity: 1,
    arrowPoint: { x: 4, y: 34 },
    boxRect: { x: 14, y: 6, width: 110, height: 34 },
  },
  {
    id: 'mytool-8',
    type: 'cloud',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Nuvoletta Grigia',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#737373',
    fillColor: 'transparent',
    strokeWidth: 1.5,
    opacity: 1,
    points: [
      { x: 6, y: 6 },
      { x: 34, y: 6 },
      { x: 34, y: 34 },
      { x: 6, y: 34 },
    ],
  },
  {
    id: 'mytool-9',
    type: 'ellipse',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Cerchio Blu',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#0284c7',
    fillColor: 'transparent',
    strokeWidth: 1.8,
    opacity: 1,
    boxRect: { x: 5, y: 5, width: 40, height: 40 },
  },
  {
    id: 'mytool-10',
    type: 'rectangle',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Rettangolo Nero',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#404040',
    fillColor: '#000000',
    fillOpacity: 0.4,
    strokeWidth: 1.5,
    opacity: 1,
    boxRect: { x: 5, y: 5, width: 50, height: 36 },
  },
  {
    id: 'mytool-11',
    type: 'highlighter',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Evidenziatore Rosso',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#dc2626',
    strokeWidth: 8,
    opacity: 0.45,
    points: [
      { x: 6, y: 24 },
      { x: 34, y: 16 },
    ],
  },
  {
    id: 'mytool-12',
    type: 'ellipse',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Bollo Pieno Rosso/Grigio',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#ef4444',
    fillColor: '#a3a3a3',
    fillOpacity: 0.7,
    strokeWidth: 2,
    opacity: 1,
    boxRect: { x: 5, y: 5, width: 36, height: 36 },
  },
  {
    id: 'mytool-13',
    type: 'rectangle',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Rettangolo Rosso P&ID',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#ef4444',
    fillColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    boxRect: { x: 5, y: 5, width: 50, height: 36 },
  },
  {
    id: 'mytool-14',
    type: 'line',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Linea Tubazione Rossa',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#ef4444',
    strokeWidth: 2,
    opacity: 1,
    startPoint: { x: 5, y: 35 },
    endPoint: { x: 35, y: 5 },
  },
  {
    id: 'mytool-15',
    type: 'line',
    pageIndex: 0,
    author: 'Fabio Ferreri',
    subject: 'Linea Strumentale Blu',
    contents: '',
    creationDate: '',
    modificationDate: '',
    status: 'None',
    strokeColor: '#2563eb',
    strokeWidth: 2,
    opacity: 1,
    startPoint: { x: 5, y: 35 },
    endPoint: { x: 35, y: 5 },
  },
] as AnyMarkup[];

interface BTXManifestEntry {
  file: string;
  title: string;
}

export const ToolChestSidebar: React.FC = () => {
  const {
    myTools,
    setMyTools,
    removeMyTool,
    toolSets,
    recentTools,
    clearRecentTools,
    addToolSet,
    addToolToSet,
    addMyTool,
    removeToolSet,
    removeToolFromSet,
    createCustomToolSet,
    selectedMarkupIds,
    markups,
    groupSelectedMarkups,
    ungroupSelectedMarkup,
    saveSelectedToToolChest,
    setActiveTool,
    setActiveColor,
    setActiveFillColor,
    setActiveFillOpacity,
    setActiveStrokeWidth,
    setActiveLineStyle,
    setActiveHatchPattern,
    setActiveHatchColor,
    setActiveStartHead,
    setActiveEndHead,
    activeToolChestMarkup,
    setActiveToolChestMarkup,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [openMyTools, setOpenMyTools] = useState(true);
  const [openRecent, setOpenRecent] = useState(true);
  const [openLibraries, setOpenLibraries] = useState(true);
  const [collapsedSetMap, setCollapsedSetMap] = useState<Record<number, boolean>>({});
  const [iconScale, setIconScale] = useState(38);
  const [searchQuery, setSearchQuery] = useState('');

  // Catalogo completo 40 librerie .btx da public/samples/btx/manifest.json
  const [manifestEntries, setManifestEntries] = useState<BTXManifestEntry[]>([]);
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState<string | null>(null);

  // Modale importazione simboli dal PDF attivo con scelta set / set separati
  const [showPdfImportModal, setShowPdfImportModal] = useState(false);
  const [pdfImportMode, setPdfImportMode] = useState<'new' | 'existing' | 'by_page' | 'by_prefix'>('new');
  const [pdfImportTarget, setPdfImportTarget] = useState<'myTools' | number>('myTools');
  const [pdfImportNewTitle, setPdfImportNewTitle] = useState('Simboli da PDF');
  const [pdfImportDedup, setPdfImportDedup] = useState(false);
  const [customSymbolName, setCustomSymbolName] = useState('');
  const [targetDestination, setTargetDestination] = useState<'myTools' | number>('myTools');
  const [newLibName, setNewLibName] = useState('');
  const [showNewLibInput, setShowNewLibInput] = useState(false);

  // Inizializza DEFAULT_MY_TOOLS se non ancora popolati
  useEffect(() => {
    if (myTools.length === 0) {
      setMyTools(DEFAULT_MY_TOOLS);
    }
  }, []);

  // Carica il manifest delle 40 librerie .btx e pre-carica le librerie principali se non presenti
  useEffect(() => {
    let mounted = true;
    const initCatalog = async () => {
      try {
        const res = await fetch('/samples/btx/manifest.json');
        if (res.ok) {
          const list: BTXManifestEntry[] = await res.json();
          if (mounted) setManifestEntries(list);
        }
      } catch (e) {
        console.warn('Impossibile leggere manifest BTX:', e);
      }

      // Rimuove i vecchi pacchetti .btx Bukhara/predefiniti lasciando intatti gli strumenti e librerie dell'utente
      const PurgeFlag = 'openrevu_btx_purged_v2';
      if (localStorage.getItem(PurgeFlag) !== '1') {
        const autoBtxTitles = new Set([
          'Valves_Bukhara',
          'Valves',
          'Pumps & Turbine',
          'Instrument_Bukhara',
          'Instrument Valves_Bukhara',
          'Exchangers_Bukhara',
          'Compressors_Bukhara',
          'Compressors_Bhukara',
          'Relief Devices_Bukhara',
          'Boots and Dome',
          'Architettura & Impianti',
        ]);
        const currentSets = useAppStore.getState().toolSets;
        const cleaned = currentSets.filter(
          (ts) =>
            ts &&
            typeof ts.title === 'string' &&
            !autoBtxTitles.has(ts.title) &&
            !/bukhara|bhukara/i.test(ts.title) &&
            !/^789c[0-9a-fA-F]+/i.test(ts.title)
        );
        if (cleaned.length !== currentSets.length) {
          useAppStore.getState().setToolSets(cleaned);
        }

        const currentMyTools = useAppStore.getState().myTools;
        const cleanedMyTools = currentMyTools.filter(
          (m) => !(m.author === 'Bluebeam BTX' && /bukhara|bhukara/i.test(m.subject || ''))
        );
        if (cleanedMyTools.length !== currentMyTools.length) {
          useAppStore.getState().setMyTools(cleanedMyTools);
        }

        try {
          localStorage.setItem(PurgeFlag, '1');
          localStorage.setItem('openrevu_btx_purged_v1', '1');
        } catch {}
      }
    };
    initCatalog();
    return () => {
      mounted = false;
    };
  }, []);

  const loadBTXFromSample = async (fileName: string) => {
    setLoadingLibrary(fileName);
    try {
      const resp = await fetch(`/samples/btx/${encodeURIComponent(fileName)}`);
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        const parsed = BTXParser.parse(new Uint8Array(buf), fileName);
        if (parsed.items.length > 0) {
          addToolSet(parsed);
        }
      }
    } catch (err) {
      console.error('Errore caricamento libreria BTX:', fileName, err);
    } finally {
      setLoadingLibrary(null);
    }
  };

  const loadAll40Libraries = async () => {
    if (manifestEntries.length === 0) return;
    setLoadingLibrary('ALL');
    try {
      const existingTitles = new Set(toolSets.map((t) => t.title.toLowerCase()));
      for (const entry of manifestEntries) {
        if (existingTitles.has(entry.title.toLowerCase())) continue;
        try {
          const resp = await fetch(`/samples/btx/${encodeURIComponent(entry.file)}`);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            const parsed = BTXParser.parse(new Uint8Array(buf), entry.file);
            if (parsed.items.length > 0) {
              useAppStore.getState().addToolSet(parsed);
            }
          }
        } catch {}
      }
    } finally {
      setLoadingLibrary(null);
      setShowCatalogModal(false);
    }
  };

  const handleImportBTX = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const buffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(buffer);
        const toolSet = BTXParser.parse(uint8, file.name);
        addToolSet(toolSet);
      } catch (err) {
        console.error('Errore importazione .btx:', err);
      }
    }
    e.target.value = '';
  };

  const handleExportToolSet = (toolSet: BTXToolSet, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const bytes = BTXParser.exportToolSetToBTX(toolSet);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (toolSet.title || 'Libreria_Simboli').replace(/[<>:"/\\|?*]+/g, '_');
      a.download = `${safeName}.btx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Errore esportazione .btx:', err);
    }
  };

  const applyTool = (rawTool: AnyMarkup, forceStampMode: boolean = false) => {
    const tool = sanitizeToolMarkup(rawTool);
    const isCompoundSymbol =
      forceStampMode ||
      Boolean(tool.compoundPaths && tool.compoundPaths.length > 0) ||
      Boolean((tool as any).isSymbol);

    setActiveColor(tool.strokeColor || '#ff0000');
    setActiveFillColor(tool.fillColor || 'transparent');
    if (tool.fillOpacity !== undefined) setActiveFillOpacity(tool.fillOpacity);
    setActiveStrokeWidth(tool.strokeWidth || 1.5);
    if (tool.lineStyle) setActiveLineStyle(tool.lineStyle);
    if (tool.hatchPattern) setActiveHatchPattern(tool.hatchPattern);
    if (tool.hatchColor) setActiveHatchColor(tool.hatchColor);
    if (tool.startHead) setActiveStartHead(tool.startHead);
    if (tool.endHead) setActiveEndHead(tool.endHead);

    if (isCompoundSymbol) {
      // Modalità piazzamento simbolo: clic o trascinamento sul foglio posiziona il simbolo!
      setActiveToolChestMarkup(tool);
      setActiveTool(tool.type === ('measure' as any) ? 'measure_length' : tool.type);
    } else {
      // Strumento di disegno standard (Nuvoletta, Callout, Linea, Rettangolo, Testo): disegna con queste proprietà
      setActiveToolChestMarkup(null);
      setActiveTool(tool.type === ('measure' as any) ? 'measure_length' : tool.type);
    }
  };

  const selectedMarkupsOnCanvas = useMemo(
    () => markups.filter((m) => selectedMarkupIds.includes(m.id)),
    [markups, selectedMarkupIds]
  );

  const canUngroup = useMemo(
    () =>
      selectedMarkupsOnCanvas.some(
        (m) => m.compoundPaths && m.compoundPaths.length > 1
      ),
    [selectedMarkupsOnCanvas]
  );

  const handleSaveSelectedSymbol = () => {
    const customTrimmed = customSymbolName.trim();
    const nameArg =
      selectedMarkupsOnCanvas.length === 1
        ? customTrimmed || selectedMarkupsOnCanvas[0].subject || 'Simbolo Personalizzato'
        : customTrimmed || undefined;
    const saved = saveSelectedToToolChest(targetDestination, nameArg);
    if (saved) {
      setCustomSymbolName('');
    }
  };

  const getPdfImportCandidates = () => {
    const currentMarkups = useAppStore.getState().markups;
    const groupedOrVector = currentMarkups.filter(
      (m) => (m.compoundPaths && m.compoundPaths.length > 0) || m.isGroup || m.isSymbol
    );
    return groupedOrVector.length > 0 ? groupedOrVector : currentMarkups;
  };

  const handleImportSymbolsFromPdf = () => {
    const candidates = getPdfImportCandidates();
    if (candidates.length === 0) {
      alert('Nessun simbolo o annotazione presente nel PDF attivo.');
      return;
    }
    const st = useAppStore.getState();
    const activeDoc = st.openDocuments.find((d) => d.id === st.activeDocumentId);
    const baseDocName = (activeDoc?.fileName || 'PDF').replace(/\.pdf$/i, '');
    setPdfImportNewTitle(baseDocName);
    setShowPdfImportModal(true);
  };

  const executePdfSymbolImport = () => {
    const candidates = getPdfImportCandidates();
    if (candidates.length === 0) return;

    const seenNames = new Set<string>();
    const prepared: { markup: AnyMarkup; tool: AnyMarkup; name: string }[] = [];
    for (const m of candidates) {
      const name = (m.subject || `Simbolo ${prepared.length + 1}`).trim();
      if (pdfImportDedup && seenNames.has(name)) continue;
      seenNames.add(name);
      prepared.push({
        markup: m,
        name,
        tool: BTXParser.markupToSymbolTool(m, name),
      });
    }

    if (prepared.length === 0) return;

    if (pdfImportMode === 'existing') {
      if (pdfImportTarget === 'myTools') {
        prepared.forEach((p) => addMyTool(p.tool));
      } else if (typeof pdfImportTarget === 'number' && toolSets[pdfImportTarget]) {
        prepared.forEach((p) => addToolToSet(pdfImportTarget, p.tool));
      }
    } else if (pdfImportMode === 'new') {
      const title = pdfImportNewTitle.trim() || `Simboli da PDF (${prepared.length})`;
      addToolSet({
        id: `pdf-import-${Date.now()}`,
        title,
        items: prepared.map((p) => p.tool),
      });
    } else if (pdfImportMode === 'by_page') {
      const byPage = new Map<number, AnyMarkup[]>();
      for (const p of prepared) {
        const pg = (p.markup.pageIndex ?? 0) + 1;
        if (!byPage.has(pg)) byPage.set(pg, []);
        byPage.get(pg)!.push(p.tool);
      }
      const baseTitle = pdfImportNewTitle.trim() || 'Simboli PDF';
      Array.from(byPage.entries())
        .sort((a, b) => a[0] - b[0])
        .forEach(([pg, items]) => {
          addToolSet({
            id: `pdf-import-p${pg}-${Date.now()}`,
            title: byPage.size > 1 ? `${baseTitle} - Pag ${pg}` : baseTitle,
            items,
          });
        });
    } else if (pdfImportMode === 'by_prefix') {
      const groups = new Map<string, AnyMarkup[]>();
      for (const p of prepared) {
        const match = p.name.match(/^([A-Za-z0-9 &/+]{2,28}?)(?:\s*[-_:]\s*|\s+#\d+)/);
        const cat = match ? match[1].trim() : 'Simboli Vari';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat)!.push(p.tool);
      }
      Array.from(groups.entries()).forEach(([cat, items], idx) => {
        addToolSet({
          id: `pdf-import-cat-${idx}-${Date.now()}`,
          title: cat,
          items,
        });
      });
    }

    setShowPdfImportModal(false);
  };

  const q = searchQuery.trim().toLowerCase();

  return (
    <div className="w-64 bg-[#202022] border-r border-[#141416] flex flex-col h-full select-none text-[#d4d4d4]">
      {/* Intestazione Cassa degli Strumenti */}
      <div className="px-2.5 py-2 border-b border-[#141416] flex items-center justify-between bg-[#252528]">
        <div className="flex items-center space-x-1.5">
          <Wrench size={14} className="text-[#00a8ff]" />
          <span className="text-xs font-semibold tracking-wide text-white">
            Cassa degli strumenti
          </span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={() => {
              (deskelyPidCatalog as any[]).forEach((cat) => {
                const items = (cat.tools || []).map((t: any) =>
                  symbolToolToMarkup({
                    id: t.id,
                    name: t.name,
                    subject: t.name,
                    category: cat.title,
                    type: 'stamp_symbol',
                    strokeColor: '#ef4444',
                    strokeWidth: 1.5,
                    opacity: 1,
                    compoundPaths: t.compoundPaths || [],
                    aspectRatio: 1.5,
                    defaultWidth: t.defaultWidth || 48,
                    defaultHeight: t.defaultHeight || 32,
                  })
                );
                if (items.length > 0) {
                  addToolSet({
                    id: `deskely-${cat.title}`,
                    title: cat.title,
                    items,
                  });
                }
              });
            }}
            className="flex items-center space-x-1 px-1.5 py-1 bg-[#1e3a2f] hover:bg-[#264b3d] text-[#6ee7b7] border border-[#346452] rounded text-[10px] font-medium transition shadow-sm"
            title="Carica i 92 simboli P&ID ISA 5.1 / ISO 10628-2 (Valvole, Pompe, Serbatoi, Strumentazione, Linee)"
          >
            <span>+ P&ID (92)</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-1 px-1.5 py-1 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded text-[10px] font-medium transition shadow-sm"
            title="Importa file .btx Bluebeam dal disco"
          >
            <FolderPlus size={11} />
            <span>.btx</span>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".btx,.xml"
          multiple
          onChange={handleImportBTX}
          className="hidden"
        />
      </div>

      {/* Barra Ricerca Simboli + Azioni Gruppo / Aggiungi a Tool Chest */}
      <div className="px-2 py-1.5 bg-[#1b1b1d] border-b border-[#141416] space-y-1.5">
        <div className="relative flex items-center">
          <Search size={12} className="absolute left-2 text-[#777]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca simbolo (es. Valve, Pump)..."
            className="w-full pl-6 pr-5 py-1 bg-[#252528] border border-[#333338] focus:border-[#0078d4] rounded text-[11px] text-white placeholder-[#777] outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 text-[10px] text-[#888] hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* Azione rapida Importazione Simboli dal PDF attivo */}
        <button
          onClick={handleImportSymbolsFromPdf}
          className="w-full px-2 py-1 bg-[#26362c] hover:bg-[#2f4938] text-[#6ee7b7] border border-[#385241] rounded text-[10px] font-medium truncate transition"
          title="Importa simboli dal PDF attivo scegliendo il set di destinazione o dividendoli in set separati"
        >
          Importa Simboli dal PDF attivo...
        </button>

        {/* Modale opzioni importazione da PDF attivo (scelta set o set separati) */}
        {showPdfImportModal && (
          <div className="p-2 bg-[#1b222c] border border-[#107c41] rounded space-y-2 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#6ee7b7] uppercase">Importa Simboli dal PDF</span>
              <button
                onClick={() => setShowPdfImportModal(false)}
                className="text-[#999] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <label className="flex items-center gap-1.5 cursor-pointer text-[#ddd]">
                <input
                  type="radio"
                  name="pdfImportMode"
                  checked={pdfImportMode === 'existing'}
                  onChange={() => setPdfImportMode('existing')}
                />
                <span>Aggiungi a un set esistente</span>
              </label>
              {pdfImportMode === 'existing' && (
                <select
                  value={pdfImportTarget === 'myTools' ? 'myTools' : String(pdfImportTarget)}
                  onChange={(e) =>
                    setPdfImportTarget(
                      e.target.value === 'myTools' ? 'myTools' : Number(e.target.value)
                    )
                  }
                  className="w-full bg-[#1e1e22] border border-[#3a3a42] rounded px-1.5 py-1 text-[10px] text-white outline-none"
                >
                  <option value="myTools">Strumenti personali</option>
                  {toolSets.map((ts, idx) => (
                    <option key={idx} value={String(idx)}>
                      {ts.title}
                    </option>
                  ))}
                </select>
              )}

              <label className="flex items-center gap-1.5 cursor-pointer text-[#ddd]">
                <input
                  type="radio"
                  name="pdfImportMode"
                  checked={pdfImportMode === 'new'}
                  onChange={() => setPdfImportMode('new')}
                />
                <span>Crea un nuovo set</span>
              </label>
              {pdfImportMode === 'new' && (
                <input
                  type="text"
                  value={pdfImportNewTitle}
                  onChange={(e) => setPdfImportNewTitle(e.target.value)}
                  placeholder="Nome nuovo set..."
                  className="w-full px-1.5 py-1 bg-[#1e1e22] border border-[#3a3a42] rounded text-[10px] text-white outline-none"
                />
              )}

              <label className="flex items-center gap-1.5 cursor-pointer text-[#ddd]">
                <input
                  type="radio"
                  name="pdfImportMode"
                  checked={pdfImportMode === 'by_page'}
                  onChange={() => setPdfImportMode('by_page')}
                />
                <span>Set separati per Pagina</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-[#ddd]">
                <input
                  type="radio"
                  name="pdfImportMode"
                  checked={pdfImportMode === 'by_prefix'}
                  onChange={() => setPdfImportMode('by_prefix')}
                />
                <span>Set separati per Prefisso/Categoria</span>
              </label>
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer text-[#aaa] pt-0.5">
              <input
                type="checkbox"
                checked={pdfImportDedup}
                onChange={(e) => setPdfImportDedup(e.target.checked)}
              />
              <span>Salta simboli con nome duplicato</span>
            </label>

            <div className="flex justify-end gap-1 pt-1">
              <button
                onClick={() => setShowPdfImportModal(false)}
                className="px-2 py-1 bg-[#2d2d32] hover:bg-[#3a3a40] text-[#ccc] rounded"
              >
                Annulla
              </button>
              <button
                onClick={executePdfSymbolImport}
                className="px-2 py-1 bg-[#107c41] hover:bg-[#15964f] text-white rounded font-semibold"
              >
                Importa
              </button>
            </div>
          </div>
        )}

        {/* Pannello Creazione / Raggruppamento Simbolo quando ci sono elementi selezionati sul foglio */}
        {selectedMarkupIds.length > 0 && (
          <div className="p-2 bg-[#162636] border border-[#0078d4]/60 rounded space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#50e6ff] uppercase tracking-wider flex items-center gap-1">
                <Layers size={11} />
                {selectedMarkupIds.length === 1
                  ? '1 Oggetto Selezionato'
                  : `${selectedMarkupIds.length} Oggetti Selezionati`}
              </span>
              <div className="flex items-center gap-1">
                {selectedMarkupIds.length >= 2 && (
                  <button
                    onClick={() => groupSelectedMarkups(customSymbolName || undefined)}
                    className="px-1.5 py-0.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded text-[10px] font-semibold transition"
                    title="Raggruppa in un unico simbolo (Ctrl+G)"
                  >
                    Raggruppa (Ctrl+G)
                  </button>
                )}
                {canUngroup && (
                  <button
                    onClick={() => ungroupSelectedMarkup()}
                    className="px-1.5 py-0.5 bg-[#3a3a40] hover:bg-[#4a4a52] text-white rounded text-[10px] transition"
                    title="Separa simbolo negli elementi base (Ctrl+Shift+G)"
                  >
                    Separa
                  </button>
                )}
              </div>
            </div>

            <input
              type="text"
              value={customSymbolName}
              onChange={(e) => setCustomSymbolName(e.target.value)}
              placeholder={
                selectedMarkupIds.length > 1
                  ? 'Opzionale (vuoto = mantieni nomi originali)...'
                  : 'Nome simbolo da salvare...'
              }
              className="w-full px-2 py-1 bg-[#1e1e22] border border-[#3a3a42] rounded text-[11px] text-white placeholder-[#888] outline-none focus:border-[#50e6ff]"
            />
            {selectedMarkupIds.length > 1 && (
              <p className="text-[9px] text-[#93c5fd] leading-tight">
                Verranno salvati {selectedMarkupIds.length} simboli separati nel set scelto.
              </p>
            )}

            <div className="flex items-center gap-1">
              <select
                value={targetDestination === 'myTools' ? 'myTools' : String(targetDestination)}
                onChange={(e) =>
                  setTargetDestination(
                    e.target.value === 'myTools' ? 'myTools' : Number(e.target.value)
                  )
                }
                className="flex-1 bg-[#1e1e22] border border-[#3a3a42] rounded px-1.5 py-1 text-[10px] text-white outline-none"
              >
                <option value="myTools">Salva in: Strumenti personali</option>
                {toolSets.map((ts, idx) => (
                  <option key={idx} value={String(idx)}>
                    Libreria: {ts.title}
                  </option>
                ))}
              </select>
              <button
                onClick={handleSaveSelectedSymbol}
                className="px-2 py-1 bg-[#107c41] hover:bg-[#15964f] text-white rounded text-[10px] font-semibold whitespace-nowrap transition flex items-center gap-1"
                title="Raggruppa e aggiungi permanentemente alla Cassa degli Strumenti"
              >
                <Plus size={11} />
                <span>Salva</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal/Tendina Catalogo Completo 40 Librerie BTX */}
      {showCatalogModal && (
        <div className="bg-[#18181b] border-b border-[#0078d4] p-2 max-h-64 flex flex-col space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-[#50e6ff] uppercase">
              Catalogo 40 Librerie Bluebeam (.btx)
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={loadAll40Libraries}
                disabled={loadingLibrary !== null}
                className="px-2 py-0.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded text-[10px] font-semibold transition"
              >
                {loadingLibrary === 'ALL' ? 'Caricamento...' : 'Carica Tutte (40)'}
              </button>
              <button
                onClick={() => setShowCatalogModal(false)}
                className="px-1.5 py-0.5 text-[10px] text-[#999] hover:text-white"
              >
                Chiudi
              </button>
            </div>
          </div>
          <div className="overflow-y-auto space-y-0.5 pr-1 max-h-48">
            {manifestEntries.map((entry) => {
              const isLoaded = toolSets.some(
                (t) =>
                  t.title.toLowerCase() === entry.title.toLowerCase() ||
                  t.title.toLowerCase() === entry.file.replace(/\.btx$/i, '').toLowerCase()
              );
              return (
                <button
                  key={entry.file}
                  onClick={() => loadBTXFromSample(entry.file)}
                  disabled={loadingLibrary !== null}
                  className={`w-full flex items-center justify-between px-2 py-1 rounded text-left text-[11px] transition ${
                    isLoaded
                      ? 'bg-[#107c41]/20 text-[#6ee7b7] border border-[#107c41]/40'
                      : 'hover:bg-[#2a2a2e] text-[#d4d4d4]'
                  }`}
                >
                  <span className="truncate">{entry.title}</span>
                  {isLoaded ? (
                    <span className="text-[9px] flex items-center gap-0.5 text-[#34d399]">
                      <Check size={10} /> Attiva
                    </span>
                  ) : (
                    <span className="text-[9px] text-[#50e6ff]">
                      {loadingLibrary === entry.file ? '...' : '+ Carica'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Contenuto scrollabile delle sezioni */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-2">
        {/* 1. SEZIONE: STRUMENTI PERSONali */}
        <div className="bg-[#18181a] border border-[#2c2c30] rounded overflow-hidden">
          <div
            onClick={() => setOpenMyTools(!openMyTools)}
            className="w-full px-2 py-1.5 bg-[#252528] hover:bg-[#2c2c30] flex items-center justify-between text-xs font-semibold text-white transition cursor-pointer"
          >
            <div className="flex items-center space-x-1.5">
              {openMyTools ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>Strumenti personali</span>
              <span className="text-[10px] text-[#888]">({myTools.length})</span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={(e) =>
                  handleExportToolSet({ title: 'Strumenti Personali OpenRevu', items: myTools }, e)
                }
                className="p-0.5 text-[#888] hover:text-[#50e6ff] transition"
                title="Esporta Strumenti personali in formato .btx Bluebeam"
              >
                <Download size={12} />
              </button>
              <Settings size={12} className="text-[#888888] hover:text-white" />
            </div>
          </div>

          {openMyTools && (
            <div className="p-2 grid grid-cols-4 gap-1.5 bg-[#141416]">
              {myTools
                .filter((t) => !q || (t.subject || '').toLowerCase().includes(q))
                .map((tool, index) => {
                  const isActive = activeToolChestMarkup?.id === tool.id;
                  const isCustom = !tool.id.startsWith('mytool-');
                  return (
                    <div
                      key={tool.id}
                      onClick={() => applyTool(tool)}
                      title={`${tool.subject} (Clicca per usare${isCustom ? ' / Doppio clic per timbrare' : ''})`}
                      className={`relative group flex items-center justify-center p-1 rounded border transition cursor-pointer ${
                        isActive
                          ? 'bg-[#0078d4]/25 border-[#00a8ff] shadow-inner'
                          : 'bg-[#1e1e20] hover:bg-[#2a2a2e] border-[#2d2d32]'
                      }`}
                    >
                      <span className="absolute top-0.5 right-0.5 bg-[#d4d4d8] text-[#18181b] font-bold text-[8px] leading-none px-1 py-0.5 rounded-[2px] shadow-sm pointer-events-none">
                        {index + 1}
                      </span>
                      {isCustom && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeMyTool(tool.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 absolute top-0.5 left-0.5 bg-red-600/90 text-white rounded p-0.5 transition"
                          title="Rimuovi da Strumenti personali"
                        >
                          <Trash2 size={8} />
                        </button>
                      )}
                      <ToolIconPreview tool={tool} size={iconScale} />
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* 2. SEZIONE: STRUMENTI RECENTI */}
        <div className="bg-[#18181a] border border-[#2c2c30] rounded overflow-hidden">
          <div
            onClick={() => setOpenRecent(!openRecent)}
            className="w-full px-2 py-1.5 bg-[#252528] hover:bg-[#2c2c30] flex items-center justify-between text-xs font-semibold text-white transition cursor-pointer"
          >
            <div className="flex items-center space-x-1.5">
              {openRecent ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Clock size={12} className="text-[#10b981]" />
              <span>Strumenti recenti</span>
              <span className="text-[10px] text-[#888888]">({recentTools.length})</span>
            </div>
            {recentTools.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearRecentTools();
                }}
                className="text-[#888] hover:text-red-400 p-0.5"
                title="Svuota strumenti recenti"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>

          {openRecent && (
            <div className="p-2 bg-[#141416]">
              {recentTools.length === 0 ? (
                <div className="text-[11px] text-[#666666] text-center py-2 italic">
                  Nessun markup recente.
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {recentTools.map((t, i) => {
                    const isActive = activeToolChestMarkup?.id === t.id;
                    return (
                      <button
                        key={`${t.id}-${i}`}
                        onClick={() => applyTool(t, true)}
                        className={`flex items-center justify-center p-1 rounded border transition ${
                          isActive
                            ? 'bg-[#0078d4]/25 border-[#00a8ff]'
                            : 'bg-[#1e1e20] hover:bg-[#2a2a2e] border-[#2d2d32]'
                        }`}
                        title={`${t.subject} — Clicca per posizionare sul disegno`}
                      >
                        <ToolIconPreview tool={t} size={iconScale} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. SEZIONE: LIBRERIE & SIMBOLI (.btx) */}
        <div className="bg-[#18181a] border border-[#2c2c30] rounded overflow-hidden">
          <div
            onClick={() => setOpenLibraries(!openLibraries)}
            className="w-full px-2 py-1.5 bg-[#252528] hover:bg-[#2c2c30] flex items-center justify-between text-xs font-semibold text-white transition cursor-pointer"
          >
            <div className="flex items-center space-x-1.5">
              {openLibraries ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Sparkles size={12} className="text-[#00a8ff]" />
              <span>Librerie & Simboli (.btx)</span>
              <span className="text-[10px] text-[#888888]">({toolSets.length})</span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowNewLibInput((v) => !v);
              }}
              className="text-[#00a8ff] hover:text-white p-0.5"
              title="Crea nuova libreria simboli personalizzata"
            >
              <Plus size={13} />
            </button>
          </div>

          {openLibraries && (
            <div className="p-2 bg-[#141416] space-y-2.5">
              {/* Creazione nuova libreria personalizzata */}
              {showNewLibInput && (
                <div className="flex items-center gap-1 bg-[#1e1e22] p-1.5 rounded border border-[#3a3a42]">
                  <input
                    type="text"
                    value={newLibName}
                    onChange={(e) => setNewLibName(e.target.value)}
                    placeholder="Nome nuova libreria..."
                    className="flex-1 bg-transparent text-[11px] text-white outline-none px-1"
                  />
                  <button
                    onClick={() => {
                      if (newLibName.trim()) {
                        createCustomToolSet(newLibName.trim());
                        setNewLibName('');
                        setShowNewLibInput(false);
                      }
                    }}
                    className="px-2 py-0.5 bg-[#0078d4] text-white rounded text-[10px] font-semibold"
                  >
                    Crea
                  </button>
                </div>
              )}

              {/* Elenco librerie caricate */}
              {toolSets.map((ts, idx) => {
                const filteredItems = q
                  ? ts.items.filter((it) => (it.subject || '').toLowerCase().includes(q))
                  : ts.items;
                if (q && filteredItems.length === 0) return null;
                const isCollapsed = Boolean(collapsedSetMap[idx]);

                return (
                  <div
                    key={`${ts.title}-${idx}`}
                    className="bg-[#1e1e20] border border-[#2d2d32] rounded overflow-hidden"
                  >
                    <div
                      onClick={() =>
                        setCollapsedSetMap((prev) => ({ ...prev, [idx]: !prev[idx] }))
                      }
                      className="px-2 py-1.5 bg-[#2a2a2e] border-b border-[#333338] flex items-center justify-between cursor-pointer hover:bg-[#323238]"
                    >
                      <div className="flex items-center space-x-1 min-w-0">
                        {isCollapsed ? (
                          <ChevronRight size={11} className="text-[#aaa] shrink-0" />
                        ) : (
                          <ChevronDown size={11} className="text-[#aaa] shrink-0" />
                        )}
                        <span
                          className="text-[11px] font-bold text-white truncate"
                          title={ts.title}
                        >
                          {ts.title}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <span className="text-[10px] text-[#999999]">{filteredItems.length}</span>
                        <button
                          onClick={(e) => handleExportToolSet(ts, e)}
                          className="text-[#999] hover:text-[#50e6ff] p-0.5 transition"
                          title={`Esporta libreria "${ts.title}" in formato .btx Bluebeam`}
                        >
                          <Download size={11} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeToolSet(idx);
                          }}
                          className="text-[#888] hover:text-red-400 p-0.5 transition"
                          title="Rimuovi libreria dalla vista"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>

                    {/* Griglia icone stile scheda bianca/chiara CAD Bluebeam */}
                    {!isCollapsed && (
                      <div className="p-2 grid grid-cols-5 gap-1.5 bg-[#e5e5e0]">
                        {filteredItems.map((item, i) => {
                          const isSelectedTool = activeToolChestMarkup?.id === item.id;
                          return (
                            <div
                              key={`${item.id}-${i}`}
                              onClick={() => applyTool(item, true)}
                              className={`relative group flex items-center justify-center p-0.5 bg-[#f4f4f0] hover:bg-white border rounded-[2px] transition shadow-xs cursor-pointer ${
                                isSelectedTool
                                  ? 'ring-2 ring-[#0078d4] border-[#0078d4] bg-white'
                                  : 'border-[#c4c4be]'
                              }`}
                              title={`${item.subject} — Clicca sul disegno per inserire (o trascina per dimensionare)`}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeToolFromSet(idx, item.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 absolute -top-1 -right-1 bg-red-600 text-white rounded-full p-0.5 z-10 shadow"
                                title="Elimina simbolo dalla libreria"
                              >
                                <Trash2 size={8} />
                              </button>
                              <ToolIconPreview tool={item} size={Math.max(28, iconScale - 4)} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer Slider Zoom Dimensione Icone (come nello screenshot Bluebeam) */}
      <div className="px-3 py-1.5 border-t border-[#141416] bg-[#1b1b1d] flex items-center justify-between space-x-2">
        <span className="text-[10px] text-[#777777]">◀</span>
        <input
          type="range"
          min={26}
          max={52}
          value={iconScale}
          onChange={(e) => setIconScale(Number(e.target.value))}
          className="w-full accent-[#0078d4] h-1 bg-[#333336] rounded cursor-pointer"
          title="Dimensione icone Cassa degli Strumenti"
        />
        <span className="text-[10px] text-[#777777]">▶</span>
      </div>
    </div>
  );
};
