import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { BluebeamIcon } from '@/components/icons/BluebeamIcon';
import { ThumbnailsPanel } from './ThumbnailsPanel';
import { BookmarksPanel } from './BookmarksPanel';
import { MeasurementsPanel } from './MeasurementsPanel';
import { LayersPanel } from './LayersPanel';
import { SearchPanel } from './SearchPanel';
import { ToolChestSidebar } from '../tool-chest/ToolChestSidebar';
import { 
  Bookmark, 
  Wrench, 
  Ruler, 
  Layers,
  Search,
  ChevronLeft, 
  ChevronRight,
  LayoutGrid
} from 'lucide-react';

export const LeftPanelContainer: React.FC = () => {
  const { activeLeftPanel, setActiveLeftPanel } = useAppStore();
  const [panelWidth, setPanelWidth] = React.useState<number>(300);
  const isDraggingRef = React.useRef(false);

  const navItems = [
    {
      id: 'thumbnails' as const,
      label: 'Miniature Pagine (Alt+T)',
      icon: <LayoutGrid size={15} />,
    },
    {
      id: 'bookmarks' as const,
      label: 'Segnalibri (Alt+B)',
      icon: <Bookmark size={15} />,
    },
    {
      id: 'toolchest' as const,
      label: 'Tool Chest & Simboli (Alt+X)',
      icon: <Wrench size={15} />,
    },
    {
      id: 'measurements' as const,
      label: 'Misure & Takeoff (Alt+U)',
      icon: <Ruler size={15} />,
    },
    {
      id: 'layers' as const,
      label: 'Livelli / Layer (Alt+Y)',
      icon: <Layers size={15} />,
    },
    {
      id: 'search' as const,
      label: 'Cerca nel documento (Ctrl+F)',
      icon: <Search size={15} />,
    },
  ];

  const isOpen = activeLeftPanel !== 'none';

  // Gestione trascinamento ridimensionamento splitter (supporta mouse, penna e touch)
  const handlePointerDownResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startW = panelWidth;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const delta = moveEvent.clientX - startX;
      const newW = Math.max(180, Math.min(650, startW + delta));
      setPanelWidth(newW);
    };

    const onPointerUp = () => {
      isDraggingRef.current = false;
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerUp);
    };

    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerUp);
  };

  return (
    <div className="flex h-full z-20 shrink-0 select-none">
      {/* 1. Striscia Verticale a Icone Stile Bluebeam Revu (Width 38px) */}
      <div className="w-[38px] bg-[#1a1a1c] border-r border-[#303032] flex flex-col items-center py-2 space-y-1">
        {navItems.map((item) => {
          const isActive = activeLeftPanel === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveLeftPanel(item.id)}
              className={`w-7 h-7 rounded flex items-center justify-center transition ${
                isActive
                  ? 'bg-[#0078d4] text-white shadow ring-1 ring-white/30'
                  : 'text-[#888888] hover:text-white hover:bg-[#2a2a2c]'
              }`}
              title={item.label}
            >
              {item.icon}
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Pulsante per aprire/chiudere cassetto */}
        <button
          onClick={() => setActiveLeftPanel(isOpen ? 'none' : 'toolchest')}
          className="w-7 h-7 rounded flex items-center justify-center text-[#777] hover:text-white hover:bg-[#2a2a2c] transition"
          title={isOpen ? 'Comprimi pannello laterale' : 'Espandi pannello laterale'}
        >
          {isOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {/* 2. Cassetto Contenuto Pannello Attivo con Larghezza Ridimensionabile */}
      {isOpen && (
        <div 
          style={{ width: `${panelWidth}px` }}
          className="relative shrink-0 h-full bg-[#202022] border-r border-[#333333] flex flex-col overflow-hidden shadow-xl animate-in slide-in-from-left-2 duration-150"
        >
          {activeLeftPanel === 'thumbnails' && <ThumbnailsPanel />}
          {activeLeftPanel === 'bookmarks' && <BookmarksPanel />}
          {activeLeftPanel === 'toolchest' && <ToolChestSidebar />}
          {activeLeftPanel === 'measurements' && <MeasurementsPanel />}
          {activeLeftPanel === 'layers' && <LayersPanel />}
          {activeLeftPanel === 'search' && <SearchPanel />}

          {/* Maniglia splitter ridimensionamento a destra */}
          <div
            onPointerDown={handlePointerDownResize}
            style={{ touchAction: 'none' }}
            className="absolute top-0 right-0 w-2.5 h-full cursor-col-resize hover:bg-[#0078d4]/70 active:bg-[#0078d4] transition z-30"
            title="Trascina per allargare o stringere la paletta"
          />
        </div>
      )}
    </div>
  );
};
