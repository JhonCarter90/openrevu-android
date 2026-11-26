import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { AnyMarkup, MarkupStatus } from '@/types/markup';
import { ScaleManager } from '@/core/scale/scaleManager';
import { exportMarkupsSummaryCSV, exportMarkupsSummaryPDF } from '@/core/serialization/markupSummaryExporter';
import { BluebeamIcon } from '@/components/icons/BluebeamIcon';
import { 
  ChevronUp, 
  ChevronDown, 
  Download, 
  Trash2, 
  Search, 
  Maximize2,
  Minimize2,
  ChevronsDown,
  ChevronsUp,
  Table
} from 'lucide-react';

export const MarkupsListPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);
  const [panelHeight, setPanelHeight] = useState(220);
  const [savedHeight, setSavedHeight] = useState(220);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterAuthor, setFilterAuthor] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  const startYRef = useRef(0);
  const startHRef = useRef(0);

  const {
    markups,
    selectedMarkupIds,
    selectMarkup,
    deleteMarkup,
    updateMarkup,
    setCurrentPage,
    scaleCalibration,
    switchDocument,
  } = useAppStore();

  const authors = Array.from(new Set(markups.map((m) => m.author)));

  // Scorciatoia Alt + L (Scorciatoia ufficiale Bluebeam per Markups List)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toUpperCase() === 'L') {
        e.preventDefault();
        togglePanel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, panelHeight, savedHeight]);

  // Gestione del ridimensionamento continuo con il mouse (Drag Splitter)
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startYRef.current = e.clientY;
    startHRef.current = panelHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startYRef.current - moveEvent.clientY;
      const newHeight = Math.max(30, Math.min(window.innerHeight - 100, startHRef.current + deltaY));
      
      // Se trascinato quasi a zero (< 45px), abbassa a pacco
      if (newHeight <= 45) {
        setIsOpen(false);
      } else {
        setIsOpen(true);
        setPanelHeight(newHeight);
        setSavedHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Alterna stato aperto / abbassato a pacco
  const togglePanel = () => {
    if (isOpen) {
      setSavedHeight(panelHeight);
      setIsOpen(false);
    } else {
      setPanelHeight(savedHeight > 60 ? savedHeight : 220);
      setIsOpen(true);
    }
  };

  // Massimizza / Ripristina
  const toggleMaximize = () => {
    if (isMaximized) {
      setPanelHeight(savedHeight);
      setIsMaximized(false);
      setIsOpen(true);
    } else {
      setSavedHeight(panelHeight);
      setPanelHeight(Math.floor(window.innerHeight * 0.75));
      setIsMaximized(true);
      setIsOpen(true);
    }
  };

  const filteredMarkups = markups.filter((m) => {
    if (filterAuthor !== 'ALL' && m.author !== filterAuthor) return false;
    if (filterStatus !== 'ALL' && m.status !== filterStatus) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchSubj = m.subject?.toLowerCase().includes(q);
      const matchAuthor = m.author?.toLowerCase().includes(q);
      const matchContents = m.contents?.toLowerCase().includes(q);
      if (!matchSubj && !matchAuthor && !matchContents) return false;
    }
    return true;
  });

  const handleSelectRow = (m: AnyMarkup) => {
    selectMarkup(m.id);
    if (m.docId && m.docId !== 'primary' && m.docId !== 'secondary') {
      switchDocument(m.docId);
    }
    setCurrentPage(m.pageIndex + 1);
  };

  const getMeasurementValue = (m: AnyMarkup): string => {
    if (m.type === 'measure_length') {
      return ScaleManager.formatLength((m as any).measuredLength, scaleCalibration);
    }
    if (m.type === 'measure_polyline') {
      const len = ScaleManager.calculatePolylineLength((m as any).points);
      return ScaleManager.formatLength(len, scaleCalibration);
    }
    if (m.type === 'measure_area' || m.type === 'measure_area_rect') {
      const area = ScaleManager.calculatePolygonArea((m as any).points);
      return ScaleManager.formatArea(area, scaleCalibration);
    }
    if (m.type === 'measure_count') {
      return `${(m as any).locations?.length || 1} pz`;
    }
    return '-';
  };

  const exportCSV = () => {
    const st = useAppStore.getState();
    exportMarkupsSummaryCSV(st.fileName, filteredMarkups, st.pagesInfo);
  };

  const exportPDFSummary = () => {
    const st = useAppStore.getState();
    void exportMarkupsSummaryPDF(st.fileName, filteredMarkups, st.pagesInfo);
  };

  return (
    <div
      className={`bg-[#1e1e1e] border-t border-[#333333] flex flex-col text-xs select-none z-30 ${
        isResizing ? 'transition-none' : 'transition-[height] duration-150'
      }`}
      style={{ height: isOpen ? `${panelHeight}px` : '24px' }}
    >
      {/* 1. Barra Splitter Ridimensionabile con il Mouse (Doppio click per abbassare a pacco) */}
      <div
        onMouseDown={handleMouseDownResize}
        onDoubleClick={togglePanel}
        className="h-1.5 w-full bg-[#2a2a2a] hover:bg-[#0078d4] cursor-row-resize transition-colors flex items-center justify-center group"
        title="Trascina verso il basso per abbassare a pacco | Doppio click per collassare/espandere"
      >
        <div className="w-10 h-0.5 bg-[#555] group-hover:bg-white rounded-full" />
      </div>

      {/* 2. Intestazione Dock Tab (Stile Bluebeam Revu) */}
      <div className="h-6 bg-[#252526] px-2 flex items-center justify-between border-b border-[#333333]">
        <div className="flex items-center space-x-2">
          {/* Linguetta / Pulsante per Abbassare a Pacco */}
          <button
            onClick={togglePanel}
            className="flex items-center space-x-1.5 px-2 py-0.5 rounded hover:bg-[#333333] text-white font-semibold transition"
            title="Abbandona/Ripristina Elenco Marcature (Alt+L)"
          >
            {isOpen ? <ChevronsDown size={14} className="text-[#0078d4]" /> : <ChevronsUp size={14} className="text-[#00b7c3]" />}
            <span>Elenco Marcature</span>
            <span className="text-[10px] bg-[#333333] text-[#00b7c3] font-mono px-1.5 py-0.2 rounded-full">
              {filteredMarkups.length}
            </span>
          </button>

          {/* Filtri & Ricerca (mostrati solo se aperto) */}
          {isOpen && (
            <div className="flex items-center space-x-2 ml-3">
              <div className="flex items-center bg-[#1e1e1e] px-1.5 py-0.5 rounded border border-[#3c3c3c]">
                <Search size={11} className="text-[#888] mr-1" />
                <input
                  type="text"
                  placeholder="Cerca commento/oggetto..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-transparent text-white text-[10px] focus:outline-none w-28"
                />
              </div>

              <select
                value={filterAuthor}
                onChange={(e) => setFilterAuthor(e.target.value)}
                className="bg-[#1e1e1e] text-[#ccc] border border-[#3c3c3c] rounded px-1.5 py-0.5 text-[10px] focus:outline-none"
              >
                <option value="ALL">Tutti gli Autori</option>
                {authors.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-[#1e1e1e] text-[#ccc] border border-[#3c3c3c] rounded px-1.5 py-0.5 text-[10px] focus:outline-none"
              >
                <option value="ALL">Tutti gli Stati</option>
                <option value="None">Nessuno</option>
                <option value="Accepted">Accettato</option>
                <option value="Rejected">Rifiutato</option>
                <option value="Completed">Completato</option>
                <option value="Cancelled">Annullato</option>
              </select>
            </div>
          )}
        </div>

        {/* Azioni Destra: Esporta CSV, Massimizza, Abbassa a Pacco */}
        <div className="flex items-center space-x-1.5">
          {isOpen && (
            <>
              <button
                onClick={exportCSV}
                className="flex items-center space-x-1 px-2 py-0.5 bg-[#2d2d30] hover:bg-[#3e3e42] text-white rounded transition text-[10px]"
                title="Esporta Riepilogo Marcature in Excel (.csv)"
              >
                <Download size={11} className="text-[#107c41]" />
                <span>Excel (.csv)</span>
              </button>
              <button
                onClick={exportPDFSummary}
                className="flex items-center space-x-1 px-2 py-0.5 bg-[#2d2d30] hover:bg-[#3e3e42] text-white rounded transition text-[10px]"
                title="Esporta Riepilogo Marcature in Report PDF"
              >
                <Download size={11} className="text-[#0078d4]" />
                <span>Riepilogo PDF</span>
              </button>

              <button
                onClick={toggleMaximize}
                className="p-1 hover:bg-[#333333] text-[#aaa] hover:text-white rounded transition"
                title={isMaximized ? 'Ripristina altezza' : 'Massimizza tabella'}
              >
                {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            </>
          )}

          <button
            onClick={togglePanel}
            className="p-1 hover:bg-[#333333] text-[#aaa] hover:text-white rounded transition"
            title={isOpen ? 'Abbassa a pacco (chiudi)' : 'Espandi elenco'}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {/* 3. Tabella Dati Sincronizzata Bidirezionale */}
      {isOpen && (
        <div className="flex-1 overflow-auto bg-[#181818]">
          <table className="w-full text-left border-collapse select-none">
            <thead className="bg-[#202020] text-[#888888] sticky top-0 border-b border-[#333333] text-[11px]">
              <tr>
                <th className="py-1 px-3 w-8">Colore</th>
                <th className="py-1 px-3">Oggetto</th>
                <th className="py-1 px-3 w-16">Pagina</th>
                <th className="py-1 px-3">Commento</th>
                <th className="py-1 px-3">Autore</th>
                <th className="py-1 px-3">Data</th>
                <th className="py-1 px-3 w-28">Stato</th>
                <th className="py-1 px-3">Misura / Valore</th>
                <th className="py-1 px-3 w-10 text-center">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a2a] text-[#cccccc]">
              {filteredMarkups.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-[#666666]">
                    Nessun markup trovato sulla tavola.
                  </td>
                </tr>
              ) : (
                filteredMarkups.map((m) => {
                  const isSelected = selectedMarkupIds.includes(m.id);
                  return (
                    <tr
                      key={m.id}
                      onClick={() => handleSelectRow(m)}
                      className={`cursor-pointer transition hover:bg-[#2a2d2e] ${
                        isSelected ? 'bg-[#094771] text-white font-medium' : ''
                      }`}
                    >
                      <td className="py-1 px-3">
                        <div
                          className="w-3.5 h-3.5 rounded border border-white/40 shadow-sm"
                          style={{ backgroundColor: m.strokeColor }}
                        />
                      </td>
                      <td className="py-1 px-3 font-semibold text-white truncate max-w-[140px]">
                        {m.subject}
                      </td>
                      <td className="py-1 px-3 font-mono">{m.pageIndex + 1}</td>
                      <td className="py-1 px-3 min-w-[240px]">
                        <input
                          type="text"
                          value={m.contents || ''}
                          placeholder="Aggiungi o modifica commento..."
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectRow(m);
                          }}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (m.type === 'textbox' || m.type === 'callout' || m.type === 'cloud_plus') {
                              updateMarkup(m.id, { contents: val, text: val } as any);
                            } else {
                              updateMarkup(m.id, { contents: val });
                            }
                          }}
                          className={`w-full bg-transparent border border-transparent hover:border-[#3e3e42] focus:border-[#0078d4] focus:bg-[#141416] rounded px-1.5 py-0.5 text-xs outline-none transition ${
                            isSelected ? 'text-white' : 'text-[#ddd]'
                          }`}
                          title="Clicca per modificare direttamente il commento"
                        />
                      </td>
                      <td className="py-1 px-3 truncate max-w-[120px]">{m.author}</td>
                      <td className="py-1 px-3 font-mono text-[10px] text-[#888]">
                        {new Date(m.modificationDate).toLocaleDateString('it-IT')}
                      </td>
                      <td className="py-1 px-3" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={m.status}
                          onChange={(e) =>
                            updateMarkup(m.id, { status: e.target.value as MarkupStatus })
                          }
                          className="bg-[#1e1e1e] text-[#ccc] text-[10px] rounded px-1 py-0.5 border border-[#444] focus:outline-none"
                        >
                          <option value="None">Nessuno</option>
                          <option value="Accepted">Accettato</option>
                          <option value="Rejected">Rifiutato</option>
                          <option value="Completed">Completato</option>
                          <option value="Cancelled">Annullato</option>
                        </select>
                      </td>
                      <td className="py-1 px-3 font-mono text-[#00b7c3]">
                        {getMeasurementValue(m)}
                      </td>
                      <td className="py-1 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => deleteMarkup(m.id)}
                          className="p-1 hover:text-red-400 text-[#777] rounded transition"
                          title="Elimina marcatura"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
