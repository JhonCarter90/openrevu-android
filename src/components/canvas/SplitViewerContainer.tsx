import React, { useRef, useState } from 'react';
import { SplitNode, useAppStore } from '@/store/useAppStore';
import { PDFViewerCanvas } from './PDFViewerCanvas';
import { GripVertical, GripHorizontal } from 'lucide-react';

interface SplitNodeViewProps {
  node: SplitNode;
  isRootSplit: boolean;
}

const SplitNodeView: React.FC<SplitNodeViewProps> = ({ node, isRootSplit }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const updateSplitNodeRatio = useAppStore((s) => s.updateSplitNodeRatio);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);

  if (node.type === 'leaf') {
    const isActive = activePaneId === node.id;
    return (
      <div
        onMouseDownCapture={() => {
          if (activePaneId !== node.id) {
            setActivePaneId(node.id);
          }
        }}
        className={`flex-1 h-full w-full overflow-hidden relative flex ${
          isRootSplit
            ? isActive
              ? 'ring-1 ring-inset ring-[#0078d4]'
              : 'ring-1 ring-inset ring-[#2a2a2d]'
            : ''
        }`}
      >
        <PDFViewerCanvas
          paneId={node.id === 'primary' ? 'primary' : 'secondary'}
          splitPaneId={node.id}
        />
      </div>
    );
  }

  const isVertical = node.direction === 'vertical';

  const handleMouseDownSplitter = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSplitter(true);

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (isVertical) {
        const ratio = (moveEvent.clientX - rect.left) / rect.width;
        updateSplitNodeRatio(node.id, ratio);
      } else {
        const ratio = (moveEvent.clientY - rect.top) / rect.height;
        updateSplitNodeRatio(node.id, ratio);
      }
    };

    const onMouseUp = () => {
      setIsDraggingSplitter(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      ref={containerRef}
      className={`flex-1 h-full w-full overflow-hidden relative flex min-w-0 min-h-0 ${
        isVertical ? 'flex-row' : 'flex-col'
      } ${
        isDraggingSplitter
          ? isVertical
            ? 'cursor-col-resize select-none'
            : 'cursor-row-resize select-none'
          : ''
      }`}
    >
      <div
        style={{
          flexBasis: `${node.ratio * 100}%`,
          flexGrow: 0,
          flexShrink: 0,
        }}
        className="overflow-hidden relative flex min-w-0 min-h-0"
      >
        <SplitNodeView node={node.first} isRootSplit={true} />
      </div>

      <div
        onMouseDown={handleMouseDownSplitter}
        onDoubleClick={() => updateSplitNodeRatio(node.id, 0.5)}
        title="Trascina per ridimensionare i riquadri (Doppio clic: 50/50)"
        className={`bg-[#252526] hover:bg-[#0078d4] transition-colors flex items-center justify-center z-20 select-none shrink-0 ${
          isVertical
            ? 'w-1.5 h-full cursor-col-resize border-l border-r border-[#333333]'
            : 'h-1.5 w-full cursor-row-resize border-t border-b border-[#333333]'
        } ${isDraggingSplitter ? 'bg-[#0078d4]' : ''}`}
      >
        {isVertical ? (
          <GripVertical size={9} className="text-[#888888] pointer-events-none" />
        ) : (
          <GripHorizontal size={9} className="text-[#888888] pointer-events-none" />
        )}
      </div>

      <div
        style={{
          flexBasis: `${(1 - node.ratio) * 100}%`,
          flexGrow: 1,
          flexShrink: 1,
        }}
        className="overflow-hidden relative flex min-w-0 min-h-0"
      >
        <SplitNodeView node={node.second} isRootSplit={true} />
      </div>
    </div>
  );
};

export const SplitViewerContainer: React.FC = () => {
  const splitTree = useAppStore((s) => s.splitTree);

  if (splitTree.type === 'leaf') {
    return (
      <div className="flex-1 h-full w-full overflow-hidden relative flex">
        <PDFViewerCanvas paneId="primary" splitPaneId={splitTree.id} />
      </div>
    );
  }

  return <SplitNodeView node={splitTree} isRootSplit={true} />;
};
