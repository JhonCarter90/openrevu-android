import React, { useEffect, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { HyperlinkMarkup } from '@/types/markup';
import { Link2, X } from 'lucide-react';

export const HyperlinkActionModal: React.FC = () => {
  const {
    pendingHyperlink,
    setPendingHyperlink,
    openDocuments,
    activeDocumentId,
    currentUser,
    markups,
    addMarkup,
    updateMarkup,
    selectMarkup,
    setActiveTool,
  } = useAppStore();

  const [actionType, setActionType] = useState<'goto_page' | 'url' | 'open_file'>('goto_page');
  const [targetDocId, setTargetDocId] = useState<string>(activeDocumentId);
  const [targetPage, setTargetPage] = useState<number>(1);
  const [targetScale, setTargetScale] = useState<'fit_page' | 'keep_zoom'>('fit_page');
  const [targetUrl, setTargetUrl] = useState<string>('https://');
  const [targetFilePath, setTargetFilePath] = useState<string>('');

  useEffect(() => {
    if (!pendingHyperlink) return;
    if (pendingHyperlink.existingMarkupId) {
      const existing = markups.find(
        (m) => m.id === pendingHyperlink.existingMarkupId && m.type === 'hyperlink'
      ) as HyperlinkMarkup | undefined;
      if (existing) {
        setActionType(existing.actionType || 'goto_page');
        setTargetDocId(existing.targetDocId || activeDocumentId);
        setTargetPage(existing.targetPage || 1);
        setTargetScale(existing.targetScale || 'fit_page');
        setTargetUrl(existing.targetUrl || 'https://');
        setTargetFilePath(existing.targetFilePath || '');
        return;
      }
    }
    setActionType('goto_page');
    setTargetDocId(activeDocumentId);
    setTargetPage(1);
    setTargetScale('fit_page');
    setTargetUrl('https://');
    setTargetFilePath('');
  }, [pendingHyperlink, activeDocumentId, markups]);

  if (!pendingHyperlink) return null;

  const selectedDoc =
    openDocuments.find((d) => d.id === targetDocId) ||
    openDocuments.find((d) => d.id === activeDocumentId);
  const maxPages = Math.max(1, selectedDoc?.numPages || 1);

  const handleConfirm = () => {
    const clampedPage = Math.max(1, Math.min(maxPages, Number(targetPage) || 1));
    const docName = selectedDoc?.fileName || '';
    const desc =
      actionType === 'goto_page'
        ? `Vai a Pagina ${clampedPage}${targetDocId !== activeDocumentId && docName ? ` (${docName})` : ''}`
        : actionType === 'url'
        ? targetUrl.trim()
        : targetFilePath.trim();

    if (pendingHyperlink.existingMarkupId) {
      updateMarkup(pendingHyperlink.existingMarkupId, {
        actionType,
        targetDocId: actionType === 'goto_page' ? targetDocId : undefined,
        targetDocName: actionType === 'goto_page' ? docName : undefined,
        targetPage: actionType === 'goto_page' ? clampedPage : undefined,
        targetScale: actionType === 'goto_page' ? targetScale : undefined,
        targetUrl: actionType === 'url' ? targetUrl.trim() : undefined,
        targetFilePath: actionType === 'open_file' ? targetFilePath.trim() : undefined,
        contents: desc,
      } as any);
    } else {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const newLink: HyperlinkMarkup = {
        id,
        docId: 'primary',
        type: 'hyperlink',
        pageIndex: pendingHyperlink.pageIndex,
        author: currentUser || 'Utente',
        subject: 'Collegamento ipertestuale',
        contents: desc,
        creationDate: now,
        modificationDate: now,
        status: 'None',
        strokeColor: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.14,
        strokeWidth: 1.2,
        opacity: 0.9,
        boxRect: pendingHyperlink.boxRect,
        actionType,
        targetDocId: actionType === 'goto_page' ? targetDocId : undefined,
        targetDocName: actionType === 'goto_page' ? docName : undefined,
        targetPage: actionType === 'goto_page' ? clampedPage : undefined,
        targetScale: actionType === 'goto_page' ? targetScale : undefined,
        targetUrl: actionType === 'url' ? targetUrl.trim() : undefined,
        targetFilePath: actionType === 'open_file' ? targetFilePath.trim() : undefined,
      };
      addMarkup(newLink);
      selectMarkup(id);
    }

    setPendingHyperlink(null);
    setActiveTool('select');
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/65 flex items-center justify-center p-4 select-none">
      <div className="w-[560px] max-w-full bg-[#252526] border border-[#454545] rounded-lg shadow-2xl text-[#e0e0e0] text-xs overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#1e1e1e] border-b border-[#38383a]">
          <div className="flex items-center space-x-2 font-semibold text-white">
            <Link2 size={15} className="text-[#4cc2ff]" />
            <span>Azione — Collegamento ipertestuale</span>
          </div>
          <button
            onClick={() => setPendingHyperlink(null)}
            className="p-1 text-[#aaa] hover:text-white hover:bg-[#333] rounded"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4">
          <div className="border border-[#3c3c3c] rounded p-3.5 bg-[#1e1e1e]/60 space-y-4">
            <div className="text-[11px] font-semibold text-[#bbb]">Azione</div>

            {/* 1. Passa a Pagina / Documento */}
            <div className="space-y-2.5">
              <div className="grid grid-cols-[150px_1fr] items-center gap-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="hyperlinkAction"
                    checked={actionType === 'goto_page'}
                    onChange={() => setActionType('goto_page')}
                    className="accent-[#0078d4]"
                  />
                  <span>Passa a</span>
                </label>
                <select
                  value={targetDocId}
                  onFocus={() => setActionType('goto_page')}
                  onChange={(e) => {
                    setActionType('goto_page');
                    setTargetDocId(e.target.value);
                    setTargetPage(1);
                  }}
                  className="bg-[#181818] border border-[#444] rounded px-2 py-1 text-white focus:outline-none truncate"
                >
                  {openDocuments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fileName} ({d.numPages} pag.)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-[150px_1fr] items-center gap-2 pl-6">
                <span className="text-[#bbb]">Pagina</span>
                <div className="flex items-center space-x-3">
                  <input
                    type="number"
                    min={1}
                    max={maxPages}
                    value={targetPage}
                    onFocus={() => setActionType('goto_page')}
                    onChange={(e) =>
                      setTargetPage(Math.max(1, Math.min(maxPages, Number(e.target.value) || 1)))
                    }
                    className="w-20 bg-[#181818] border border-[#444] rounded px-2 py-1 text-white font-mono text-center"
                  />
                  <span className="text-[#888]">di {maxPages}</span>
                  <span className="text-[#bbb] ml-2">Scala:</span>
                  <select
                    value={targetScale}
                    onFocus={() => setActionType('goto_page')}
                    onChange={(e) => setTargetScale(e.target.value as 'fit_page' | 'keep_zoom')}
                    className="bg-[#181818] border border-[#444] rounded px-2 py-1 text-white focus:outline-none"
                  >
                    <option value="fit_page">Adatta a pagina</option>
                    <option value="keep_zoom">Mantieni zoom</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="h-px bg-[#333]" />

            {/* 2. Collegamento ipertestuale (URL Web) */}
            <div className="grid grid-cols-[150px_1fr] items-center gap-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="hyperlinkAction"
                  checked={actionType === 'url'}
                  onChange={() => setActionType('url')}
                  className="accent-[#0078d4]"
                />
                <span>Collegamento ipertestuale</span>
              </label>
              <input
                type="text"
                value={targetUrl}
                onFocus={() => setActionType('url')}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://www.esempio.it"
                className="bg-[#181818] border border-[#444] rounded px-2.5 py-1 text-white focus:outline-none focus:border-[#0078d4]"
              />
            </div>

            {/* 3. Apri file */}
            <div className="grid grid-cols-[150px_1fr] items-center gap-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="hyperlinkAction"
                  checked={actionType === 'open_file'}
                  onChange={() => setActionType('open_file')}
                  className="accent-[#0078d4]"
                />
                <span>Apri file</span>
              </label>
              <input
                type="text"
                value={targetFilePath}
                onFocus={() => setActionType('open_file')}
                onChange={(e) => setTargetFilePath(e.target.value)}
                placeholder="Percorso o nome file (es. allegato.pdf)"
                className="bg-[#181818] border border-[#444] rounded px-2.5 py-1 text-white focus:outline-none focus:border-[#0078d4]"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 px-4 py-2.5 bg-[#1e1e1e] border-t border-[#38383a]">
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-1.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded font-medium transition"
          >
            OK
          </button>
          <button
            type="button"
            onClick={() => setPendingHyperlink(null)}
            className="px-4 py-1.5 bg-[#2d2d30] hover:bg-[#3e3e42] text-white rounded border border-[#444] transition"
          >
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
};
