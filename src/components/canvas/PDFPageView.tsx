import React, { useEffect, useRef, useState } from 'react';
import { PDFPageInfo } from '@/types/pdf';
import { AnyMarkup, MarkupType, ScaleCalibration } from '@/types/markup';
import { PDFManager } from '@/core/pdf/pdfManager';
import { MarkupRenderer } from '@/core/markup/markupRenderer';
import { useAppStore } from '@/store/useAppStore';

export interface ExtractedTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  rawFontName?: string;
}

interface PDFPageViewProps {
  pageIndex: number;
  pageInfo: PDFPageInfo;
  scale: number;
  rotation: number;
  docId: string;
  fileBytes: Uint8Array | null;
  markups: AnyMarkup[];
  selectedMarkupIds: string[];
  scaleCalibration: ScaleCalibration | null;
  isActivePage: boolean;
  isVisible: boolean;
  activeTool: MarkupType;
  onTextEditClick: (item: ExtractedTextItem, pageIndex: number) => void;
  onPageClick?: (pageIndex: number) => void;
}

export const PDFPageView: React.FC<PDFPageViewProps> = ({
  pageIndex,
  pageInfo,
  scale,
  rotation,
  docId,
  fileBytes,
  markups,
  selectedMarkupIds,
  scaleCalibration,
  isActivePage,
  isVisible,
  activeTool,
  onTextEditClick,
  onPageClick,
}) => {
  const pageDivRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const hiResTileCanvasRef = useRef<HTMLCanvasElement>(null);
  const markupCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticMarkupCacheRef = useRef<{
    canvas: HTMLCanvasElement;
    key: string;
    staticRefs: AnyMarkup[];
  } | null>(null);
  const [textItems, setTextItems] = useState<ExtractedTextItem[]>([]);
  const [tileRect, setTileRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const hasRenderedRef = useRef<boolean>(false);
  const searchResults = useAppStore((s) => s.searchResults);
  const activeSearchResultId = useAppStore((s) => s.activeSearchResultId);
  const pageSearchHighlights = searchResults.filter(
    (r) => r.docId === docId && r.pageIndex === pageIndex
  );

  const normRotation = ((rotation % 360) + 360) % 360;
  const isQuarterTurn = normRotation === 90 || normRotation === 270;
  const width = Math.floor((isQuarterTurn ? pageInfo.height : pageInfo.width) * scale);
  const height = Math.floor((isQuarterTurn ? pageInfo.width : pageInfo.height) * scale);

  // Reset del flag di primo rendering e del tile al cambio di documento, pagina o rotazione
  useEffect(() => {
    hasRenderedRef.current = false;
    setTileRect(null);
  }, [fileBytes, docId, pageIndex, rotation, pageInfo.rotation, pageInfo.width, pageInfo.height]);

  // 1. Rendering della pagina PDF con double-buffering offscreen e debounce sullo zoom
  // Mantiene il canvas visibile scalato in GPU a 60 FPS senza flash bianchi durante lo zoom
  useEffect(() => {
    if (!isVisible || !fileBytes || !pdfCanvasRef.current) return;

    let isMounted = true;
    let handle: { cancel: () => void; promise: Promise<void> } | null = null;

    const executeRender = async () => {
      try {
        const pdfManager = PDFManager.getInstance();
        await pdfManager.ensureDocumentLoaded(docId, fileBytes);

        if (!isMounted || !pdfCanvasRef.current) return;

        // Renderizza su un canvas offscreen così il canvas visibile non viene mai cancellato durante l'attesa
        const offscreen = document.createElement('canvas');
        handle = pdfManager.renderPage(
          offscreen,
          pageIndex + 1,
          scale,
          rotation,
          docId
        );
        await handle.promise;
        if (!isMounted || !pdfCanvasRef.current) return;

        const target = pdfCanvasRef.current;
        target.width = offscreen.width;
        target.height = offscreen.height;
        const tCtx = target.getContext('2d', { alpha: false });
        if (tCtx) {
          tCtx.drawImage(offscreen, 0, 0);
        }
        hasRenderedRef.current = true;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn(`Errore render pagina ${pageIndex + 1}:`, err);
        }
      }
    };

    // Primo rendering immediato; durante lo zoom continuo usa un debounce leggero (100ms)
    const delay = hasRenderedRef.current ? 100 : 0;
    const timer = window.setTimeout(executeRender, delay);

    return () => {
      isMounted = false;
      window.clearTimeout(timer);
      if (handle) {
        try {
          handle.cancel();
        } catch (e) {}
      }
    };
  }, [isVisible, fileBytes, pageIndex, scale, rotation, docId, pageInfo.rotation, pageInfo.width, pageInfo.height]);

  // 1b. Motore Rev 2 Hi-Res Viewport Tile: quando la pagina supera il budget VRAM base (es. A0/A1 ad alto zoom),
  // renderizza a nitidezza vettoriale 1:1 HiDPI solo la porzione visibile sullo schermo.
  useEffect(() => {
    if (!isVisible || !fileBytes) {
      setTileRect(null);
      return;
    }
    const baseMetrics = PDFManager.computeSafeCanvasMetrics(width, height);
    if (!baseMetrics.isCapped) {
      setTileRect(null);
      return;
    }

    let isMounted = true;
    let handle: { cancel: () => void; promise: Promise<void> } | null = null;
    let timer: number | null = null;

    const scheduleTileRender = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (!isMounted || !pageDivRef.current) return;
        const rect = pageDivRef.current.getBoundingClientRect();
        const winW = window.innerWidth || 1280;
        const winH = window.innerHeight || 800;

        // Intersezione della pagina con la finestra visibile (con piccolo margine di pre-caricamento 96px)
        const pad = 96;
        const visLeft = Math.max(0, Math.floor(-rect.left - pad));
        const visTop = Math.max(0, Math.floor(-rect.top - pad));
        const visRight = Math.min(width, Math.ceil(winW - rect.left + pad));
        const visBottom = Math.min(height, Math.ceil(winH - rect.top + pad));
        const regW = visRight - visLeft;
        const regH = visBottom - visTop;

        if (regW < 16 || regH < 16) {
          setTileRect(null);
          return;
        }

        try {
          const pdfManager = PDFManager.getInstance();
          await pdfManager.ensureDocumentLoaded(docId, fileBytes);
          if (!isMounted) return;

          const offTile = document.createElement('canvas');
          handle = pdfManager.renderPageRegion(
            offTile,
            pageIndex + 1,
            scale,
            rotation,
            { x: visLeft, y: visTop, width: regW, height: regH },
            docId
          );
          await handle.promise;
          if (!isMounted) return;

          setTileRect({ x: visLeft, y: visTop, width: regW, height: regH });
          requestAnimationFrame(() => {
            if (!isMounted || !hiResTileCanvasRef.current) return;
            const target = hiResTileCanvasRef.current;
            target.width = offTile.width;
            target.height = offTile.height;
            const tCtx = target.getContext('2d', { alpha: false });
            if (tCtx) {
              tCtx.drawImage(offTile, 0, 0);
            }
          });
        } catch (err: any) {
          if (err?.name !== 'RenderingCancelledException') {
            console.warn(`Errore render tile pagina ${pageIndex + 1}:`, err);
          }
        }
      }, 150);
    };

    scheduleTileRender();
    const onViewportChange = () => scheduleTileRender();
    window.addEventListener('pointerup', onViewportChange);
    window.addEventListener('wheel', onViewportChange, { passive: true });
    window.addEventListener('resize', onViewportChange);

    return () => {
      isMounted = false;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('pointerup', onViewportChange);
      window.removeEventListener('wheel', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
      if (handle) {
        try {
          handle.cancel();
        } catch {}
      }
    };
  }, [isVisible, fileBytes, pageIndex, scale, rotation, docId, width, height]);

  const canInteractWithText = activeTool === 'select_text' || activeTool === 'edit_pdf_text';

  // 2. Estrazione testo per TextLayer (SOLO quando è attivo lo strumento Seleziona Testo o Modifica Testo PDF)
  useEffect(() => {
    if (!isVisible || !fileBytes || !canInteractWithText) return;
    let isMounted = true;

    (async () => {
      try {
        const pdfManager = PDFManager.getInstance();
        await pdfManager.ensureDocumentLoaded(docId, fileBytes);
        const items = await pdfManager.getPageTextItems(pageIndex + 1, docId);
        if (isMounted) setTextItems(items);
      } catch (e) {
        console.warn(`Errore estrazione testo pagina ${pageIndex + 1}:`, e);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isVisible, fileBytes, pageIndex, docId, canInteractWithText]);

  // 3. Rendering dei markup su canvas sovrapposto con Cache Offscreen dei markup statici (60 FPS su P&ID densi)
  useEffect(() => {
    const canvas = markupCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const desiredDpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const metrics = PDFManager.computeSafeCanvasMetrics(width, height, desiredDpr);
    if (canvas.width !== metrics.pixelWidth || canvas.height !== metrics.pixelHeight) {
      canvas.width = metrics.pixelWidth;
      canvas.height = metrics.pixelHeight;
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const pageMarkups = markups.filter((m) => (m.pageIndex !== undefined ? m.pageIndex : 0) === pageIndex);
    const selSet = new Set(selectedMarkupIds);
    const staticMarkups = pageMarkups.filter((m) => !selSet.has(m.id));
    const activeMarkups = pageMarkups.filter((m) => selSet.has(m.id));

    const cacheKey = `${metrics.pixelWidth}x${metrics.pixelHeight}_${scale}_${scaleCalibration?.scaleRatio || 0}`;
    const prevCache = staticMarkupCacheRef.current;
    const isStaticUnchanged =
      prevCache &&
      prevCache.key === cacheKey &&
      prevCache.staticRefs.length === staticMarkups.length &&
      prevCache.staticRefs.every((m, idx) => m === staticMarkups[idx]);

    let cacheCanvas: HTMLCanvasElement;
    if (isStaticUnchanged && prevCache) {
      cacheCanvas = prevCache.canvas;
    } else {
      cacheCanvas = prevCache?.canvas || document.createElement('canvas');
      cacheCanvas.width = metrics.pixelWidth;
      cacheCanvas.height = metrics.pixelHeight;
      const cCtx = cacheCanvas.getContext('2d');
      if (cCtx) {
        cCtx.save();
        cCtx.clearRect(0, 0, metrics.pixelWidth, metrics.pixelHeight);
        cCtx.imageSmoothingEnabled = true;
        cCtx.imageSmoothingQuality = 'high';
        cCtx.scale(metrics.effectiveDpr * scale, metrics.effectiveDpr * scale);
        staticMarkups.forEach((m) => {
          MarkupRenderer.renderMarkup(cCtx, m, false, scaleCalibration, scale);
        });
        cCtx.restore();
      }
      staticMarkupCacheRef.current = {
        canvas: cacheCanvas,
        key: cacheKey,
        staticRefs: staticMarkups,
      };
    }

    ctx.clearRect(0, 0, metrics.pixelWidth, metrics.pixelHeight);
    ctx.drawImage(cacheCanvas, 0, 0);

    if (activeMarkups.length > 0) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.scale(metrics.effectiveDpr * scale, metrics.effectiveDpr * scale);
      activeMarkups.forEach((m) => {
        MarkupRenderer.renderMarkup(ctx, m, true, scaleCalibration, scale);
      });
      ctx.restore();
    }
  }, [markups, selectedMarkupIds, pageIndex, scale, width, height, scaleCalibration]);

  return (
    <div
      ref={pageDivRef}
      data-page-index={pageIndex}
      onClick={() => onPageClick?.(pageIndex)}
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
      className={`relative bg-white shadow-2xl select-none ${
        isActivePage
          ? 'ring-2 ring-[#0078d4] shadow-[0_0_25px_rgba(0,120,212,0.35)]'
          : 'ring-1 ring-black/30'
      }`}
    >
      {/* Canvas Pagina PDF Base - object-contain impedisce qualsiasi stiramento durante i cambi di rotazione */}
      <canvas
        ref={pdfCanvasRef}
        data-canvas-role="pdf-base"
        style={{ display: isVisible ? 'block' : 'none' }}
        className="w-full h-full bg-white object-contain"
      />
      {/* Overlay Tile Hi-Res Viewport (Rev 2) per zoom profondo su tavole CAD A0/A1 */}
      {isVisible && tileRect && (
        <canvas
          ref={hiResTileCanvasRef}
          data-canvas-role="pdf-tile"
          style={{
            position: 'absolute',
            left: `${tileRect.x}px`,
            top: `${tileRect.y}px`,
            width: `${tileRect.width}px`,
            height: `${tileRect.height}px`,
          }}
          className="pointer-events-none"
        />
      )}
      {!isVisible && (
        /* Placeholder leggero fuori dal viewport per risparmio RAM/VRAM */
        <div className="w-full h-full bg-white flex items-center justify-center text-gray-300 font-mono text-sm">
          Pagina {pageIndex + 1}
        </div>
      )}

      {/* Livello Testo Selezionabile (Copia/Incolla nativo & Modifica Testo Originale) */}
      {isVisible && canInteractWithText && textItems.length > 0 && (
        <div
          className="absolute inset-0 select-text overflow-hidden pointer-events-auto"
        >
          {textItems.map((item, idx) => (
            <span
              key={idx}
              style={{
                position: 'absolute',
                left: `${item.x * scale}px`,
                top: `${item.y * scale}px`,
                width: `${item.width * scale}px`,
                height: `${item.height * scale}px`,
                fontSize: `${item.fontSize * scale}px`,
                lineHeight: `${item.height * scale}px`,
                fontFamily: item.fontFamily || 'sans-serif',
                fontWeight: item.fontWeight || 'normal',
                fontStyle: item.fontStyle || 'normal',
                color: 'transparent',
                transformOrigin: 'top left',
                userSelect: 'text',
                whiteSpace: 'pre',
                cursor: activeTool === 'edit_pdf_text' ? 'pointer' : 'text',
              }}
              className={
                activeTool === 'edit_pdf_text'
                  ? 'hover:bg-[#0078d4]/35 hover:ring-1 hover:ring-[#0078d4] rounded-xs transition-colors'
                  : 'selection:bg-[#0078d4]/40 selection:text-transparent'
              }
              title={
                activeTool === 'edit_pdf_text'
                  ? `Clicca per modificare testo originale: "${item.str}"`
                  : undefined
              }
              onClick={(e) => {
                if (activeTool === 'edit_pdf_text') {
                  e.stopPropagation();
                  onTextEditClick(item, pageIndex);
                }
              }}
            >
              {item.str}
            </span>
          ))}
        </div>
      )}

      {/* Evidenziazione Risultati Ricerca Testo (Ctrl+F) */}
      {isVisible && pageSearchHighlights.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {pageSearchHighlights.map((hit) => {
            const isActiveHit = hit.id === activeSearchResultId;
            return (
              <div
                key={hit.id}
                style={{
                  position: 'absolute',
                  left: `${hit.rect.x * scale - 2}px`,
                  top: `${hit.rect.y * scale - 2}px`,
                  width: `${Math.max(12, hit.rect.width * scale + 4)}px`,
                  height: `${Math.max(12, hit.rect.height * scale + 4)}px`,
                }}
                className={
                  isActiveHit
                    ? 'bg-[#ff8c00]/45 ring-2 ring-[#ff6a00] rounded-xs shadow-[0_0_12px_rgba(255,106,0,0.75)]'
                    : 'bg-[#ffe600]/40 ring-1 ring-[#f59e0b]/80 rounded-xs'
                }
              />
            );
          })}
        </div>
      )}

      {/* Canvas Markup Sovrapposto */}
      <canvas ref={markupCanvasRef} data-canvas-role="markup" className="absolute inset-0 pointer-events-none" />

      {/* Etichetta Pagina discreta in basso a sinistra (stile Bluebeam) */}
      <div className="absolute bottom-1 left-1.5 px-1 py-0.5 bg-black/60 text-white font-mono text-[9px] rounded pointer-events-none opacity-40 hover:opacity-100 transition-opacity">
        {pageInfo.label ? `${pageInfo.label} (Pag. ${pageIndex + 1})` : `Pagina ${pageIndex + 1}`}
      </div>
    </div>
  );
};
