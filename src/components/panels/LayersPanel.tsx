import React, { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Layers, Eye, EyeOff, Lock, Unlock, Plus, Trash2, ArrowRightCircle, Check, ArrowUp, ArrowDown } from 'lucide-react';

export const LayersPanel: React.FC = () => {
  const {
    layers,
    activeLayerId,
    setActiveLayerId,
    createLayer,
    renameLayer,
    deleteLayer,
    toggleLayerVisibility,
    toggleLayerLock,
    moveLayer,
    assignMarkupsToLayer,
    markups,
    selectedMarkupIds,
    selectMultipleMarkups,
  } = useAppStore();

  const [newLayerName, setNewLayerName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [targetMoveLayerId, setTargetMoveLayerId] = useState<string>('default');

  const handleCreate = () => {
    const id = createLayer(newLayerName);
    setActiveLayerId(id);
    setTargetMoveLayerId(id);
    setNewLayerName('');
  };

  return (
    <div className="w-full h-full bg-[#202022] flex flex-col text-[#d4d4d4] select-none">
      {/* Intestazione */}
      <div className="px-3 py-2 border-b border-[#141416] flex items-center justify-between bg-[#252528]">
        <div className="flex items-center space-x-1.5">
          <Layers size={14} className="text-[#00a8ff]" />
          <span className="text-xs font-semibold tracking-wide text-white">Livelli (Layer)</span>
        </div>
        <span className="text-[10px] text-[#888] font-mono">{layers.length} livelli</span>
      </div>

      {/* Crea nuovo livello */}
      <div className="p-2 border-b border-[#141416] bg-[#1b1b1d] space-y-2">
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={newLayerName}
            onChange={(e) => setNewLayerName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            placeholder="Nome nuovo livello..."
            className="flex-1 px-2 py-1 bg-[#252528] border border-[#333338] focus:border-[#0078d4] rounded text-[11px] text-white placeholder-[#777] outline-none"
          />
          <button
            onClick={handleCreate}
            className="px-2 py-1 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded text-[11px] font-medium flex items-center gap-1 transition"
            title="Crea nuovo livello"
          >
            <Plus size={12} />
            <span>Crea</span>
          </button>
        </div>

        {/* Azione rapida: Sposta oggetti selezionati su un altro livello */}
        {selectedMarkupIds.length > 0 && (
          <div className="p-1.5 bg-[#162636] border border-[#0078d4]/60 rounded space-y-1">
            <div className="text-[10px] text-[#50e6ff] font-semibold">
              Sposta {selectedMarkupIds.length} {selectedMarkupIds.length === 1 ? 'oggetto selezionato' : 'oggetti selezionati'} su:
            </div>
            <div className="flex items-center gap-1">
              <select
                value={targetMoveLayerId}
                onChange={(e) => setTargetMoveLayerId(e.target.value)}
                className="flex-1 bg-[#1e1e22] border border-[#3a3a42] rounded px-1.5 py-1 text-[10px] text-white outline-none"
              >
                {layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => assignMarkupsToLayer(selectedMarkupIds, targetMoveLayerId)}
                className="px-2 py-1 bg-[#107c41] hover:bg-[#15964f] text-white rounded text-[10px] font-semibold flex items-center gap-1 transition"
              >
                <ArrowRightCircle size={11} />
                <span>Sposta</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lista livelli */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {layers.map((layer, layerIdx) => {
          const isActive = activeLayerId === layer.id;
          const count = markups.filter((m) => (m.layerId || 'default') === layer.id).length;

          return (
            <div
              key={layer.id}
              onClick={() => setActiveLayerId(layer.id)}
              className={`group flex items-center gap-1.5 px-2 py-1.5 rounded border cursor-pointer transition ${
                isActive
                  ? 'bg-[#0078d4]/20 border-[#0078d4] text-white'
                  : 'bg-[#252528] border-[#2e2e32] hover:bg-[#2d2d32] text-[#cccccc]'
              }`}
              title="Clicca per impostare come livello attivo (i nuovi disegni andranno qui)"
            >
              {/* Visibilità (Occhio) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLayerVisibility(layer.id);
                }}
                className={`p-0.5 rounded hover:bg-[#3a3a40] ${
                  layer.visible ? 'text-[#50e6ff]' : 'text-[#666]'
                }`}
                title={layer.visible ? 'Nascondi livello' : 'Mostra livello'}
              >
                {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>

              {/* Blocco (Lucchetto) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLayerLock(layer.id);
                }}
                className={`p-0.5 rounded hover:bg-[#3a3a40] ${
                  layer.locked ? 'text-[#f59e0b]' : 'text-[#666] hover:text-[#bbb]'
                }`}
                title={layer.locked ? 'Sblocca livello' : 'Blocca livello'}
              >
                {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>

              {/* Nome livello */}
              <div className="flex-1 min-w-0">
                {editingId === layer.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      autoFocus
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          renameLayer(layer.id, editingName);
                          setEditingId(null);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      onBlur={() => {
                        renameLayer(layer.id, editingName);
                        setEditingId(null);
                      }}
                      className="w-full px-1 py-0.5 bg-[#18181a] border border-[#0078d4] rounded text-[11px] text-white outline-none"
                    />
                    <button
                      onClick={() => {
                        renameLayer(layer.id, editingName);
                        setEditingId(null);
                      }}
                      className="text-[#4ade80]"
                    >
                      <Check size={12} />
                    </button>
                  </div>
                ) : (
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingId(layer.id);
                      setEditingName(layer.name);
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <span className="truncate text-[11px] font-medium">{layer.name}</span>
                    {isActive && (
                      <span className="text-[9px] px-1 py-0.2 bg-[#0078d4] text-white rounded font-semibold shrink-0">
                        Attivo
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Conteggio oggetti (clicca per selezionare tutti gli oggetti del livello) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const ids = markups
                    .filter((m) => (m.layerId || 'default') === layer.id)
                    .map((m) => m.id);
                  if (ids.length > 0) selectMultipleMarkups(ids, false);
                }}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1a1a1c] text-[#aaa] hover:text-white hover:bg-[#38383e]"
                title="Clicca per selezionare tutti gli oggetti su questo livello"
              >
                {count}
              </button>

              {/* Sposta livello su / giù */}
              <div className="flex items-center opacity-40 group-hover:opacity-100 transition">
                <button
                  type="button"
                  disabled={layerIdx === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    moveLayer(layer.id, 'up');
                  }}
                  className={`p-0.5 rounded hover:bg-[#3a3a40] ${
                    layerIdx === 0 ? 'opacity-25 pointer-events-none' : 'text-[#bbb] hover:text-white'
                  }`}
                  title="Sposta livello in su"
                >
                  <ArrowUp size={11} />
                </button>
                <button
                  type="button"
                  disabled={layerIdx === layers.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    moveLayer(layer.id, 'down');
                  }}
                  className={`p-0.5 rounded hover:bg-[#3a3a40] ${
                    layerIdx === layers.length - 1 ? 'opacity-25 pointer-events-none' : 'text-[#bbb] hover:text-white'
                  }`}
                  title="Sposta livello in giù"
                >
                  <ArrowDown size={11} />
                </button>
              </div>

              {/* Elimina livello (tranne Predefinito) */}
              {layer.id !== 'default' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteLayer(layer.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-[#888] hover:text-[#f87171] transition"
                  title="Elimina livello (gli oggetti tornano su Predefinito)"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-3 py-1.5 border-t border-[#141416] text-[10px] text-[#777] bg-[#1a1a1c]">
        Doppio clic sul nome per rinominare. Clic destro sugli oggetti per spostarli di livello.
      </div>
    </div>
  );
};
