import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore, extractFormatStyle } from '@/store/useAppStore';
import { PDFManager } from '@/core/pdf/pdfManager';
import { CoordinateTransformer } from '@/core/viewport/coordinateTransformer';
import { MarkupRenderer } from '@/core/markup/markupRenderer';
import { HatchRenderer } from '@/core/markup/hatchRenderer';
import { CloudGenerator } from '@/core/markup/cloudGenerator';
import { ScaleManager } from '@/core/scale/scaleManager';
import { SnapManager, SnapTarget } from '@/core/snapping/snapManager';
import { PdfVectorSnapExtractor } from '@/core/snapping/pdfVectorSnapExtractor';
import { HitTester, HandleHit } from '@/core/markup/hitTester';
import { recognizeFreehandShape } from '@/core/markup/shapeRecognizer';
import { TextLayoutHelper } from '@/core/markup/textLayoutHelper';
import { PDFPageView, ExtractedTextItem } from './PDFPageView';
import { BluebeamContextMenu, ContextMenuState } from './BluebeamContextMenu';
import { 
  Point2D, 
  AnyMarkup, 
  CloudMarkup, 
  CloudPlusMarkup,
  RectangleMarkup, 
  EllipseMarkup, 
  CalloutMarkup, 
  TextMarkup, 
  LineMarkup, 
  PolylineMarkup, 
  PolygonMarkup, 
  MeasureLengthMarkup, 
  MeasurePolylineMarkup, 
  MeasureAreaMarkup, 
  MeasureCountMarkup, 
  StampMarkup 
} from '@/types/markup';
import { CalibrationModal } from '../scale/CalibrationModal';
import { BluebeamIcon } from '@/components/icons/BluebeamIcon';
import {
  insertImageDataUrlToPdf,
  setClipboardImageDataUrl,
  getClipboardImageDataUrl,
  getClipboardImageSize,
} from '@/core/utils/imageImport';
import { FileUp, X } from 'lucide-react';

interface InlineEditorState {
  markupId: string;
  subPathIndex?: number;
  boxRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  text: string;
}

export interface PDFViewerCanvasProps {
  paneId?: 'primary' | 'secondary';
  splitPaneId?: string;
}

export const PDFViewerCanvas: React.FC<PDFViewerCanvasProps> = ({ paneId = 'primary', splitPaneId }) => {
  const effectivePaneId = splitPaneId || paneId;
  const containerRef = useRef<HTMLDivElement>(null);
  const markupCanvasRef = useRef<HTMLCanvasElement>(null);
  const inlineTextareaRef = useRef<HTMLTextAreaElement>(null);
  const secondaryFileInputRef = useRef<HTMLInputElement>(null);
  const lastPageChangeTime = useRef<number>(0);
  const inlineEditorOpenTimeRef = useRef<number>(0);
  const hasPushedDragUndoRef = useRef<boolean>(false);
  const editingMarkupIdRef = useRef<string | null>(null);
  const isWheelingRef = useRef(false);
  const wheelTimerRef = useRef<any>(null);
  const lastProgrammaticPageRef = useRef<number>(1);
  const pendingTextEditRef = useRef<{
    pageIndex: number;
    originalRect: { x: number; y: number; width: number; height: number };
    fontSize: number;
    fontFamily: string;
    fontWeight?: 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    originalText: string;
  } | null>(null);

  const isSecondary = paneId === 'secondary';

  const {
    layers,
    fileName: primaryFileName,
    fileBytes: primaryFileBytes,
    currentPage: primaryCurrentPage,
    pagesInfo: primaryPagesInfo,
    numPages: primaryNumPages,
    viewport: primaryViewport,
    setViewport: setPrimaryViewport,
    setCurrentPage: setPrimaryCurrentPage,

    secondaryFileName,
    secondaryFileBytes,
    secondaryCurrentPage,
    secondaryPagesInfo,
    secondaryNumPages,
    secondaryViewport,
    secondaryDocumentId,
    setSecondaryViewport,
    setSecondaryCurrentPage,
    setSecondaryPDFDocument,
    setSecondaryFromOpenDoc,
    closeSecondaryDocument,
    activeDocumentId,
    openDocuments,
    switchDocument,
    splitMode,
    splitTree,
    activePaneId,
    splitActivePane,
    closeSplitPane,
    setSplitMode,
    syncSplitViews,
    setSyncSplitViews,

    activeTool,
    setActiveTool,
    activeColor,
    activeFillColor,
    activeFillOpacity,
    activeStrokeWidth,
    activeOpacity,
    activeLineStyle,
    activeLineStyleScale,
    activeHatchPattern,
    activeHatchColor,
    activeHatchScale,
    activeHatchAngle,
    activeStartHead,
    activeEndHead,
    activeFontSize,
    activeFontFamily,
    activeTextAlign,
    activeVerticalAlign,
    autoSizeSelectedMarkups,
    snapEnabled,
    orthoEnabled,
    currentUser,
    markups,
    selectedMarkupIds,
    formatPainterStyle,
    setFormatPainterStyle,
    applyFormatStyleToMarkups,
    addMarkup,
    updateMarkup,
    selectMarkup,
    selectMultipleMarkups,
    selectFenceMode,
    setSelectFenceMode,
    addingCalloutLeaderId,
    setAddingCalloutLeaderId,
    groupSelectedMarkups,
    ungroupSelectedMarkup,
    saveSelectedToToolChest,
    deleteMarkup,
    scaleCalibration,
    activeToolChestMarkup,
    setActiveToolChestMarkup,
    mouseWheelMode,
    pageViewMode,
    isSelectingAutoMarkRegion,
    setIsSelectingAutoMarkRegion,
    setAutoMarkPendingRegion,
  } = useAppStore();

  const isSplitActive = splitTree.type === 'split';
  const isActiveSplitPane = activePaneId === effectivePaneId;

  // Stato indipendente per ciascun riquadro secondario (consente 3, 4 o più viste divise con pagina e zoom propri)
  const [paneLocalPage, setPaneLocalPage] = useState<number>(() =>
    isSecondary ? (secondaryCurrentPage || primaryCurrentPage || 1) : primaryCurrentPage
  );
  const [paneLocalViewport, setPaneLocalViewport] = useState<typeof primaryViewport>(() =>
    isSecondary ? { ...primaryViewport } : primaryViewport
  );

  const fileBytes = isSecondary && secondaryFileBytes ? secondaryFileBytes : primaryFileBytes;
  const fileName = isSecondary && secondaryFileName ? secondaryFileName : primaryFileName;
  const currentPage = isSecondary ? paneLocalPage : primaryCurrentPage;
  const numPages = isSecondary && secondaryNumPages > 0 ? secondaryNumPages : primaryNumPages;
  const pagesInfo = isSecondary && secondaryPagesInfo.length > 0 ? secondaryPagesInfo : primaryPagesInfo;
  const viewport = isSecondary
    ? (syncSplitViews ? primaryViewport : paneLocalViewport)
    : primaryViewport;
  const setViewport = useCallback(
    (transform: Partial<typeof primaryViewport>) => {
      if (!isSecondary) {
        setPrimaryViewport(transform);
      } else if (syncSplitViews) {
        setPrimaryViewport(transform);
        setPaneLocalViewport((prev) => ({ ...prev, ...transform }));
      } else {
        setPaneLocalViewport((prev) => ({ ...prev, ...transform }));
      }
    },
    [isSecondary, syncSplitViews, setPrimaryViewport]
  );
  const setCurrentPage = useCallback(
    (page: number) => {
      if (!isSecondary) {
        setPrimaryCurrentPage(page);
      } else {
        setPaneLocalPage(page);
        setSecondaryCurrentPage(page);
      }
    },
    [isSecondary, setPrimaryCurrentPage, setSecondaryCurrentPage]
  );
  const docId = isSecondary
    ? (secondaryDocumentId || (secondaryFileBytes ? 'secondary' : (activeDocumentId !== 'home' ? activeDocumentId : 'primary')))
    : (activeDocumentId !== 'home' ? activeDocumentId : 'primary');

  // Filtra con precisione se un markup appartiene al documento/riquadro visualizzato ed è su un livello visibile
  const isMarkupBelongingToPane = useCallback(
    (m: AnyMarkup) => {
      const layer = layers.find((l) => l.id === (m.layerId || 'default'));
      if (layer && !layer.visible) return false;
      const mPageIndex = m.pageIndex !== undefined ? m.pageIndex : 0;
      if (pageViewMode === 'single' && mPageIndex !== currentPage - 1) return false;
      if (!isSecondary) {
        return !m.docId || m.docId === 'primary' || m.docId === docId;
      }
      return m.docId === 'secondary' || m.docId === docId || (!secondaryFileBytes && !secondaryDocumentId);
    },
    [layers, pageViewMode, currentPage, docId, isSecondary, secondaryFileBytes, secondaryDocumentId]
  );

  const paneMarkups = useMemo(
    () => markups.filter(isMarkupBelongingToPane),
    [markups, isMarkupBelongingToPane]
  );

  const handleOpenSecondaryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(buffer);
      const pdfManager = PDFManager.getInstance();
      const { numPages, pagesInfo } = await pdfManager.loadDocument(uint8, 'secondary');

      setSecondaryPDFDocument(file.name, uint8, numPages, pagesInfo);
    } catch (err) {
      console.error('Errore apertura secondo PDF:', err);
      alert('Impossibile aprire il file PDF secondario.');
    }
  };

  // Stato Panoramica
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point2D>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);

  // Stato Spostamento / Move delle Entità Selezionate (Stile Bluebeam)
  const [isMovingMarkups, setIsMovingMarkups] = useState(false);
  const [moveStartPt, setMoveStartPt] = useState<Point2D | null>(null);
  const [moveSnapshots, setMoveSnapshots] = useState<AnyMarkup[]>([]);

  // Stato Trasformazione Punti di Presa / Handles (Stretching/Resize)
  const [isDraggingHandle, setIsDraggingHandle] = useState(false);
  const [activeHandle, setActiveHandle] = useState<HandleHit | null>(null);
  const [handleSnapshot, setHandleSnapshot] = useState<AnyMarkup | null>(null);

  // Stato Snap Attivo ad Oggetto (Inizio, Punto Medio, Fine)
  const [activeSnapTarget, setActiveSnapTarget] = useState<SnapTarget | null>(null);

  // Stato Disegno Drag a 2 Punti (Rettangoli, Nuvoletta Rettangolare, Ellisse, Linee)
  const [isDrawingDrag, setIsDrawingDrag] = useState(false);
  const [dragStartPt, setDragStartPt] = useState<Point2D | null>(null);

  // Stato Callout a 2 passaggi (Stile Bluebeam: Click 1 Freccia -> Click 2 Box di testo)
  const [calloutArrowPt, setCalloutArrowPt] = useState<Point2D | null>(null);

  // Stato Cloud+ a 2 passaggi (Stile Bluebeam: Drag 1 Nuvoletta -> Click 2 Box di testo con freccia)
  const [cloudPlusStep, setCloudPlusStep] = useState<'idle' | 'box_placement'>('idle');
  const [cloudPlusCloudPts, setCloudPlusCloudPts] = useState<Point2D[] | null>(null);

  // Selezione interattiva area cartiglio AutoMark (stile Bluebeam)
  const [autoMarkDragStart, setAutoMarkDragStart] = useState<Point2D | null>(null);
  const [autoMarkDragCurrent, setAutoMarkDragCurrent] = useState<Point2D | null>(null);

  // Helper: trova il punto più vicino sul perimetro del poligono nuvoletta
  const findClosestPointOnPolygon = (p: Point2D, polygon: Point2D[]): Point2D => {
    let closestPt = polygon[0];
    let minDistance = Infinity;

    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      let t = l2 === 0 ? 0 : ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      const proj: Point2D = {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
      };
      const dist = Math.hypot(p.x - proj.x, p.y - proj.y);
      if (dist < minDistance) {
        minDistance = dist;
        closestPt = proj;
      }
    }
    return closestPt;
  };

  // Stato Editor di Testo Inline sul Canvas
  const [inlineEditor, setInlineEditor] = useState<InlineEditorState | null>(null);

  // Stato Disegno Multipunto (Poligoni, Nuvoletta Poligonale, Polilinee)
  const [drawingPoints, setDrawingPoints] = useState<Point2D[]>([]);
  const [currentMousePt, setCurrentMousePt] = useState<Point2D | null>(null);
  const lastMousePageRef = useRef<{ pt: Point2D; pageIndex: number } | null>(null);
  const [hoveredEntity, setHoveredEntity] = useState<boolean>(false);

  // Stato Disegno a Mano Libera (Penna & Evidenziatore)
  const [isDrawingFreehand, setIsDrawingFreehand] = useState(false);
  const [freehandPoints, setFreehandPoints] = useState<Point2D[]>([]);

  // Stato Selezione Fence Unificata (Click + Rettangolo o Lazo a mano libera)
  const [isSelectingFence, setIsSelectingFence] = useState(false);
  const [fenceStartPt, setFenceStartPt] = useState<Point2D | null>(null);
  const [fenceCurrentPt, setFenceCurrentPt] = useState<Point2D | null>(null);
  const [fencePoints, setFencePoints] = useState<Point2D[]>([]);
  const [activeFenceType, setActiveFenceType] = useState<'rect' | 'lasso'>('rect');
  const [savedToastMsg, setSavedToastMsg] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Stato calibrazione scala
  const [calibModalPts, setCalibModalPts] = useState<{ p1: Point2D; p2: Point2D } | null>(null);

  const currentPageInfo = pagesInfo[currentPage - 1];

  const PAGE_GAP = 18; // Distacco tra pagine in punti PDF (stile Bluebeam Revu)

  const pageOffsets = useMemo(() => {
    if (pageViewMode === 'single') return [0];
    const offsets: number[] = [];
    let currentY = 0;
    for (let i = 0; i < numPages; i++) {
      offsets.push(currentY);
      const h = pagesInfo[i]?.height || 842;
      currentY += h + PAGE_GAP;
    }
    return offsets;
  }, [numPages, pagesInfo, pageViewMode]);

  const maxPageWidth = useMemo(() => {
    if (pagesInfo.length === 0) return 595;
    return Math.max(...pagesInfo.map((p) => p.width));
  }, [pagesInfo]);

  // Auto-scroll alla pagina selezionata in modalità continua (quando si clicca su miniature, segnalibri o pulsanti avanti/indietro)
  const searchFocusRequest = useAppStore((s) => s.searchFocusRequest);

  useEffect(() => {
    if (!searchFocusRequest || searchFocusRequest.docId !== docId) return;
    if (!containerRef.current) return;
    const { pageIndex: targetPageIdx, rect } = searchFocusRequest;
    const pInfo = pagesInfo[targetPageIdx];
    if (!pInfo) return;

    const containerW = containerRef.current.clientWidth || 900;
    const containerH = containerRef.current.clientHeight || 600;

    // Se lo zoom attuale è troppo basso per leggere il risultato, lo alza automaticamente almeno a 1.6x
    const targetZoom = Math.min(24.0, Math.max(viewport.zoom, 1.6));
    const pageOffX = pageViewMode === 'continuous' ? (maxPageWidth - pInfo.width) / 2 : 0;
    const pageOffY = pageViewMode === 'continuous' ? (pageOffsets[targetPageIdx] || 0) : 0;

    const centerWorldX = pageOffX + rect.x + rect.width / 2;
    const centerWorldY = pageOffY + rect.y + rect.height / 2;

    lastProgrammaticPageRef.current = targetPageIdx + 1;
    setViewport({
      zoom: targetZoom,
      panX: containerW / 2 - centerWorldX * targetZoom,
      panY: containerH / 2 - centerWorldY * targetZoom,
    });
  }, [searchFocusRequest, docId]);

  useEffect(() => {
    if (pageViewMode !== 'continuous') {
      lastProgrammaticPageRef.current = currentPage;
      return;
    }
    if (isWheelingRef.current) {
      lastProgrammaticPageRef.current = currentPage;
      return;
    }
    if (lastProgrammaticPageRef.current !== currentPage) {
      lastProgrammaticPageRef.current = currentPage;
      const targetOffset = pageOffsets[currentPage - 1] || 0;
      const targetPanY = -targetOffset * viewport.zoom + 20;
      setViewport({
        panY: targetPanY,
      });
    }
  }, [currentPage, pageViewMode, pageOffsets, viewport.zoom, setViewport]);

  // Helper: Genera percorso ortogonale spezzato automatico tra due punti (Z-shape o L-shape con Shift)
  const buildOrthogonalConnectorPoints = useCallback(
    (p1: Point2D, p2: Point2D, lShape: boolean): Point2D[] => {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      if (Math.abs(dx) < 2 || Math.abs(dy) < 2) {
        return [p1, p2];
      }
      if (lShape) {
        return [p1, { x: p2.x, y: p1.y }, p2];
      }
      if (Math.abs(dx) >= Math.abs(dy)) {
        const midX = (p1.x + p2.x) / 2;
        return [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
      }
      const midY = (p1.y + p2.y) / 2;
      return [p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2];
    },
    []
  );

  // Helper: Vincolo ortogonale stretto (H/V esatto su X o Y del puntatore con Ctrl)
  const snapStrictOrtho = useCallback((p1: Point2D, p2: Point2D): Point2D => {
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    return dx >= dy ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
  }, []);

  // Helper: Vincolo ortogonale e a 45 gradi con Shift (CAD Ortho Snap)
  const snapOrthoAngle = useCallback((p1: Point2D, p2: Point2D): Point2D => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return p2;
    const angle = Math.atan2(dy, dx);
    const snapStep = Math.PI / 4; // 45°
    const snapped = Math.round(angle / snapStep) * snapStep;
    return {
      x: p1.x + dist * Math.cos(snapped),
      y: p1.y + dist * Math.sin(snapped),
    };
  }, []);

  // Gestione tastiera globale
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') setIsCtrlPressed(true);
      // Scorciatoia Alt+Z (Auto Size Text Box / Adatta Casella di Testo - Stile Bluebeam Revu)
      if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (inlineEditor) {
          const targetMarkup = markups.find((m) => m.id === inlineEditor.markupId);
          const editInfo = pendingTextEditRef.current;
          const rawFontSize = editInfo?.fontSize || (targetMarkup as any)?.fontSize || 12;
          const fontFamily = editInfo?.fontFamily || (targetMarkup as any)?.fontFamily || 'Segoe UI, sans-serif';
          const size = TextLayoutHelper.calculateAutoSize(inlineEditor.text, {
            fontSize: rawFontSize,
            fontFamily,
            fontWeight: editInfo?.fontWeight || (targetMarkup as any)?.fontWeight,
            fontStyle: editInfo?.fontStyle || (targetMarkup as any)?.fontStyle,
            paddingX: 6,
            paddingY: 6,
            currentWidth: inlineEditor.boxRect.width,
          });
          setInlineEditor({
            ...inlineEditor,
            boxRect: {
              ...inlineEditor.boxRect,
              width: size.width,
              height: size.height,
            },
          });
          if (targetMarkup) {
            updateMarkup(targetMarkup.id, {
              boxRect: {
                ...(targetMarkup as any).boxRect,
                width: size.width,
                height: size.height,
              },
            } as any);
          }
          return;
        }
        autoSizeSelectedMarkups();
        return;
      }

      if (inlineEditor) {
        if (e.key === 'Escape') {
          commitInlineText();
        }
        return;
      }

      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.key === 'Shift') setIsShiftPressed(true);

      if (e.code === 'Space' && !isSpacePressed) {
        setIsSpacePressed(true);
      }

      if (e.key === 'Escape') {
        setIsDrawingDrag(false);
        setDragStartPt(null);
        setCalloutArrowPt(null);
        setCloudPlusStep('idle');
        setCloudPlusCloudPts(null);
        setIsMovingMarkups(false);
        setIsDraggingHandle(false);
        setIsSelectingFence(false);
        setFenceStartPt(null);
        setFenceCurrentPt(null);
        setFencePoints([]);
        setDrawingPoints([]);
        setActiveSnapTarget(null);
        setActiveToolChestMarkup(null);
        setAddingCalloutLeaderId(null);
        setFormatPainterStyle(null);
        selectMarkup(null);
      }

      // Scorciatoia Copia Formato (Ctrl+Shift+C) stile Bluebeam Revu
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        const firstSel = selectedMarkupIds.length > 0
          ? markups.find((m) => m.id === selectedMarkupIds[0])
          : null;
        setActiveTool('select');
        if (firstSel) {
          setFormatPainterStyle(extractFormatStyle(firstSel));
          setSavedToastMsg('Copia formato attivo: clicca sugli oggetti di destinazione (Esc per uscire)');
        } else {
          setFormatPainterStyle({ __waitingForSource: true } as any);
          setSavedToastMsg('Copia formato: clicca prima sull\'oggetto di origine');
        }
        setTimeout(() => setSavedToastMsg(null), 2600);
        return;
      }

      // Undo/Redo (Ctrl+Z / Ctrl+Y) gestiti globalmente in TopHeader per evitare doppie esecuzioni in Split View e blocchi su slider

      // Unisci livelli (Ctrl+Shift+M)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        void import('@/core/pdf/pdfFlattenService').then((m) => m.triggerFlattenActiveDocument());
        return;
      }

      // Scorciatoie Raggruppa (Ctrl+G) e Separa (Ctrl+Shift+G) stile Bluebeam Revu
      if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) {
          ungroupSelectedMarkup();
        } else if (selectedMarkupIds.length >= 1) {
          groupSelectedMarkups();
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        selectedMarkupIds.forEach((id) => deleteMarkup(id));
      }

      if (e.key === 'Enter' && drawingPoints.length >= 2) {
        finishMultiPointDrawing();
      }

      // Scorciatoie Bluebeam Revu standard
      const key = e.key.toUpperCase();
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (key === 'V') setActiveTool('select');
        else if (key === 'H') setActiveTool('pan');
        else if (key === 'R') setActiveTool('rectangle');
        else if (key === 'E') setActiveTool('ellipse');
        else if (key === 'C' && !e.shiftKey) setActiveTool('cloud_rect');
        else if (key === 'C' && e.shiftKey) setActiveTool('cloud');
        else if (key === 'K') setActiveTool('cloud_plus');
        else if (key === 'P' && e.shiftKey) setActiveTool('polygon');
        else if (key === 'L') setActiveTool('line');
        else if (key === 'A') setActiveTool('arrow');
        else if (key === 'Q') setActiveTool('callout');
        else if (key === 'T') setActiveTool('textbox');
        else if (key === 'M') setActiveTool('measure_length');
        else if (key === 'G') setActiveTool('snapshot');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsSpacePressed(false);
      if (e.key === 'Shift') setIsShiftPressed(false);
      if (e.key === 'Control') setIsCtrlPressed(false);
    };

    const handleWindowBlur = () => {
      setIsSpacePressed(false);
      setIsShiftPressed(false);
      setIsCtrlPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isSpacePressed, drawingPoints, selectedMarkupIds, inlineEditor, autoSizeSelectedMarkups, markups, updateMarkup]);

  // Incolla immagini / screenshot dagli appunti (Ctrl+V da Win+Shift+S, Paint, Chrome, o Istantanea interna)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      // 1. Se ci sono markup copiati/tagliati (Ctrl+C / Ctrl+X), incollali centrati sotto il cursore
      const st = useAppStore.getState();
      if (st.clipboardMarkups.length > 0) {
        e.preventDefault();
        const mouseTarget = lastMousePageRef.current;
        st.pasteMarkups({
          targetPt: mouseTarget?.pt || currentMousePt,
          targetPageIndex: mouseTarget?.pageIndex,
          inPlace: false,
        });
        setSavedToastMsg('Marcatura incollata sulla posizione del cursore');
        setTimeout(() => setSavedToastMsg(null), 2000);
        return;
      }

      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              e.preventDefault();
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                if (dataUrl) {
                  const target = lastMousePageRef.current;
                  insertImageDataUrlToPdf(
                    dataUrl,
                    'Screenshot',
                    target?.pt || currentMousePt,
                    null,
                    target?.pageIndex
                  );
                  setSavedToastMsg('Immagine incollata sulla posizione del cursore');
                  setTimeout(() => setSavedToastMsg(null), 2400);
                }
              };
              reader.readAsDataURL(file);
              return;
            }
          }
        }
      }
      const snapDataUrl = getClipboardImageDataUrl();
      if (snapDataUrl) {
        e.preventDefault();
        const target = lastMousePageRef.current;
        insertImageDataUrlToPdf(
          snapDataUrl,
          'Istantanea',
          target?.pt || currentMousePt,
          getClipboardImageSize(),
          target?.pageIndex
        );
        setSavedToastMsg('Istantanea incollata sulla posizione del cursore');
        setTimeout(() => setSavedToastMsg(null), 2400);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [currentMousePt]);

  // Focus automatico e selezione iniziale del testo dell'editor inline (SOLO all'apertura, non ad ogni tasto!)
  useEffect(() => {
    if (inlineEditor?.markupId) {
      if (editingMarkupIdRef.current !== inlineEditor.markupId) {
        editingMarkupIdRef.current = inlineEditor.markupId;
        const el = inlineTextareaRef.current;
        if (el) {
          el.focus();
          el.select();
        }
        const timer = setTimeout(() => {
          if (inlineTextareaRef.current && editingMarkupIdRef.current === inlineEditor.markupId) {
            inlineTextareaRef.current.focus();
            inlineTextareaRef.current.select();
          }
        }, 50);
        return () => clearTimeout(timer);
      }
    } else {
      editingMarkupIdRef.current = null;
    }
  }, [inlineEditor?.markupId]);

  const handleTextEditClick = (item: ExtractedTextItem, pageIndex: number) => {
    pendingTextEditRef.current = {
      pageIndex,
      originalRect: { x: item.x, y: item.y, width: item.width, height: item.height },
      fontSize: item.fontSize,
      fontFamily: item.fontFamily,
      fontWeight: item.fontWeight || 'normal',
      fontStyle: item.fontStyle || 'normal',
      originalText: item.str,
    };
    inlineEditorOpenTimeRef.current = Date.now();
    setInlineEditor({
      markupId: `edit_text_${Date.now()}`,
      boxRect: {
        x: item.x,
        y: item.y,
        width: Math.max(100, item.width),
        height: Math.max(24, item.height),
      },
      text: item.str,
    });
  };

  const commitInlineText = () => {
    if (inlineEditor) {
      // Modifica Testo Originale PDF (Whiteout + Nuovo Testo sovrascritto stile Bluebeam)
      if (pendingTextEditRef.current) {
        const editInfo = pendingTextEditRef.current;
        pendingTextEditRef.current = null;
        const textVal = inlineEditor.text.trim();
        if (textVal && textVal !== editInfo.originalText) {
          // 1. Toppa bianca coprente sul testo originale (Whiteout)
          const whiteoutId = crypto.randomUUID();
          const whiteout: AnyMarkup = {
            id: whiteoutId,
            docId: docId as 'primary' | 'secondary',
            pageIndex: editInfo.pageIndex,
            author: currentUser,
            creationDate: new Date().toISOString(),
            modificationDate: new Date().toISOString(),
            status: 'None',
            type: 'rectangle',
            subject: 'Copertura Testo Originale (Whiteout)',
            contents: 'Modifica Testo PDF',
            boxRect: {
              x: editInfo.originalRect.x - 2,
              y: editInfo.originalRect.y - 1,
              width: editInfo.originalRect.width + 4,
              height: editInfo.originalRect.height + 2,
            },
            strokeColor: '#ffffff',
            strokeWidth: 0,
            fillColor: '#ffffff',
            fillOpacity: 1.0,
            opacity: 1.0,
            lineStyle: 'solid',
          };
          addMarkup(whiteout);

          // 2. Testo modificato sovrascritto
          const newTextId = crypto.randomUUID();
          const newTextMarkup: TextMarkup = {
            id: newTextId,
            docId: docId as 'primary' | 'secondary',
            pageIndex: editInfo.pageIndex,
            author: currentUser,
            creationDate: new Date().toISOString(),
            modificationDate: new Date().toISOString(),
            status: 'None',
            type: 'textbox',
            subject: 'Testo Modificato',
            contents: textVal,
            boxRect: {
              x: editInfo.originalRect.x,
              y: editInfo.originalRect.y,
              width: Math.max(editInfo.originalRect.width, textVal.length * editInfo.fontSize * 0.6),
              height: editInfo.originalRect.height + 2,
            },
            text: textVal,
            fontSize: editInfo.fontSize,
            fontFamily: editInfo.fontFamily,
            fontWeight: editInfo.fontWeight,
            fontStyle: editInfo.fontStyle,
            strokeColor: '#000000',
            strokeWidth: 0,
            fillColor: 'transparent',
            fillOpacity: 1.0,
            opacity: 1.0,
            lineStyle: 'solid',
          } as any;
          addMarkup(newTextMarkup);
          selectMarkup(newTextId);
        }
        setInlineEditor(null);
        return;
      }

      const textVal = inlineEditor.text.trim();
      const targetMarkup = markups.find((m) => m.id === inlineEditor.markupId);
      if (
        inlineEditor.subPathIndex !== undefined &&
        targetMarkup &&
        targetMarkup.compoundPaths &&
        targetMarkup.compoundPaths[inlineEditor.subPathIndex]
      ) {
        const nextPaths = targetMarkup.compoundPaths.map((cp, idx) =>
          idx === inlineEditor.subPathIndex ? { ...cp, text: inlineEditor.text } : cp
        );
        updateMarkup(inlineEditor.markupId, {
          compoundPaths: nextPaths,
        });
      } else if (targetMarkup && (targetMarkup.type === 'measure_length' || targetMarkup.type === 'measure_polyline' || targetMarkup.type === 'measure_area' || targetMarkup.type === 'measure_area_rect')) {
        updateMarkup(inlineEditor.markupId, {
          contents: textVal || '',
          customText: textVal.length > 0 ? textVal : undefined,
        } as any);
      } else if (targetMarkup && (targetMarkup.type === 'textbox' || targetMarkup.type === 'callout' || targetMarkup.type === 'cloud_plus')) {
        const fallback = targetMarkup.type === 'textbox' ? 'Testo' : 'Nota';
        updateMarkup(inlineEditor.markupId, {
          contents: textVal || fallback,
          text: textVal || fallback,
        } as any);
      } else {
        updateMarkup(inlineEditor.markupId, {
          contents: textVal,
        });
      }
      setInlineEditor(null);
    }
  };

  // Calcolo Bounding Box con vincolo Quadrato (Shift)
  const computeBoxRect = (p1: Point2D, p2: Point2D, squareConstraint: boolean) => {
    let width = p2.x - p1.x;
    let height = p2.y - p1.y;

    if (squareConstraint) {
      const size = Math.max(Math.abs(width), Math.abs(height));
      width = width >= 0 ? size : -size;
      height = height >= 0 ? size : -size;
    }

    const x = width >= 0 ? p1.x : p1.x + width;
    const y = height >= 0 ? p1.y : p1.y + height;

    return {
      x,
      y,
      width: Math.abs(width),
      height: Math.abs(height),
    };
  };

  // Render dei markup sul canvas overlay a 60 FPS
  const renderMarkups = useCallback(() => {
    const canvas = markupCanvasRef.current;
    if (!canvas || pagesInfo.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    // Dimensiona il canvas sovrapposto esattamente al viewport visibile (evita memory leak e crash su documenti multipagina lunghi)
    const containerW = containerRef.current?.clientWidth || 1600;
    const containerH = containerRef.current?.clientHeight || 900;

    canvas.width = Math.floor(containerW * dpr);
    canvas.height = Math.floor(containerH * dpr);
    canvas.style.width = `${containerW}px`;
    canvas.style.height = `${containerH}px`;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, containerW, containerH);

    // Applica traslazione e zoom del viewport per allineare perfettamente i disegni live alle coordinate PDF
    ctx.translate(viewport.panX, viewport.panY);
    ctx.scale(viewport.zoom, viewport.zoom);

    // Trasla anteprime live sulla pagina attiva (in continuous mode)
    let activePageOffX = 0;
    let activePageOffY = 0;
    if (pageViewMode === 'continuous') {
      const pInfo = pagesInfo[currentPage - 1] || { width: 595, height: 842 };
      activePageOffX = (maxPageWidth - pInfo.width) / 2;
      activePageOffY = pageOffsets[currentPage - 1] || 0;
    }

    ctx.save();
    ctx.translate(activePageOffX, activePageOffY);

    // 2. Render anteprima Callout in corso (Stile Bluebeam)
    if (calloutArrowPt && currentMousePt) {
      ctx.save();
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = activeStrokeWidth;
      ctx.setLineDash([4, 4]);

      const boxW = 140;
      const boxH = 38;
      const boxX = currentMousePt.x;
      const boxY = currentMousePt.y - boxH / 2;

      const elbowX = boxX >= calloutArrowPt.x ? boxX - 16 : boxX + boxW + 16;
      const targetX = boxX >= calloutArrowPt.x ? boxX : boxX + boxW;
      const targetY = boxY + boxH / 2;

      ctx.beginPath();
      ctx.moveTo(calloutArrowPt.x, calloutArrowPt.y);
      ctx.lineTo(elbowX, targetY);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = activeColor;
      const angle = Math.atan2(targetY - calloutArrowPt.y, elbowX - calloutArrowPt.x);
      ctx.beginPath();
      ctx.moveTo(calloutArrowPt.x, calloutArrowPt.y);
      ctx.lineTo(
        calloutArrowPt.x + 10 * Math.cos(angle - Math.PI / 6),
        calloutArrowPt.y + 10 * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        calloutArrowPt.x + 10 * Math.cos(angle + Math.PI / 6),
        calloutArrowPt.y + 10 * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      ctx.fillStyle = activeColor;
      ctx.font = '11px sans-serif';
      ctx.fillText('Scrivi commento...', boxX + 6, boxY + 16);

      ctx.restore();
    }

    // 2b. Render anteprima CLOUD+ (Fase 2: Posizionamento Box di Testo e Linea Direttrice)
    if (activeTool === 'cloud_plus' && cloudPlusStep === 'box_placement' && cloudPlusCloudPts && currentMousePt) {
      ctx.save();

      // Disegna la nuvoletta confermata al passaggio 1
      const arcs = CloudGenerator.generateCloudArcs(cloudPlusCloudPts, 20);
      CloudGenerator.drawCloudOnCanvas(
        ctx,
        arcs,
        activeColor,
        activeStrokeWidth,
        activeFillColor,
        0.8,
        activeFillOpacity
      );

      // Calcola il punto di ancoraggio più vicino sul perimetro della nuvoletta
      const leaderPt = findClosestPointOnPolygon(currentMousePt, cloudPlusCloudPts);

      // Dimensioni box flottante
      const boxW = 140;
      const boxH = 38;
      const boxX = currentMousePt.x;
      const boxY = currentMousePt.y - boxH / 2;

      const boxCenterX = boxX + boxW / 2;
      const elbowX = boxCenterX >= leaderPt.x ? Math.max(leaderPt.x, boxX - 16) : Math.min(leaderPt.x, boxX + boxW + 16);
      const targetX = boxCenterX >= leaderPt.x ? boxX : boxX + boxW;
      const targetY = currentMousePt.y;

      // Disegna linea direttrice
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = activeStrokeWidth;
      ctx.beginPath();
      ctx.moveTo(leaderPt.x, leaderPt.y);
      ctx.lineTo(elbowX, targetY);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();

      // Freccia sul leaderPoint orientata verso la nuvoletta
      const angle = Math.atan2(targetY - leaderPt.y, elbowX - leaderPt.x) + Math.PI;
      ctx.fillStyle = activeColor;
      ctx.beginPath();
      ctx.moveTo(leaderPt.x, leaderPt.y);
      ctx.lineTo(
        leaderPt.x + 10 * Math.cos(angle - Math.PI / 6),
        leaderPt.y + 10 * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        leaderPt.x + 10 * Math.cos(angle + Math.PI / 6),
        leaderPt.y + 10 * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();

      // Box flottante
      ctx.fillStyle = activeFillColor && activeFillColor !== 'transparent' ? activeFillColor : 'rgba(255, 255, 255, 0.95)';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      ctx.fillStyle = activeColor;
      ctx.font = '11px sans-serif';
      ctx.fillText('Scrivi commento...', boxX + 6, boxY + 16);

      ctx.restore();
    }

    // 2c. Render anteprima selezione area AutoMark (stile Bluebeam)
    if (isSelectingAutoMarkRegion && autoMarkDragStart && autoMarkDragCurrent) {
      ctx.save();
      const x = Math.min(autoMarkDragStart.x, autoMarkDragCurrent.x);
      const y = Math.min(autoMarkDragStart.y, autoMarkDragCurrent.y);
      const w = Math.abs(autoMarkDragCurrent.x - autoMarkDragStart.x);
      const h = Math.abs(autoMarkDragCurrent.y - autoMarkDragStart.y);

      ctx.fillStyle = 'rgba(0, 120, 212, 0.2)';
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = '#00b7c3';
      ctx.lineWidth = Math.max(1, 2 / viewport.zoom);
      ctx.setLineDash([6 / viewport.zoom, 3 / viewport.zoom]);
      ctx.strokeRect(x, y, w, h);

      // Badge informativo
      const badgeH = 18 / viewport.zoom;
      const badgeW = 120 / viewport.zoom;
      ctx.fillStyle = '#0078d4';
      ctx.fillRect(x, Math.max(0, y - badgeH), badgeW, badgeH);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(9, 10 / viewport.zoom)}px sans-serif`;
      ctx.fillText('Regione Cartiglio', x + 4 / viewport.zoom, Math.max(badgeH - 5 / viewport.zoom, y - 5 / viewport.zoom));

      ctx.restore();
    }

    // 3. Render anteprima disegno DRAG RECTANGULAR a 2 punti con ORTHO SNAP
    if (dragStartPt && currentMousePt) {
      ctx.save();
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = activeStrokeWidth;
      ctx.setLineDash([4, 4]);

      const effectivePt = (orthoEnabled || isCtrlPressed)
        ? snapStrictOrtho(dragStartPt, currentMousePt)
        : isShiftPressed
        ? snapOrthoAngle(dragStartPt, currentMousePt)
        : currentMousePt;
      const box = computeBoxRect(dragStartPt, currentMousePt, isShiftPressed);

      if (activeTool === 'rectangle') {
        if (activeFillColor && activeFillColor !== 'transparent') {
          ctx.fillStyle = activeFillColor;
          ctx.globalAlpha = activeFillOpacity;
          ctx.fillRect(box.x, box.y, box.width, box.height);
        }
        if (activeHatchPattern && activeHatchPattern !== 'none' && activeHatchPattern !== 'solid' && box.width > 2 && box.height > 2) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(box.x, box.y, box.width, box.height);
          ctx.clip();
          HatchRenderer.renderHatch(
            ctx,
            activeHatchPattern,
            box,
            activeHatchColor || activeColor,
            activeHatchScale || 1,
            activeFillOpacity ?? 0.5,
            activeHatchAngle || 0
          );
          ctx.restore();
        }
        ctx.strokeRect(box.x, box.y, box.width, box.height);
      } else if (activeTool === 'ellipse') {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const rx = box.width / 2;
        const ry = box.height / 2;
        if (activeFillColor && activeFillColor !== 'transparent' && rx > 0 && ry > 0) {
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.fillStyle = activeFillColor;
          ctx.globalAlpha = activeFillOpacity;
          ctx.fill();
        }
        if (activeHatchPattern && activeHatchPattern !== 'none' && activeHatchPattern !== 'solid' && rx > 1 && ry > 1) {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.clip();
          HatchRenderer.renderHatch(
            ctx,
            activeHatchPattern,
            box,
            activeHatchColor || activeColor,
            activeHatchScale || 1,
            activeFillOpacity ?? 0.5,
            activeHatchAngle || 0
          );
          ctx.restore();
        }
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (activeTool === 'cloud_rect' || activeTool === 'cloud_plus') {
        const rectPts: Point2D[] = [
          { x: box.x, y: box.y },
          { x: box.x + box.width, y: box.y },
          { x: box.x + box.width, y: box.y + box.height },
          { x: box.x, y: box.y + box.height },
        ];
        if (box.width > 10 && box.height > 10) {
          const arcs = CloudGenerator.generateCloudArcs(rectPts, 20);
          CloudGenerator.drawCloudOnCanvas(
            ctx,
            arcs,
            activeColor,
            activeStrokeWidth,
            activeFillColor,
            0.8,
            activeFillOpacity,
            activeHatchPattern !== 'none' ? activeHatchPattern : undefined,
            activeHatchColor || activeColor,
            activeHatchScale || 1
          );
        } else {
          ctx.strokeRect(box.x, box.y, box.width, box.height);
        }
      } else if (activeTool === 'snapshot' || activeTool === 'hyperlink') {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 120, 212, 0.14)';
        ctx.fillRect(box.x, box.y, box.width, box.height);
        ctx.strokeStyle = '#0078d4';
        ctx.lineWidth = 1.5 / Math.max(0.15, viewport.zoom);
        ctx.setLineDash([5 / Math.max(0.15, viewport.zoom), 3 / Math.max(0.15, viewport.zoom)]);
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.restore();
      } else if (activeTool === 'connector') {
        const pts = buildOrthogonalConnectorPoints(dragStartPt, currentMousePt, isShiftPressed);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
      } else if (activeTool === 'erase_content') {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(box.x, box.y, box.width, box.height);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = Math.max(1, 1 / viewport.zoom);
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.restore();
      } else if (activeTool === 'measure_area_rect') {
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.fillStyle = activeColor;
        ctx.globalAlpha = activeFillOpacity;
        ctx.fillRect(box.x, box.y, box.width, box.height);
      } else if (activeTool === 'textbox') {
        if (activeFillColor && activeFillColor !== 'transparent') {
          ctx.save();
          ctx.fillStyle = activeFillColor;
          ctx.globalAlpha = activeFillOpacity;
          ctx.fillRect(box.x, box.y, box.width, box.height);
          ctx.restore();
        }
        ctx.strokeRect(box.x, box.y, box.width, box.height);
      } else if (activeTool === 'measure_length') {
        const dx = effectivePt.x - dragStartPt.x;
        const dy = effectivePt.y - dragStartPt.y;
        const len = Math.hypot(dx, dy);
        if (len > 2) {
          const nx = -dy / len;
          const ny = dx / len;
          const offset = 24;
          const dim1 = { x: dragStartPt.x + nx * offset, y: dragStartPt.y + ny * offset };
          const dim2 = { x: effectivePt.x + nx * offset, y: effectivePt.y + ny * offset };

          // Linee di estensione (testimoni)
          ctx.beginPath();
          ctx.moveTo(dragStartPt.x, dragStartPt.y);
          ctx.lineTo(dim1.x + nx * 5, dim1.y + ny * 5);
          ctx.moveTo(effectivePt.x, effectivePt.y);
          ctx.lineTo(dim2.x + nx * 5, dim2.y + ny * 5);
          ctx.stroke();

          // Linea di quota
          ctx.beginPath();
          ctx.moveTo(dim1.x, dim1.y);
          ctx.lineTo(dim2.x, dim2.y);
          ctx.stroke();

          // Ticks a 45°
          const angle = Math.atan2(dim2.y - dim1.y, dim2.x - dim1.x);
          const tickLen = 9;
          const tickDx = Math.cos(angle + Math.PI / 4) * (tickLen / 2);
          const tickDy = Math.sin(angle + Math.PI / 4) * (tickLen / 2);
          ctx.beginPath();
          ctx.moveTo(dim1.x - tickDx, dim1.y - tickDy);
          ctx.lineTo(dim1.x + tickDx, dim1.y + tickDy);
          ctx.moveTo(dim2.x - tickDx, dim2.y - tickDy);
          ctx.lineTo(dim2.x + tickDx, dim2.y + tickDy);
          ctx.stroke();

          // Valore di quota live
          const dist = ScaleManager.calculateDistance(dragStartPt, effectivePt);
          const label = ScaleManager.formatLength(dist, scaleCalibration);
          ctx.save();
          ctx.translate((dim1.x + dim2.x) / 2, (dim1.y + dim2.y) / 2);
          let textAngle = angle;
          if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
          ctx.rotate(textAngle);
          ctx.font = '600 11px Segoe UI, sans-serif';
          ctx.fillStyle = '#ffff00';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(label, 0, -3);
          ctx.restore();
        }
      } else if (activeTool === 'line' || activeTool === 'arrow' || activeTool === 'calibrate') {
        ctx.beginPath();
        ctx.moveTo(dragStartPt.x, dragStartPt.y);
        ctx.lineTo(effectivePt.x, effectivePt.y);
        ctx.stroke();

        if (isShiftPressed) {
          ctx.fillStyle = '#00b7c3';
          ctx.font = '10px font-mono';
          const deg = Math.round(
            (Math.atan2(effectivePt.y - dragStartPt.y, effectivePt.x - dragStartPt.x) * 180) / Math.PI
          );
          ctx.fillText(`Snap: ${deg}°`, effectivePt.x + 8, effectivePt.y - 8);
        }
      }

      ctx.restore();
    }

    // 4. Render anteprima disegno a MANO LIBERA (Penna & Evidenziatore)
    if (isDrawingFreehand && freehandPoints.length >= 1) {
      ctx.save();
      const isHighlighter = activeTool === 'highlighter';
      ctx.globalAlpha = isHighlighter ? 0.38 : activeOpacity;
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = isHighlighter ? Math.max(12, activeStrokeWidth) : Math.max(1.5, activeStrokeWidth);
      ctx.lineCap = isHighlighter ? 'square' : 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(freehandPoints[0].x, freehandPoints[0].y);
      if (freehandPoints.length === 1) {
        ctx.lineTo(freehandPoints[0].x + 0.1, freehandPoints[0].y + 0.1);
      } else {
        for (let i = 1; i < freehandPoints.length; i++) {
          ctx.lineTo(freehandPoints[i].x, freehandPoints[i].y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // 5. Render anteprima disegno MULTIPUNTO
    if (drawingPoints.length > 0 && currentMousePt) {
      ctx.save();
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = activeStrokeWidth;
      ctx.setLineDash([4, 4]);

      const lastPt = drawingPoints[drawingPoints.length - 1];
      const effectivePt = (orthoEnabled || isCtrlPressed)
        ? snapStrictOrtho(lastPt, currentMousePt)
        : isShiftPressed
        ? snapOrthoAngle(lastPt, currentMousePt)
        : currentMousePt;
      const allPts = [...drawingPoints, effectivePt];

      if (activeTool === 'cloud' && allPts.length >= 3) {
        const arcs = CloudGenerator.generateCloudArcs(allPts, 24);
        CloudGenerator.drawCloudOnCanvas(
          ctx,
          arcs,
          activeColor,
          activeStrokeWidth,
          activeFillColor,
          0.7,
          activeFillOpacity
        );
      } else if (activeTool === 'polyline' || activeTool === 'measure_polyline' || activeTool === 'polygon' || activeTool === 'measure_area') {
        if ((activeTool === 'polygon' || activeTool === 'measure_area' || activeTool === 'polyline') && allPts.length >= 3) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of allPts) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
          const pBounds = { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };

          if (activeFillColor && activeFillColor !== 'transparent') {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(allPts[0].x, allPts[0].y);
            for (let i = 1; i < allPts.length; i++) ctx.lineTo(allPts[i].x, allPts[i].y);
            ctx.closePath();
            ctx.globalAlpha = activeFillOpacity;
            ctx.fillStyle = activeFillColor;
            ctx.fill();
            ctx.restore();
          }

          if (activeHatchPattern && activeHatchPattern !== 'none' && activeHatchPattern !== 'solid') {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(allPts[0].x, allPts[0].y);
            for (let i = 1; i < allPts.length; i++) ctx.lineTo(allPts[i].x, allPts[i].y);
            ctx.closePath();
            ctx.clip();
            HatchRenderer.renderHatch(
              ctx,
              activeHatchPattern,
              pBounds,
              activeHatchColor || activeColor,
              activeHatchScale || 1,
              activeFillOpacity ?? 0.5,
              activeHatchAngle || 0
            );
            ctx.restore();
          }
        }

        ctx.beginPath();
        ctx.moveTo(drawingPoints[0].x, drawingPoints[0].y);
        for (let i = 1; i < drawingPoints.length; i++) {
          ctx.lineTo(drawingPoints[i].x, drawingPoints[i].y);
        }
        ctx.lineTo(effectivePt.x, effectivePt.y);
        if (activeTool === 'polygon' || activeTool === 'measure_area') {
          ctx.closePath();
        }
        ctx.stroke();
      }

      ctx.restore();
    }

    // 5. Render Marker SNAP AD OGGETTO (Stile Bluebeam: Inizio, Punto Medio, Fine)
    if (activeSnapTarget && activeTool !== 'pan') {
      SnapManager.drawSnapMarker(ctx, activeSnapTarget, viewport.zoom);
    }

    // 6. Render FENCE DI SELEZIONE (Rettangolare o Lazo a mano libera in modalità Select)
    if (isSelectingFence && fenceStartPt && fenceCurrentPt) {
      ctx.save();
      if (activeFenceType === 'lasso' && fencePoints.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(fencePoints[0].x, fencePoints[0].y);
        for (let i = 1; i < fencePoints.length; i++) {
          ctx.lineTo(fencePoints[i].x, fencePoints[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 183, 195, 0.16)';
        ctx.fill();
        ctx.strokeStyle = '#00b7c3';
        ctx.lineWidth = 1.5 / Math.max(0.15, viewport.zoom);
        ctx.setLineDash([5 / Math.max(0.15, viewport.zoom), 3 / Math.max(0.15, viewport.zoom)]);
        ctx.stroke();
      } else {
        const fx = Math.min(fenceStartPt.x, fenceCurrentPt.x);
        const fy = Math.min(fenceStartPt.y, fenceCurrentPt.y);
        const fw = Math.abs(fenceCurrentPt.x - fenceStartPt.x);
        const fh = Math.abs(fenceCurrentPt.y - fenceStartPt.y);
        const isCrossing = fenceCurrentPt.x < fenceStartPt.x;
        ctx.fillStyle = isCrossing ? 'rgba(16, 185, 129, 0.15)' : 'rgba(0, 120, 212, 0.15)';
        ctx.fillRect(fx, fy, fw, fh);
        ctx.strokeStyle = isCrossing ? '#10b981' : '#00a8ff';
        ctx.lineWidth = 1.5 / Math.max(0.15, viewport.zoom);
        if (isCrossing) {
          ctx.setLineDash([5 / Math.max(0.15, viewport.zoom), 3 / Math.max(0.15, viewport.zoom)]);
        }
        ctx.strokeRect(fx, fy, fw, fh);
      }
      ctx.restore();
    }

    // 7. Render ANTEPRIMA GHOST LIVE del Simbolo Tool Chest sotto al cursore
    if (activeToolChestMarkup && currentMousePt && activeTool !== 'pan') {
      ctx.save();
      ctx.globalAlpha = 0.65;
      const previewClone: any = structuredClone(activeToolChestMarkup);
      if (previewClone.compoundPaths && previewClone.compoundPaths.length > 0) {
        const b = HitTester.getMarkupBoundingBox(previewClone) || { x: 0, y: 0, width: 24, height: 24 };
        const dx = currentMousePt.x - (b.x + b.width / 2);
        const dy = currentMousePt.y - (b.y + b.height / 2);
        previewClone.compoundPaths = previewClone.compoundPaths.map((cp: any) => {
          const res = { ...cp };
          if (cp.points) res.points = cp.points.map((p: Point2D) => ({ x: p.x + dx, y: p.y + dy }));
          if (cp.circle) res.circle = { ...cp.circle, cx: cp.circle.cx + dx, cy: cp.circle.cy + dy };
          if (cp.ellipse) res.ellipse = { ...cp.ellipse, cx: cp.ellipse.cx + dx, cy: cp.ellipse.cy + dy };
          if (cp.rect) res.rect = { ...cp.rect, x: cp.rect.x + dx, y: cp.rect.y + dy };
          return res;
        });
      }
      MarkupRenderer.renderMarkup(ctx, previewClone, false, scaleCalibration);
      ctx.restore();
    }

    ctx.restore(); // Restore activePageOffX/Y
    ctx.restore(); // Restore global context
  }, [
    currentPageInfo,
    viewport.zoom,
    viewport.panX,
    viewport.panY,
    currentPage,
    markups,
    selectedMarkupIds,
    formatPainterStyle,
    setFormatPainterStyle,
    applyFormatStyleToMarkups,
    scaleCalibration,
    calloutArrowPt,
    cloudPlusStep,
    cloudPlusCloudPts,
    dragStartPt,
    drawingPoints,
    currentMousePt,
    activeSnapTarget,
    activeTool,
    activeColor,
    activeFillColor,
    activeFillOpacity,
    activeStrokeWidth,
    isShiftPressed,
    snapOrthoAngle,
    docId,
    isMarkupBelongingToPane,
    pageViewMode,
    pageOffsets,
    maxPageWidth,
    numPages,
    pagesInfo,
    isSelectingFence,
    fenceStartPt,
    fenceCurrentPt,
    fencePoints,
    activeFenceType,
    activeToolChestMarkup,
    isDrawingFreehand,
    freehandPoints,
    activeOpacity,
  ]);

  useEffect(() => {
    renderMarkups();
  }, [renderMarkups]);

  // Restituisce l'indice 0-based della pagina sotto al cursore del mouse
  const getPageIndexFromEvent = (e: React.MouseEvent): number => {
    if (pageViewMode === 'single' || !containerRef.current || pagesInfo.length === 0) {
      return Math.max(0, currentPage - 1);
    }
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPt = CoordinateTransformer.screenToPage(
      { x: screenX, y: screenY },
      viewport.panX,
      viewport.panY,
      viewport.zoom
    );
    let targetPage = 0;
    for (let i = 0; i < numPages; i++) {
      const top = pageOffsets[i];
      const h = pagesInfo[i]?.height || 842;
      if (worldPt.y >= top && worldPt.y <= top + h + PAGE_GAP) {
        targetPage = i;
        break;
      }
      if (worldPt.y > top + h + PAGE_GAP) {
        targetPage = i;
      }
    }
    return Math.max(0, Math.min(numPages - 1, targetPage));
  };

  // Conversione coordinate Schermo -> PDF (supporta sia Pagina Singola che Pagine Continue con Gap)
  const getPdfPointFromEvent = (e: React.MouseEvent): Point2D | null => {
    if (!containerRef.current || pagesInfo.length === 0) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const worldPt = CoordinateTransformer.screenToPage(
      { x: screenX, y: screenY },
      viewport.panX,
      viewport.panY,
      viewport.zoom
    );

    if (pageViewMode === 'single') {
      return worldPt;
    }

    // Modalità Continua: individua la pagina sotto al cursore
    let targetPage = 0;
    for (let i = 0; i < numPages; i++) {
      const top = pageOffsets[i];
      const h = pagesInfo[i]?.height || 842;
      if (worldPt.y >= top && worldPt.y <= top + h + PAGE_GAP) {
        targetPage = i;
        break;
      }
      if (worldPt.y > top + h + PAGE_GAP) {
        targetPage = i;
      }
    }
    targetPage = Math.max(0, Math.min(numPages - 1, targetPage));

    const pInfo = pagesInfo[targetPage] || { width: 595, height: 842 };
    const pageOffsetX = (maxPageWidth - pInfo.width) / 2;
    const pageOffsetY = pageOffsets[targetPage] || 0;

    return {
      x: worldPt.x - pageOffsetX,
      y: worldPt.y - pageOffsetY,
    };
  };

  // Zoom e Scorrimento stile Bluebeam Revu configurabile (Modalità Zoom o Modalità Scorrimento)
  const handleWheel = (e: WheelEvent | React.WheelEvent) => {
    if (e.cancelable) {
      e.preventDefault();
    }
    if (!containerRef.current) return;

    // Determina se l'azione corrente è ZOOM in base alla modalità preferita dell'utente
    // In modalità 'zoom' (default CAD Bluebeam): Solo Rotellina fa ZOOM, Ctrl+Rotellina fa SCORRI/PAN
    // In modalità 'scroll': Solo Rotellina fa SCORRI/PAN, Ctrl+Rotellina fa ZOOM
    const shouldZoom = mouseWheelMode === 'zoom'
      ? (!e.ctrlKey && !e.metaKey)
      : (e.ctrlKey || e.metaKey);

    // 1. ESECUZIONE ZOOM CENTRATO SUL PUNTATORE
    if (shouldZoom) {
      const rect = containerRef.current.getBoundingClientRect();
      const pivot = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      // Zoom fluido proporzionale a deltaY (supporta sia rotellina classica che trackpad di precisione)
      const clampedDelta = Math.max(-120, Math.min(120, e.deltaY));
      const zoomFactor = Math.exp(-clampedDelta * 0.0012);
      const newZoom = Math.min(24.0, Math.max(0.04, viewport.zoom * zoomFactor));

      const newTransform = CoordinateTransformer.zoomAtPoint(
        viewport.zoom,
        newZoom,
        viewport.panX,
        viewport.panY,
        pivot
      );

      setViewport(newTransform);
      return;
    }

    // 2. SCORRIMENTO ORIZZONTALE CON SHIFT
    if (e.shiftKey) {
      const scrollStep = e.deltaY * 0.8;
      setViewport({
        ...viewport,
        panX: viewport.panX - scrollStep,
      });
      return;
    }

    // 3. SCORRIMENTO CONTINUO DELLE PAGINE (Stile Bluebeam Revu con distacco)
    if (pageViewMode === 'continuous') {
      isWheelingRef.current = true;
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => {
        isWheelingRef.current = false;
      }, 400);

      const scrollStep = e.deltaY * 0.9;
      const newPanY = viewport.panY - scrollStep;
      setViewport({
        ...viewport,
        panY: newPanY,
      });

      // Calcola e aggiorna automaticamente la pagina visibile al centro
      const rect = containerRef.current.getBoundingClientRect();
      const centerWorldY = (-newPanY + rect.height / 2) / viewport.zoom;
      for (let i = 0; i < numPages; i++) {
        const top = pageOffsets[i];
        const h = pagesInfo[i]?.height || 842;
        if (centerWorldY >= top && centerWorldY <= top + h + PAGE_GAP) {
          if (currentPage !== i + 1) {
            setCurrentPage(i + 1);
          }
          break;
        }
      }
      return;
    }

    // 4. Modalità Pagina Singola: salto pagina al bordo o con rotellina
    const now = Date.now();
    const isSinglePageFit = viewport.zoom <= 1.05;

    // Se il foglio è a vista intera: cambio pagina
    if (isSinglePageFit) {
      if (now - lastPageChangeTime.current > 250) {
        if (e.deltaY > 10 && currentPage < numPages) {
          lastPageChangeTime.current = now;
          setCurrentPage(currentPage + 1);
        } else if (e.deltaY < -10 && currentPage > 1) {
          lastPageChangeTime.current = now;
          setCurrentPage(currentPage - 1);
        }
      }
      return;
    }

    // Se il disegno è ingrandito in pagina singola, scorri il pan verticale
    const scrollStep = e.deltaY * 0.8;
    const newPanY = viewport.panY - scrollStep;

    const rect = containerRef.current.getBoundingClientRect();
    const pageH = (currentPageInfo?.height || 842) * viewport.zoom;

    // Cambio pagina al raggiungimento dei bordi
    if (newPanY > 80 && e.deltaY < -15) {
      if (now - lastPageChangeTime.current > 350 && currentPage > 1) {
        lastPageChangeTime.current = now;
        setCurrentPage(currentPage - 1);
        return;
      }
    } else if (newPanY < rect.height - pageH - 80 && e.deltaY > 15) {
      if (now - lastPageChangeTime.current > 350 && currentPage < numPages) {
        lastPageChangeTime.current = now;
        setCurrentPage(currentPage + 1);
        return;
      }
    }

    setViewport({
      ...viewport,
      panY: newPanY,
    });
  };

  const handleWheelRef = useRef(handleWheel);
  handleWheelRef.current = handleWheel;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onNativeWheel = (e: WheelEvent) => {
      handleWheelRef.current(e);
    };
    el.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', onNativeWheel);
  }, []);

  // Termina disegno multipunto
  const finishMultiPointDrawing = () => {
    if (drawingPoints.length < 2) {
      setDrawingPoints([]);
      return;
    }

    const pageIndex = currentPage - 1;
    const base = {
      id: crypto.randomUUID(),
      docId: (docId as 'primary' | 'secondary'),
      pageIndex,
      author: currentUser,
      creationDate: new Date().toISOString(),
      modificationDate: new Date().toISOString(),
      status: 'None' as const,
      strokeColor: activeColor,
      fillColor: activeFillColor,
      fillOpacity: activeFillOpacity,
      strokeWidth: activeStrokeWidth,
      opacity: activeOpacity,
      lineStyle: activeLineStyle,
      lineStyleScale: activeLineStyleScale,
      hatchPattern: activeHatchPattern !== 'none' ? activeHatchPattern : undefined,
      hatchColor: activeHatchColor,
      hatchScale: activeHatchScale,
      hatchAngle: activeHatchAngle,
    };

    if (activeTool === 'cloud_plus' && drawingPoints.length >= 3) {
      setCloudPlusCloudPts(drawingPoints);
      setCloudPlusStep('box_placement');
      setDrawingPoints([]);
      return;
    } else if (activeTool === 'cloud' && drawingPoints.length >= 3) {
      const cloudMarkup: CloudMarkup = {
        ...base,
        type: 'cloud',
        subject: 'Nuvoletta',
        contents: 'Revisione',
        points: drawingPoints,
      };
      addMarkup(cloudMarkup);
    } else if (activeTool === 'polyline') {
      addMarkup({
        ...base,
        type: 'polyline',
        subject: 'Polilinea',
        contents: '',
        points: drawingPoints,
        startHead: activeStartHead,
        endHead: activeEndHead,
      });
    } else if (activeTool === 'polygon' && drawingPoints.length >= 3) {
      addMarkup({
        ...base,
        type: 'polygon',
        subject: 'Poligono',
        contents: '',
        points: drawingPoints,
      });
    } else if (activeTool === 'measure_polyline') {
      const len = ScaleManager.calculatePolylineLength(drawingPoints);
      const measurePoly: MeasurePolylineMarkup = {
        ...base,
        type: 'measure_polyline',
        subject: 'Misura Polilinea',
        contents: 'Lunghezza',
        points: drawingPoints,
        measuredLength: len,
        realLength: len,
        unit: scaleCalibration?.unit || 'mm',
      };
      addMarkup(measurePoly);
    } else if (activeTool === 'measure_area' && drawingPoints.length >= 3) {
      const area = ScaleManager.calculatePolygonArea(drawingPoints);
      const areaMarkup: MeasureAreaMarkup = {
        ...base,
        type: 'measure_area',
        subject: 'Misura Area',
        contents: 'Superficie',
        points: drawingPoints,
        measuredArea: area,
        realArea: area,
        unit: scaleCalibration?.unit || 'mm',
      };
      addMarkup(areaMarkup);
    }

    setDrawingPoints([]);
  };

  const isRectangularTool = (tool: string) => {
    return [
      'rectangle',
      'ellipse',
      'cloud_rect',
      'cloud_plus',
      'measure_area_rect',
      'textbox',
      'line',
      'arrow',
      'connector',
      'measure_length',
      'calibrate',
      'snapshot',
      'hyperlink',
      'erase_content',
    ].includes(tool);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (inlineEditor) {
      commitInlineText();
    }

    // Tasto centrale / Spazio / Pan
    if (e.button === 1 || isSpacePressed || activeTool === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - viewport.panX, y: e.clientY - viewport.panY });
      return;
    }

    if (e.button !== 0) return;
    const rawPt = getPdfPointFromEvent(e);
    if (!rawPt) return;
    lastMousePageRef.current = { pt: rawPt, pageIndex: getPageIndexFromEvent(e) };

    // Selezione interattiva area cartiglio AutoMark (stile Bluebeam)
    if (isSelectingAutoMarkRegion) {
      setAutoMarkDragStart(rawPt);
      setAutoMarkDragCurrent(rawPt);
      return;
    }

    // Aggiunta nuova freccia (leader) ad un Callout esistente
    if (addingCalloutLeaderId) {
      const targetCallout = markups.find(
        (m) => m.id === addingCalloutLeaderId && m.type === 'callout'
      ) as CalloutMarkup | undefined;
      if (targetCallout) {
        const nextExtras = [...(targetCallout.extraArrows || []), rawPt];
        updateMarkup(targetCallout.id, { extraArrows: nextExtras } as any);
        selectMarkup(targetCallout.id);
      }
      setAddingCalloutLeaderId(null);
      return;
    }

    const pageIndex = getPageIndexFromEvent(e);
    if (pageViewMode === 'continuous' && pageIndex + 1 !== currentPage) {
      // Aggiorna lastProgrammaticPageRef prima di cambiare pagina così il foglio NON salta da solo durante click/istantanea
      lastProgrammaticPageRef.current = pageIndex + 1;
      setCurrentPage(pageIndex + 1);
    }

    // Esecuzione rapida Collegamento Ipertestuale su Ctrl+Click in modalità Seleziona
    if (activeTool === 'select' && (e.ctrlKey || e.metaKey)) {
      const clickedLink = [...markups]
        .reverse()
        .find(
          (m) =>
            m.type === 'hyperlink' &&
            (m.pageIndex ?? 0) === pageIndex &&
            rawPt.x >= (m as any).boxRect.x &&
            rawPt.x <= (m as any).boxRect.x + (m as any).boxRect.width &&
            rawPt.y >= (m as any).boxRect.y &&
            rawPt.y <= (m as any).boxRect.y + (m as any).boxRect.height
        ) as any;
      if (clickedLink) {
        if (clickedLink.actionType === 'url' && clickedLink.targetUrl) {
          window.open(clickedLink.targetUrl, '_blank', 'noopener,noreferrer');
        } else if (clickedLink.actionType === 'goto_page' && clickedLink.targetPage) {
          const st = useAppStore.getState();
          if (clickedLink.targetDocId && clickedLink.targetDocId !== st.activeDocumentId) {
            st.switchDocument(clickedLink.targetDocId);
          }
          useAppStore.getState().setCurrentPage(clickedLink.targetPage);
        }
        return;
      }
    }

    // 1. SELEZIONE, SPOSTAMENTO (MOVE) & GESTIONE HANDLES
    if (activeTool === 'eraser') {
      isErasingRef.current = true;
      const pageIndex = getPageIndexFromEvent(e);
      const hit = markups
        .filter((m) => isMarkupBelongingToPane(m) && (m.pageIndex ?? 0) === pageIndex && !useAppStore.getState().lockedMarkupIds.includes(m.id))
        .reverse()
        .find((m) => HitTester.hitTestMarkup(rawPt, m, 10 / viewport.zoom));
      if (hit) {
        deleteMarkup(hit.id);
      }
      return;
    }

    if (activeTool === 'select') {
      // A. Controlla prima se è stato cliccato un punto di presa (Handle) di un markup già selezionato
      const selectedMarkups = markups.filter(
        (m) =>
          selectedMarkupIds.includes(m.id) &&
          isMarkupBelongingToPane(m) &&
          (m.pageIndex ?? 0) === pageIndex
      );

      const isMarkupLockedOrOnLockedLayer = (m: AnyMarkup) => {
        if ((m as any).locked) return true;
        const lyr = layers.find((l) => l.id === (m.layerId || 'default'));
        return Boolean(lyr?.locked);
      };

      for (const selM of selectedMarkups) {
        if (isMarkupLockedOrOnLockedLayer(selM)) continue;
        const handleHit = HitTester.hitTestHandles(rawPt, selM, 10 / viewport.zoom);
        if (handleHit) {
          hasPushedDragUndoRef.current = false;
          setIsDraggingHandle(true);
          setActiveHandle(handleHit);
          setHandleSnapshot(structuredClone(selM));
          return;
        }
      }

      // B. Altrimenti controlla se è stato cliccato il corpo di un markup (per selezionarlo, applicare Copia formato e/o SPOSTARLO)
      const hit = markups
        .filter((m) => isMarkupBelongingToPane(m) && (m.pageIndex ?? 0) === pageIndex)
        .reverse()
        .find((m) => HitTester.hitTestMarkup(rawPt, m, 8 / viewport.zoom));

      if (formatPainterStyle && hit) {
        if ((formatPainterStyle as any).__waitingForSource) {
          setFormatPainterStyle(extractFormatStyle(hit));
          selectMarkup(hit.id);
          setSavedToastMsg('Formato copiato! Clicca sugli oggetti su cui applicarlo (Esc per uscire)');
          setTimeout(() => setSavedToastMsg(null), 2400);
        } else {
          applyFormatStyleToMarkups([hit.id], formatPainterStyle);
          selectMarkup(hit.id);
          setSavedToastMsg('Formato applicato! Continua a cliccare o premi Esc');
          setTimeout(() => setSavedToastMsg(null), 1800);
        }
        return;
      }

      if (hit) {
        let currentSelected = selectedMarkupIds;
        if (!selectedMarkupIds.includes(hit.id) && !e.shiftKey) {
          selectMarkup(hit.id);
          currentSelected = [hit.id];
        } else if (e.shiftKey) {
          selectMarkup(hit.id, true);
          currentSelected = selectedMarkupIds.includes(hit.id)
            ? selectedMarkupIds.filter((x) => x !== hit.id)
            : [...selectedMarkupIds, hit.id];
        }

        // Avvia la modalità SPOSTAMENTO (Move) per tutte le entità selezionate non bloccate!
        const toMove = markups.filter(
          (m) =>
            currentSelected.includes(m.id) &&
            isMarkupBelongingToPane(m) &&
            !isMarkupLockedOrOnLockedLayer(m)
        );
        if (toMove.length > 0) {
          hasPushedDragUndoRef.current = false;
          setIsMovingMarkups(true);
          setMoveStartPt(rawPt);
          setMoveSnapshots(toMove.map((m) => structuredClone(m)));
        }
        return;
      } else {
        // Clic a vuoto: avvia la FENCE DI SELEZIONE (Rettangolare o Lazo a mano libera in un unico comando Select!)
        const fenceMode = e.altKey || selectFenceMode === 'lasso' ? 'lasso' : 'rect';
        setActiveFenceType(fenceMode);
        setIsSelectingFence(true);
        setFenceStartPt(rawPt);
        setFenceCurrentPt(rawPt);
        setFencePoints([rawPt]);
        if (!e.shiftKey) {
          selectMarkup(null);
        }
      }
      return;
    }

    // Per tutti gli strumenti di disegno, se lo snap è attivo e c'è un bersaglio magnetico, usa le coordinate di snap!
    const pt = (snapEnabled && activeSnapTarget) ? activeSnapTarget.point : rawPt;

    const base = {
      id: crypto.randomUUID(),
      docId: (docId as 'primary' | 'secondary'),
      pageIndex,
      author: currentUser,
      creationDate: new Date().toISOString(),
      modificationDate: new Date().toISOString(),
      status: 'None' as const,
      strokeColor: activeColor,
      fillColor: activeFillColor,
      fillOpacity: activeFillOpacity,
      strokeWidth: activeStrokeWidth,
      opacity: activeOpacity,
      lineStyle: activeLineStyle,
      lineStyleScale: activeLineStyleScale,
      hatchPattern: activeHatchPattern !== 'none' ? activeHatchPattern : undefined,
      hatchColor: activeHatchColor,
      hatchScale: activeHatchScale,
      hatchAngle: activeHatchAngle,
    };

    // 1.5 INSERIMENTO SIMBOLO DA TOOL CHEST (Valvole, Pompe, Simboli P&ID Bluebeam, Strumenti Recenti)
    if (activeToolChestMarkup) {
      const clone: any = structuredClone(activeToolChestMarkup);
      clone.id = crypto.randomUUID();
      clone.docId = (docId as 'primary' | 'secondary');
      clone.pageIndex = pageIndex;
      clone.author = currentUser;
      clone.creationDate = new Date().toISOString();
      clone.modificationDate = new Date().toISOString();

      if (clone.compoundPaths && Array.isArray(clone.compoundPaths) && clone.compoundPaths.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        clone.compoundPaths.forEach((cp: any) => {
          if (cp.points) {
            cp.points.forEach((p: Point2D) => {
              minX = Math.min(minX, p.x);
              minY = Math.min(minY, p.y);
              maxX = Math.max(maxX, p.x);
              maxY = Math.max(maxY, p.y);
            });
          }
          if (cp.circle) {
            minX = Math.min(minX, cp.circle.cx - cp.circle.r);
            minY = Math.min(minY, cp.circle.cy - cp.circle.r);
            maxX = Math.max(maxX, cp.circle.cx + cp.circle.r);
            maxY = Math.max(maxY, cp.circle.cy + cp.circle.r);
          }
          if (cp.ellipse) {
            minX = Math.min(minX, cp.ellipse.cx - cp.ellipse.rx);
            minY = Math.min(minY, cp.ellipse.cy - cp.ellipse.ry);
            maxX = Math.max(maxX, cp.ellipse.cx + cp.ellipse.rx);
            maxY = Math.max(maxY, cp.ellipse.cy + cp.ellipse.ry);
          }
          if (cp.rect) {
            minX = Math.min(minX, cp.rect.x);
            minY = Math.min(minY, cp.rect.y);
            maxX = Math.max(maxX, cp.rect.x + cp.rect.width);
            maxY = Math.max(maxY, cp.rect.y + cp.rect.height);
          }
        });
        if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 28; maxY = 28; }
        const w = Math.max(1, maxX - minX);
        const h = Math.max(1, maxY - minY);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const dx = pt.x - cx;
        const dy = pt.y - cy;

        clone.compoundPaths = clone.compoundPaths.map((cp: any) => {
          const res = { ...cp };
          if (cp.points) {
            res.points = cp.points.map((p: Point2D) => ({ x: p.x + dx, y: p.y + dy }));
          }
          if (cp.circle) {
            res.circle = { ...cp.circle, cx: cp.circle.cx + dx, cy: cp.circle.cy + dy };
          }
          if (cp.ellipse) {
            res.ellipse = { ...cp.ellipse, cx: cp.ellipse.cx + dx, cy: cp.ellipse.cy + dy };
          }
          if (cp.rect) {
            res.rect = { ...cp.rect, x: cp.rect.x + dx, y: cp.rect.y + dy };
          }
          return res;
        });
        const newMinX = minX + dx;
        const newMinY = minY + dy;
        clone.boxRect = {
          x: newMinX,
          y: newMinY,
          width: w,
          height: h,
        };
        clone.points = [
          { x: newMinX, y: newMinY },
          { x: newMinX + w, y: newMinY },
          { x: newMinX + w, y: newMinY + h },
          { x: newMinX, y: newMinY + h },
        ];
      } else if ('startPoint' in clone && 'endPoint' in clone && clone.startPoint && clone.endPoint) {
        const cx = (clone.startPoint.x + clone.endPoint.x) / 2;
        const cy = (clone.startPoint.y + clone.endPoint.y) / 2;
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        clone.startPoint = { x: clone.startPoint.x + dx, y: clone.startPoint.y + dy };
        clone.endPoint = { x: clone.endPoint.x + dx, y: clone.endPoint.y + dy };
      } else if ('boxRect' in clone && clone.boxRect) {
        const bw = clone.boxRect.width || 60;
        const bh = clone.boxRect.height || 40;
        const dx = pt.x - (clone.boxRect.x + bw / 2);
        const dy = pt.y - (clone.boxRect.y + bh / 2);
        clone.boxRect = {
          x: pt.x - bw / 2,
          y: pt.y - bh / 2,
          width: bw,
          height: bh,
        };
        if (clone.arrowPoint) {
          clone.arrowPoint = { x: clone.arrowPoint.x + dx, y: clone.arrowPoint.y + dy };
        }
      } else if ('points' in clone && Array.isArray(clone.points) && clone.points.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        clone.points.forEach((p: Point2D) => {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        });
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        clone.points = clone.points.map((p: Point2D) => ({ x: p.x + dx, y: p.y + dy }));
      }

      addMarkup(clone);
      selectMarkup(clone.id);
      setActiveToolChestMarkup(null);
      setActiveTool('select');
      hasPushedDragUndoRef.current = false;
      setIsMovingMarkups(true);
      setMoveStartPt(rawPt);
      setMoveSnapshots([structuredClone(clone)]);
      return;
    }

    // 2. PENNA & EVIDENZIATORE A MANO LIBERA (P / H)
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      setIsDrawingFreehand(true);
      setFreehandPoints([pt]);
      return;
    }

    // 3. CALLOUT (Flusso Bluebeam Revu esatto)
    if (activeTool === 'callout') {
      if (!calloutArrowPt) {
        setCalloutArrowPt(pt);
      } else {
        const boxW = 140;
        const boxH = 38;
        const boxRect = {
          x: pt.x,
          y: pt.y - boxH / 2,
          width: boxW,
          height: boxH,
        };

        const calloutId = crypto.randomUUID();
        const callout: CalloutMarkup = {
          ...base,
          id: calloutId,
          type: 'callout',
          subject: 'Callout',
          contents: 'Nota revisione',
          arrowPoint: calloutArrowPt,
          boxRect,
          text: 'Nota revisione',
          fontSize: 11,
          fontFamily: 'Arial, sans-serif',
        };

        addMarkup(callout);
        setCalloutArrowPt(null);
        setActiveTool('select');

        setInlineEditor({
          markupId: calloutId,
          boxRect,
          text: 'Nota revisione',
        });
      }
      return;
    }

    // 3b. CLOUD+ (Flusso Bluebeam Revu: Passaggio 2 - Clic posizionamento box di testo)
    if (activeTool === 'cloud_plus' && cloudPlusStep === 'box_placement' && cloudPlusCloudPts) {
      const boxW = 140;
      const boxH = 38;
      const boxRect = {
        x: pt.x,
        y: pt.y - boxH / 2,
        width: boxW,
        height: boxH,
      };

      const leaderPt = findClosestPointOnPolygon(pt, cloudPlusCloudPts);
      const cloudPlusId = crypto.randomUUID();
      const cloudPlusMarkup: CloudPlusMarkup = {
        ...base,
        id: cloudPlusId,
        type: 'cloud_plus',
        subject: 'Cloud+ Nuvoletta Callout',
        contents: 'Nota revisione',
        cloudPoints: cloudPlusCloudPts,
        leaderPoint: leaderPt,
        boxRect,
        text: 'Nota revisione',
        fontSize: 11,
        fontFamily: 'Arial, sans-serif',
      };

      addMarkup(cloudPlusMarkup);
      selectMarkup(cloudPlusId);
      setCloudPlusStep('idle');
      setCloudPlusCloudPts(null);
      setActiveTool('select');

      setInlineEditor({
        markupId: cloudPlusId,
        boxRect,
        text: 'Nota revisione',
      });
      return;
    }

    // 3. CASELLA DI TESTO (Stile Bluebeam: se clicchi su testo esistente aprilo in modifica, altrimenti crea)
    if (activeTool === 'textbox') {
      const existingText = markups
        .filter((m) => m.pageIndex === pageIndex && (m.type === 'textbox' || m.type === 'callout'))
        .reverse()
        .find((m) => HitTester.hitTestMarkup(rawPt, m, 8 / viewport.zoom));

      if (existingText) {
        selectMarkup(existingText.id);
        setActiveTool('select');
        const b = (existingText as any).boxRect;
        inlineEditorOpenTimeRef.current = Date.now();
        setInlineEditor({
          markupId: existingText.id,
          boxRect: {
            x: Math.min(b.x, b.x + b.width),
            y: Math.min(b.y, b.y + b.height),
            width: Math.max(80, Math.abs(b.width)),
            height: Math.max(30, Math.abs(b.height)),
          },
          text: (existingText as any).text || existingText.contents || '',
        });
        return;
      }

      if (!dragStartPt) {
        setDragStartPt(pt);
        setIsDrawingDrag(true);
      }
      return;
    }

    // 4. CONTEGGIO
    if (activeTool === 'measure_count') {
      const existingCount = markups.find(
        (m) => m.pageIndex === pageIndex && m.type === 'measure_count'
      ) as MeasureCountMarkup | undefined;

      if (existingCount) {
        useAppStore.getState().updateMarkup(existingCount.id, {
          locations: [...existingCount.locations, pt],
          countNumber: existingCount.locations.length + 1,
        } as any);
      } else {
        const countMarkup: MeasureCountMarkup = {
          ...base,
          type: 'measure_count',
          subject: 'Conteggio',
          contents: 'Conteggio Pz',
          locations: [pt],
          countNumber: 1,
          symbol: 'circle',
        };
        addMarkup(countMarkup);
      }
      return;
    }

    // 5. TIMBRI
    if (activeTool === 'stamp') {
      const stampMarkup: StampMarkup = {
        ...base,
        type: 'stamp',
        subject: 'Timbro Tecnico',
        contents: 'APPROVATO',
        stampTitle: 'APPROVATO',
        dateStamp: new Date().toLocaleDateString('it-IT'),
        boxRect: {
          x: pt.x - 75,
          y: pt.y - 35,
          width: 150,
          height: 70,
        },
      };
      addMarkup(stampMarkup);
      setActiveTool('select');
      return;
    }

    // 6. STRUMENTI RETTANGOLARI / LINEARI (Drag a 2 punti)
    if (isRectangularTool(activeTool) && !(activeTool === 'cloud_plus' && drawingPoints.length > 0)) {
      if (!dragStartPt) {
        setDragStartPt(pt);
        setIsDrawingDrag(true);
      } else {
        commitRectangularMarkup(dragStartPt, pt);
      }
      return;
    }

    // 7. STRUMENTI MULTIPUNTO (Polilinea, Poligono, Nuvoletta, Misure)
    if (activeTool === 'cloud' && drawingPoints.length === 0) {
      isDrawingFreehandCloudRef.current = true;
      setDrawingPoints([pt]);
      return;
    }

    let nextPt = pt;
    if (drawingPoints.length >= 1) {
      const lastPt = drawingPoints[drawingPoints.length - 1];
      if (e.ctrlKey || orthoEnabled || isCtrlPressed) {
        nextPt = snapStrictOrtho(lastPt, pt);
      } else if (e.shiftKey || isShiftPressed) {
        nextPt = snapOrthoAngle(lastPt, pt);
      }
    }

    if (drawingPoints.length >= 2) {
      const lastPt = drawingPoints[drawingPoints.length - 1];
      const distToLast = Math.hypot(nextPt.x - lastPt.x, nextPt.y - lastPt.y);
      const firstPt = drawingPoints[0];
      const distToFirst = Math.hypot(nextPt.x - firstPt.x, nextPt.y - firstPt.y);

      // Clic sinistro sullo stesso punto o sul primo punto chiude/termina la marcatura (esattamente come INVIO)
      if (distToLast < 12 || (drawingPoints.length >= 3 && distToFirst < 12)) {
        finishMultiPointDrawing();
        return;
      }
    }

    setDrawingPoints((prev) => [...prev, nextPt]);
  };

  const commitRectangularMarkup = (p1: Point2D, p2: Point2D) => {
    const pageIndex = currentPage - 1;
    const base = {
      id: crypto.randomUUID(),
      docId: (docId as 'primary' | 'secondary'),
      pageIndex,
      author: currentUser,
      creationDate: new Date().toISOString(),
      modificationDate: new Date().toISOString(),
      status: 'None' as const,
      strokeColor: activeColor,
      fillColor: activeFillColor,
      fillOpacity: activeFillOpacity,
      strokeWidth: activeStrokeWidth,
      opacity: activeOpacity,
      lineStyle: activeLineStyle,
      lineStyleScale: activeLineStyleScale,
      hatchPattern: activeHatchPattern !== 'none' ? activeHatchPattern : undefined,
      hatchColor: activeHatchColor,
      hatchScale: activeHatchScale,
      hatchAngle: activeHatchAngle,
    };

    const effectivePt2 = (orthoEnabled || isCtrlPressed)
      ? snapStrictOrtho(p1, p2)
      : isShiftPressed
      ? snapOrthoAngle(p1, p2)
      : p2;
    const box = computeBoxRect(p1, p2, isShiftPressed);

    if (activeTool === 'rectangle') {
      if (box.width > 3 && box.height > 3) {
        const rectMarkup: RectangleMarkup = {
          ...base,
          type: 'rectangle',
          subject: 'Rettangolo',
          contents: '',
          boxRect: box,
        };
        addMarkup(rectMarkup);
      }
    } else if (activeTool === 'ellipse') {
      if (box.width > 3 && box.height > 3) {
        const ellipseMarkup: EllipseMarkup = {
          ...base,
          type: 'ellipse',
          subject: 'Ellisse',
          contents: '',
          boxRect: box,
        };
        addMarkup(ellipseMarkup);
      }
    } else if (activeTool === 'textbox') {
      const w = Math.max(80, box.width);
      const h = Math.max(30, box.height);
      const textRect = { x: box.x, y: box.y, width: w, height: h };
      const tbId = crypto.randomUUID();
      const tb: TextMarkup = {
        ...base,
        id: tbId,
        type: 'textbox',
        subject: 'Casella di Testo',
        contents: 'Testo',
        boxRect: textRect,
        text: 'Testo',
        fontSize: activeFontSize || 12,
        fontFamily: activeFontFamily || 'Arial, sans-serif',
      };
      addMarkup(tb);
      selectMarkup(tbId);
      setActiveTool('select');
      inlineEditorOpenTimeRef.current = Date.now();
      setInlineEditor({
        markupId: tbId,
        boxRect: textRect,
        text: 'Testo',
      });
      setDragStartPt(null);
      setIsDrawingDrag(false);
      return;
    } else if (activeTool === 'cloud_rect') {
      if (box.width > 5 && box.height > 5) {
        const rectPts: Point2D[] = [
          { x: box.x, y: box.y },
          { x: box.x + box.width, y: box.y },
          { x: box.x + box.width, y: box.y + box.height },
          { x: box.x, y: box.y + box.height },
        ];
        const cloudMarkup: CloudMarkup = {
          ...base,
          type: 'cloud_rect',
          subject: 'Nuvoletta Rettangolare',
          contents: 'Revisione',
          points: rectPts,
          arcRadius: 20,
        };
        addMarkup(cloudMarkup);
      }
    } else if (activeTool === 'cloud_plus') {
      if (box.width > 5 && box.height > 5) {
        const rectPts: Point2D[] = [
          { x: box.x, y: box.y },
          { x: box.x + box.width, y: box.y },
          { x: box.x + box.width, y: box.y + box.height },
          { x: box.x, y: box.y + box.height },
        ];
        setCloudPlusCloudPts(rectPts);
        setCloudPlusStep('box_placement');
        setIsDrawingDrag(false);
        setDragStartPt(null);
        return;
      } else {
        // Click singolo senza trascinare: avvia Nuvola+ Poligonale punto per punto (doppio clic o Invio per chiudere)
        setDrawingPoints([p1]);
        setIsDrawingDrag(false);
        setDragStartPt(null);
        return;
      }
    } else if (activeTool === 'measure_area_rect') {
      if (box.width > 5 && box.height > 5) {
        const rectPts: Point2D[] = [
          { x: box.x, y: box.y },
          { x: box.x + box.width, y: box.y },
          { x: box.x + box.width, y: box.y + box.height },
          { x: box.x, y: box.y + box.height },
        ];
        const area = box.width * box.height;
        const areaMarkup: MeasureAreaMarkup = {
          ...base,
          type: 'measure_area_rect',
          subject: 'Area Rettangolare',
          contents: 'Superficie',
          points: rectPts,
          measuredArea: area,
          realArea: area,
          unit: scaleCalibration?.unit || 'mm',
        };
        addMarkup(areaMarkup);
      }
    } else if (activeTool === 'snapshot') {
      if (box.width > 4 && box.height > 4) {
        const snapBox = { ...box };
        const snapPageIndex = pageIndex;
        const pageContainer = document.querySelector(`[data-page-index="${snapPageIndex}"]`);
        const baseCanvas = pageContainer?.querySelector('canvas[data-canvas-role="pdf-base"]') as HTMLCanvasElement | undefined;
        const overlayCanvas = pageContainer?.querySelector('canvas[data-canvas-role="markup"]') as HTMLCanvasElement | undefined;
        const pageW = pagesInfo[snapPageIndex]?.width || 595;
        const pageH = pagesInfo[snapPageIndex]?.height || 842;

        void (async () => {
          let outCanvas: HTMLCanvasElement | null = null;
          try {
            const pdfDoc = PDFManager.getInstance().getDocument(docId);
            if (pdfDoc) {
              const page = await pdfDoc.getPage(snapPageIndex + 1);
              const hiScale = Math.min(8.0, Math.max(2.0, 2048 / Math.max(snapBox.width, snapBox.height)));
              const hiViewport = page.getViewport({
                scale: hiScale,
                rotation: PDFManager.getEffectiveRotation(page.rotate, viewport.rotation || 0),
              });
              outCanvas = document.createElement('canvas');
              outCanvas.width = Math.max(1, Math.min(2400, Math.round(snapBox.width * hiScale)));
              outCanvas.height = Math.max(1, Math.min(2400, Math.round(snapBox.height * hiScale)));
              const actualScaleX = outCanvas.width / snapBox.width;
              const actualScaleY = outCanvas.height / snapBox.height;
              const octx = outCanvas.getContext('2d');
              if (octx) {
                octx.fillStyle = '#ffffff';
                octx.fillRect(0, 0, outCanvas.width, outCanvas.height);
                octx.save();
                octx.scale(actualScaleX / hiScale, actualScaleY / hiScale);
                octx.translate(-snapBox.x * hiScale, -snapBox.y * hiScale);
                await page.render({ canvasContext: octx, viewport: hiViewport, annotationMode: 0 } as any).promise;
                octx.restore();

                // Renderizza vettorialmente in alta definizione anche i markup presenti nell'area catturata
                const pageMarkups = markups.filter((m) => (m.pageIndex ?? 0) === snapPageIndex);
                if (pageMarkups.length > 0) {
                  octx.save();
                  octx.scale(actualScaleX, actualScaleY);
                  octx.translate(-snapBox.x, -snapBox.y);
                  pageMarkups.forEach((m) => {
                    MarkupRenderer.renderMarkup(octx, m, false, scaleCalibration);
                  });
                  octx.restore();
                }
              }
            }
          } catch {
            outCanvas = null;
          }

          if (!outCanvas && baseCanvas && baseCanvas.width > 0 && baseCanvas.height > 0) {
            const sx = (snapBox.x / pageW) * baseCanvas.width;
            const sy = (snapBox.y / pageH) * baseCanvas.height;
            const sw = Math.max(1, (snapBox.width / pageW) * baseCanvas.width);
            const sh = Math.max(1, (snapBox.height / pageH) * baseCanvas.height);
            outCanvas = document.createElement('canvas');
            outCanvas.width = Math.round(sw);
            outCanvas.height = Math.round(sh);
            const octx = outCanvas.getContext('2d');
            if (octx) {
              octx.fillStyle = '#ffffff';
              octx.fillRect(0, 0, outCanvas.width, outCanvas.height);
              octx.drawImage(baseCanvas, sx, sy, sw, sh, 0, 0, outCanvas.width, outCanvas.height);
              if (overlayCanvas && overlayCanvas.width > 0 && overlayCanvas.height > 0) {
                octx.drawImage(overlayCanvas, sx, sy, sw, sh, 0, 0, outCanvas.width, outCanvas.height);
              }
            }
          }

          if (outCanvas) {
            const dataUrl = outCanvas.toDataURL('image/png');
            useAppStore.setState({ clipboardMarkups: [] });
            setClipboardImageDataUrl(dataUrl, { width: snapBox.width, height: snapBox.height });
            outCanvas.toBlob((blob) => {
              if (blob && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
                void navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
              }
            }, 'image/png');
            setSavedToastMsg('Istantanea HD copiata negli appunti! Muovi il cursore e premi Ctrl+V per incollarla.');
            setTimeout(() => setSavedToastMsg(null), 2600);
          }
        })();
      }
      setActiveTool('select');
    } else if (activeTool === 'hyperlink') {
      if (box.width > 4 && box.height > 4) {
        useAppStore.getState().setPendingHyperlink({
          pageIndex,
          boxRect: { ...box },
        });
      }
    } else if (activeTool === 'erase_content') {
      if (box.width > 3 && box.height > 3) {
        const eraseRect: RectangleMarkup = {
          ...base,
          type: 'rectangle',
          subject: 'Cancella contenuto',
          contents: '',
          strokeColor: 'transparent',
          strokeWidth: 0,
          fillColor: '#ffffff',
          fillOpacity: 1,
          opacity: 1,
          boxRect: box,
        };
        addMarkup(eraseRect);
      }
    } else if (activeTool === 'connector') {
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (dist > 3) {
        const pts = buildOrthogonalConnectorPoints(p1, p2, isShiftPressed);
        addMarkup({
          ...base,
          type: 'polyline',
          subject: 'Connettore',
          contents: '',
          points: pts,
          startHead: activeStartHead,
          endHead: activeEndHead,
        });
      }
    } else if (activeTool === 'line' || activeTool === 'arrow') {
      const dist = Math.hypot(effectivePt2.x - p1.x, effectivePt2.y - p1.y);
      if (dist > 3) {
        const lineMarkup: LineMarkup = {
          ...base,
          type: activeTool,
          subject: activeTool === 'arrow' ? 'Freccia' : 'Linea',
          contents: '',
          startPoint: p1,
          endPoint: effectivePt2,
          startHead: activeStartHead,
          endHead: activeTool === 'arrow' ? 'arrow' : activeEndHead,
        };
        addMarkup(lineMarkup);
      }
    } else if (activeTool === 'measure_length') {
      const dist = Math.hypot(effectivePt2.x - p1.x, effectivePt2.y - p1.y);
      if (dist > 3) {
        const measureMarkup: MeasureLengthMarkup = {
          ...base,
          type: 'measure_length',
          subject: 'Misura Quota',
          contents: 'Quota',
          startPoint: p1,
          endPoint: effectivePt2,
          measuredLength: dist,
          realLength: dist,
          unit: scaleCalibration?.unit || 'mm',
          extensionOffset: 24,
          extensionOvershoot: 5,
          extensionGap: 2,
          dimensionEnding: 'tick',
          fontSize: 12,
          fontFamily: 'Segoe UI, sans-serif',
          textColor: '#ffff00',
          textPosition: 'above',
          showTextBackground: false,
        };
        addMarkup(measureMarkup);
      }
    } else if (activeTool === 'calibrate') {
      setCalibModalPts({ p1, p2: effectivePt2 });
    }

    setDragStartPt(null);
    setIsDrawingDrag(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setViewport({
        panX: e.clientX - panStart.x,
        panY: e.clientY - panStart.y,
      });
      return;
    }

    const rawPt = getPdfPointFromEvent(e);
    if (!rawPt) return;
    lastMousePageRef.current = { pt: rawPt, pageIndex: getPageIndexFromEvent(e) };

    // Gomma continua al trascinamento (penna / dito / mouse)
    if (isErasingRef.current && activeTool === 'eraser') {
      const pageIndex = getPageIndexFromEvent(e);
      const hit = markups
        .filter((m) => isMarkupBelongingToPane(m) && (m.pageIndex ?? 0) === pageIndex && !useAppStore.getState().lockedMarkupIds.includes(m.id))
        .reverse()
        .find((m) => HitTester.hitTestMarkup(rawPt, m, 10 / viewport.zoom));
      if (hit) {
        deleteMarkup(hit.id);
      }
      setCurrentMousePt(rawPt);
      return;
    }

    // Selezione interattiva area cartiglio AutoMark
    if (isSelectingAutoMarkRegion && autoMarkDragStart) {
      setAutoMarkDragCurrent(rawPt);
      return;
    }

    // Disegno a mano libera (Penna / Evidenziatore)
    if (isDrawingFreehand) {
      setFreehandPoints((prev) => [...prev, rawPt]);
      setCurrentMousePt(rawPt);
      return;
    }

    // Nuvola di revisione continua seguendo dito/penna
    if (isDrawingFreehandCloudRef.current && activeTool === 'cloud') {
      setDrawingPoints((prev) => {
        const last = prev[prev.length - 1];
        if (!last || Math.hypot(rawPt.x - last.x, rawPt.y - last.y) >= 14) {
          return [...prev, rawPt];
        }
        return prev;
      });
      setCurrentMousePt(rawPt);
      return;
    }

    // Trascinamento Fence di Selezione (Rettangolare o Lazo)
    if (isSelectingFence && fenceStartPt) {
      setFenceCurrentPt(rawPt);
      if (activeFenceType === 'lasso') {
        setFencePoints((prev) => {
          const last = prev[prev.length - 1];
          if (!last || Math.hypot(rawPt.x - last.x, rawPt.y - last.y) > 2) {
            return [...prev, rawPt];
          }
          return prev;
        });
      }
      setCurrentMousePt(rawPt);
      return;
    }

    const pageIndex = currentPage - 1;

    // GESTIONE SPOSTAMENTO REAL-TIME (MOVE MARKUPS)
    if (isMovingMarkups && moveStartPt && moveSnapshots.length > 0) {
      let dx = rawPt.x - moveStartPt.x;
      let dy = rawPt.y - moveStartPt.y;

      // Se Shift è fisicamente premuto: vincola movimento orizzontale o verticale puro; altrimenti spostamento libero
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) {
          dy = 0;
        } else {
          dx = 0;
        }
      }

      // Snap magnetico ad altri oggetti già disegnati + linee vettoriali del PDF CAD originale
      if (snapEnabled) {
        const movingIds = new Set(moveSnapshots.map((m) => m.id));
        const stationaryMarkups = markups.filter(
          (m) => isMarkupBelongingToPane(m) && !movingIds.has(m.id)
        );
        const markupTargets = SnapManager.extractSnapTargets(stationaryMarkups, pageIndex);
        const pdfTargets = PdfVectorSnapExtractor.getCachedTargets(docId, pageIndex, viewport.rotation || 0);
        if (!pdfTargets) {
          void PdfVectorSnapExtractor.extractPageTargets(docId, pageIndex, viewport.rotation || 0);
        }
        const stationaryTargets = pdfTargets && pdfTargets.length > 0 ? [...markupTargets, ...pdfTargets] : markupTargets;

        if (stationaryTargets.length > 0) {
          const movingKeyPoints = SnapManager.extractSnapTargets(moveSnapshots, pageIndex);
          const snapAdj = SnapManager.findSnapForTranslation(
            movingKeyPoints,
            dx,
            dy,
            stationaryTargets,
            viewport.zoom
          );

          if (snapAdj) {
            dx = snapAdj.deltaX;
            dy = snapAdj.deltaY;
            setActiveSnapTarget(snapAdj.target);
          } else {
            const cursorSnap = SnapManager.findSnap(rawPt, stationaryTargets, viewport.zoom);
            if (cursorSnap) {
              dx = cursorSnap.point.x - moveStartPt.x;
              dy = cursorSnap.point.y - moveStartPt.y;
              setActiveSnapTarget(cursorSnap.target);
            } else {
              setActiveSnapTarget(null);
            }
          }
        } else {
          setActiveSnapTarget(null);
        }
      } else {
        setActiveSnapTarget(null);
      }

      if (!hasPushedDragUndoRef.current) {
        hasPushedDragUndoRef.current = true;
        useAppStore.getState().pushUndoSnapshot();
      }
      moveSnapshots.forEach((orig) => {
        const updates: any = {};
        if ('boxRect' in orig && orig.boxRect) {
          updates.boxRect = {
            ...orig.boxRect,
            x: orig.boxRect.x + dx,
            y: orig.boxRect.y + dy,
          };
        }
        if (orig.compoundPaths && Array.isArray(orig.compoundPaths)) {
          updates.compoundPaths = orig.compoundPaths.map((cp) => {
            const res = { ...cp };
            if (cp.points) {
              res.points = cp.points.map((p: Point2D) => ({ x: p.x + dx, y: p.y + dy }));
            }
            if (cp.circle) {
              res.circle = { ...cp.circle, cx: cp.circle.cx + dx, cy: cp.circle.cy + dy };
            }
            if (cp.ellipse) {
              res.ellipse = { ...cp.ellipse, cx: cp.ellipse.cx + dx, cy: cp.ellipse.cy + dy };
            }
            if (cp.rect) {
              res.rect = { ...cp.rect, x: cp.rect.x + dx, y: cp.rect.y + dy };
            }
            return res;
          });
        }
        if ('points' in orig && Array.isArray((orig as any).points)) {
          updates.points = (orig as any).points.map((p: Point2D) => ({
            x: p.x + dx,
            y: p.y + dy,
          }));
        }
        if ('startPoint' in orig && 'endPoint' in orig && (orig as any).startPoint && (orig as any).endPoint) {
          const lm = orig as any;
          updates.startPoint = { x: lm.startPoint.x + dx, y: lm.startPoint.y + dy };
          updates.endPoint = { x: lm.endPoint.x + dx, y: lm.endPoint.y + dy };
        }
        if (orig.type === 'callout') {
          // Spostando il testo del Callout, le punte delle frecce (arrowPoint + extraArrows) RESTANO FISSE sul disegno!
          const cm = orig as CalloutMarkup;
          if (cm.elbowPoint) {
            updates.elbowPoint = { x: cm.elbowPoint.x + dx, y: cm.elbowPoint.y + dy };
          }
        }
        if (orig.type === 'cloud_plus') {
          const cpm = orig as CloudPlusMarkup;
          const b = cpm.boxRect;
          const tol = 8 / viewport.zoom;
          const startedInBox =
            moveSnapshots.length === 1 &&
            moveStartPt &&
            b &&
            moveStartPt.x >= b.x - tol &&
            moveStartPt.x <= b.x + b.width + tol &&
            moveStartPt.y >= b.y - tol &&
            moveStartPt.y <= b.y + b.height + tol;

          if (startedInBox) {
            // Spostando il testo, la nuvola di revisione (cloudPoints + leaderPoint) RESTA FERMA
            updates.boxRect = {
              ...b,
              x: b.x + dx,
              y: b.y + dy,
            };
            if (cpm.elbowPoint) {
              updates.elbowPoint = { x: cpm.elbowPoint.x + dx, y: cpm.elbowPoint.y + dy };
            }
          } else {
            if (cpm.cloudPoints) {
              updates.cloudPoints = cpm.cloudPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
            }
            if (cpm.leaderPoint) {
              updates.leaderPoint = { x: cpm.leaderPoint.x + dx, y: cpm.leaderPoint.y + dy };
            }
            if (moveSnapshots.length > 1 && b) {
              updates.boxRect = {
                ...b,
                x: b.x + dx,
                y: b.y + dy,
              };
            }
          }
        }
        updateMarkup(orig.id, updates, false);
      });
      return;
    }

    // GESTIONE TRASCINAMENTO PUNTI DI PRESA (HANDLE STRETCH / RESIZE)
    if (isDraggingHandle && activeHandle && handleSnapshot) {
      const orig = handleSnapshot as any;
      const updates: any = {};

      let effectiveHandlePt = rawPt;

      // Snap magnetico dell'handle ad altri oggetti già disegnati
      if (snapEnabled) {
        const otherMarkups = markups.filter(
          (m) => isMarkupBelongingToPane(m) && m.id !== orig.id
        );
        const snapTargets = SnapManager.extractSnapTargets(otherMarkups, pageIndex);
        const snapRes = SnapManager.findSnap(rawPt, snapTargets, viewport.zoom);
        if (snapRes) {
          effectiveHandlePt = snapRes.point;
          setActiveSnapTarget(snapRes.target);
        } else {
          setActiveSnapTarget(null);
        }
      } else {
        setActiveSnapTarget(null);
      }

      if (orig.type === 'cloud_plus') {
        const cpm = orig as CloudPlusMarkup;
        if (activeHandle.handleType === 'vertex' && cpm.cloudPoints) {
          const pts = cpm.cloudPoints;
          const isAxialRect =
            pts.length === 4 &&
            ((Math.abs(pts[0].y - pts[1].y) < 1 && Math.abs(pts[2].y - pts[3].y) < 1 &&
              Math.abs(pts[1].x - pts[2].x) < 1 && Math.abs(pts[3].x - pts[0].x) < 1) ||
             (Math.abs(pts[0].x - pts[1].x) < 1 && Math.abs(pts[2].x - pts[3].x) < 1 &&
              Math.abs(pts[1].y - pts[2].y) < 1 && Math.abs(pts[3].y - pts[0].y) < 1));
          if (isAxialRect) {
            const oppIdx = (activeHandle.handleIndex + 2) % 4;
            const opp = pts[oppIdx];
            const rect = computeBoxRect(opp, effectiveHandlePt, isShiftPressed);
            updates.cloudPoints = [
              { x: rect.x, y: rect.y },
              { x: rect.x + rect.width, y: rect.y },
              { x: rect.x + rect.width, y: rect.y + rect.height },
              { x: rect.x, y: rect.y + rect.height },
            ];
          } else {
            const newPts = [...pts];
            newPts[activeHandle.handleIndex] = effectiveHandlePt;
            updates.cloudPoints = newPts;
          }
        } else if (activeHandle.handleType === 'arrow') {
          updates.leaderPoint = effectiveHandlePt;
        } else if (activeHandle.handleType === 'elbow') {
          updates.elbowPoint = effectiveHandlePt;
        } else if (activeHandle.handleType === 'rect_edge' && cpm.boxRect) {
          const b = cpm.boxRect;
          let { x, y, width, height } = b;
          if (activeHandle.handleIndex === 0) {
            const bottom = b.y + b.height;
            y = Math.min(bottom - 14, effectiveHandlePt.y);
            height = bottom - y;
          } else if (activeHandle.handleIndex === 1) {
            width = Math.max(20, effectiveHandlePt.x - b.x);
          } else if (activeHandle.handleIndex === 2) {
            height = Math.max(14, effectiveHandlePt.y - b.y);
          } else if (activeHandle.handleIndex === 3) {
            const right = b.x + b.width;
            x = Math.min(right - 20, effectiveHandlePt.x);
            width = right - x;
          }
          updates.boxRect = { x, y, width, height };
        } else if (activeHandle.handleType === 'rect_corner' && cpm.boxRect) {
          const b = cpm.boxRect;
          const oppIdx = (activeHandle.handleIndex + 2) % 4;
          const corners = [
            { x: b.x, y: b.y },
            { x: b.x + b.width, y: b.y },
            { x: b.x + b.width, y: b.y + b.height },
            { x: b.x, y: b.y + b.height },
          ];
          const fixedCorner = corners[oppIdx];
          updates.boxRect = computeBoxRect(fixedCorner, effectiveHandlePt, isShiftPressed);
        }
      } else if (activeHandle.handleType === 'rotate') {
        if ('boxRect' in orig && orig.boxRect) {
          const b = orig.boxRect;
          const cx = b.x + b.width / 2;
          const cy = b.y + b.height / 2;
          let deg = (Math.atan2(rawPt.y - cy, rawPt.x - cx) * 180) / Math.PI + 90;
          if (isShiftPressed) {
            deg = Math.round(deg / 15) * 15;
          }
          updates.rotation = ((deg % 360) + 360) % 360;
        } else if ('points' in orig && Array.isArray((orig as any).points) && (orig as any).points.length > 0) {
          const pts: Point2D[] = (orig as any).points;
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const pt of pts) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
          }
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          let deg = (Math.atan2(rawPt.y - cy, rawPt.x - cx) * 180) / Math.PI + 90;
          if (isShiftPressed) {
            deg = Math.round(deg / 15) * 15;
          }
          const rad = (deg * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          updates.points = pts.map((pt) => {
            const dx = pt.x - cx;
            const dy = pt.y - cy;
            return {
              x: cx + dx * cos - dy * sin,
              y: cy + dx * sin + dy * cos,
            };
          });
        } else if ('startPoint' in orig && 'endPoint' in orig && (orig as any).startPoint && (orig as any).endPoint) {
          const sp = (orig as any).startPoint as Point2D;
          const ep = (orig as any).endPoint as Point2D;
          const cx = (sp.x + ep.x) / 2;
          const cy = (sp.y + ep.y) / 2;
          let deg = (Math.atan2(rawPt.y - cy, rawPt.x - cx) * 180) / Math.PI + 90;
          if (isShiftPressed) {
            deg = Math.round(deg / 15) * 15;
          }
          const rad = (deg * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const rotPt = (pt: Point2D): Point2D => {
            const dx = pt.x - cx;
            const dy = pt.y - cy;
            return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
          };
          updates.startPoint = rotPt(sp);
          updates.endPoint = rotPt(ep);
        }
      } else if (activeHandle.handleType === 'arrow' && orig.type === 'callout') {
        if (activeHandle.handleIndex === 0) {
          updates.arrowPoint = effectiveHandlePt;
        } else {
          const extras = [...((orig as CalloutMarkup).extraArrows || [])];
          const idx = activeHandle.handleIndex - 1;
          if (idx >= 0 && idx < extras.length) {
            extras[idx] = effectiveHandlePt;
            updates.extraArrows = extras;
          }
        }
      } else if (activeHandle.handleType === 'elbow' && orig.type === 'callout') {
        updates.elbowPoint = effectiveHandlePt;
      } else if (activeHandle.handleType === 'rect_edge' && 'boxRect' in orig && orig.boxRect) {
        const b = orig.boxRect;
        let { x, y, width, height } = b;
        if (activeHandle.handleIndex === 0) {
          const bottom = b.y + b.height;
          y = Math.min(bottom - 14, effectiveHandlePt.y);
          height = bottom - y;
        } else if (activeHandle.handleIndex === 1) {
          width = Math.max(20, effectiveHandlePt.x - b.x);
        } else if (activeHandle.handleIndex === 2) {
          height = Math.max(14, effectiveHandlePt.y - b.y);
        } else if (activeHandle.handleIndex === 3) {
          const right = b.x + b.width;
          x = Math.min(right - 20, effectiveHandlePt.x);
          width = right - x;
        }
        updates.boxRect = { x, y, width, height };
      } else if (activeHandle.handleType === 'dim_offset' && orig.type === 'measure_length') {
        const p1 = orig.startPoint;
        const p2 = orig.endPoint;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const nx = -dy / len;
          const ny = dx / len;
          const proj = (effectiveHandlePt.x - p1.x) * nx + (effectiveHandlePt.y - p1.y) * ny;
          updates.extensionOffset = Math.round(proj);
        }
      } else if (activeHandle.handleType === 'start' && 'startPoint' in orig) {
        const newStart = isShiftPressed ? snapOrthoAngle(orig.endPoint, effectiveHandlePt) : effectiveHandlePt;
        updates.startPoint = newStart;
        if (orig.type === 'measure_length') {
          const dist = Math.hypot(orig.endPoint.x - newStart.x, orig.endPoint.y - newStart.y);
          updates.measuredLength = dist;
          updates.realLength = dist;
        }
      } else if (activeHandle.handleType === 'end' && 'endPoint' in orig) {
        const newEnd = isShiftPressed ? snapOrthoAngle(orig.startPoint, effectiveHandlePt) : effectiveHandlePt;
        updates.endPoint = newEnd;
        if (orig.type === 'measure_length') {
          const dist = Math.hypot(newEnd.x - orig.startPoint.x, newEnd.y - orig.startPoint.y);
          updates.measuredLength = dist;
          updates.realLength = dist;
        }
      } else if (activeHandle.handleType === 'vertex' && 'points' in orig) {
        const newPts = [...orig.points];
        newPts[activeHandle.handleIndex] = effectiveHandlePt;
        updates.points = newPts;
      } else if (activeHandle.handleType === 'rect_corner' && 'boxRect' in orig && orig.boxRect) {
        const b = orig.boxRect;
        const oppIdx = (activeHandle.handleIndex + 2) % 4;
        const corners = [
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y },
          { x: b.x + b.width, y: b.y + b.height },
          { x: b.x, y: b.y + b.height },
        ];
        const fixedCorner = corners[oppIdx];
        const keepAspect =
          (orig.type === 'stamp' && Boolean((orig as StampMarkup).imageDataUrl)) ||
          (Boolean(orig.compoundPaths?.length) && isShiftPressed);
        let newBox: { x: number; y: number; width: number; height: number };
        if (keepAspect && b.width > 1 && b.height > 1) {
          const aspect = b.width / b.height;
          const rawW = Math.max(8, Math.abs(effectiveHandlePt.x - fixedCorner.x));
          const rawH = Math.max(8, Math.abs(effectiveHandlePt.y - fixedCorner.y));
          let finalW = rawW;
          let finalH = finalW / aspect;
          if (rawH * aspect > rawW) {
            finalH = rawH;
            finalW = finalH * aspect;
          }
          const dirX = effectiveHandlePt.x >= fixedCorner.x ? 1 : -1;
          const dirY = effectiveHandlePt.y >= fixedCorner.y ? 1 : -1;
          newBox = {
            x: dirX >= 0 ? fixedCorner.x : fixedCorner.x - finalW,
            y: dirY >= 0 ? fixedCorner.y : fixedCorner.y - finalH,
            width: finalW,
            height: finalH,
          };
        } else {
          newBox = computeBoxRect(fixedCorner, effectiveHandlePt, isShiftPressed);
        }
        updates.boxRect = newBox;

        // Se è un simbolo composto (BTX / Gruppo), scala proporzionalmente tutti i compoundPaths e points!
        if (orig.compoundPaths && Array.isArray(orig.compoundPaths) && b.width > 0.5 && b.height > 0.5) {
          const sx = Math.max(0.05, newBox.width / b.width);
          const sy = Math.max(0.05, newBox.height / b.height);
          updates.compoundPaths = orig.compoundPaths.map((cp: any) => {
            const res = { ...cp };
            if (cp.points) {
              res.points = cp.points.map((p: Point2D) => ({
                x: newBox.x + (p.x - b.x) * sx,
                y: newBox.y + (p.y - b.y) * sy,
              }));
            }
            if (cp.circle) {
              res.circle = {
                cx: newBox.x + (cp.circle.cx - b.x) * sx,
                cy: newBox.y + (cp.circle.cy - b.y) * sy,
                r: Math.max(0.5, cp.circle.r * ((sx + sy) / 2)),
              };
            }
            if (cp.ellipse) {
              res.ellipse = {
                cx: newBox.x + (cp.ellipse.cx - b.x) * sx,
                cy: newBox.y + (cp.ellipse.cy - b.y) * sy,
                rx: Math.max(0.5, cp.ellipse.rx * sx),
                ry: Math.max(0.5, cp.ellipse.ry * sy),
              };
            }
            if (cp.rect) {
              res.rect = {
                x: newBox.x + (cp.rect.x - b.x) * sx,
                y: newBox.y + (cp.rect.y - b.y) * sy,
                width: Math.max(0.5, cp.rect.width * sx),
                height: Math.max(0.5, cp.rect.height * sy),
              };
            }
            if (cp.type === 'text' && cp.fontSize) {
              res.fontSize = Math.max(2, cp.fontSize * Math.min(sx, sy));
            }
            return res;
          });
          updates.points = [
            { x: newBox.x, y: newBox.y },
            { x: newBox.x + newBox.width, y: newBox.y },
            { x: newBox.x + newBox.width, y: newBox.y + newBox.height },
            { x: newBox.x, y: newBox.y + newBox.height },
          ];
        }
      }

      if (!hasPushedDragUndoRef.current) {
        hasPushedDragUndoRef.current = true;
        useAppStore.getState().pushUndoSnapshot();
      }
      updateMarkup(orig.id, updates, false);
      return;
    }

    // Controllo Hover per cambiare cursore mouse su Select
    if (activeTool === 'select') {
      const isOver = markups
        .filter(isMarkupBelongingToPane)
        .some((m) => HitTester.hitTestMarkup(rawPt, m, 8 / viewport.zoom));
      setHoveredEntity(isOver);
    } else {
      setHoveredEntity(false);
    }

    let effectivePt = rawPt;

    // Calcolo SNAP ad Oggetto + Linee Vettoriali PDF CAD (Vertice, Punto Medio, Centro) stile Bluebeam
    if (snapEnabled && activeTool !== 'select' && activeTool !== 'pan') {
      const snapCandidates = markups.filter(isMarkupBelongingToPane);
      const markupTargets = SnapManager.extractSnapTargets(snapCandidates, pageIndex);
      const pdfTargets = PdfVectorSnapExtractor.getCachedTargets(docId, pageIndex, viewport.rotation || 0);
      if (!pdfTargets) {
        void PdfVectorSnapExtractor.extractPageTargets(docId, pageIndex, viewport.rotation || 0);
      }
      const snapTargets = pdfTargets && pdfTargets.length > 0 ? [...markupTargets, ...pdfTargets] : markupTargets;
      const snapRes = SnapManager.findSnap(rawPt, snapTargets, viewport.zoom);

      if (snapRes) {
        setActiveSnapTarget(snapRes.target);
        effectivePt = snapRes.point;
      } else {
        setActiveSnapTarget(null);
      }
    } else {
      setActiveSnapTarget(null);
    }

    setCurrentMousePt(effectivePt);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isErasingRef.current) {
      isErasingRef.current = false;
      return;
    }

    // Rilascio selezione area AutoMark (stile Bluebeam)
    if (isSelectingAutoMarkRegion && autoMarkDragStart && autoMarkDragCurrent) {
      const pageW = currentPageInfo?.width || 595;
      const pageH = currentPageInfo?.height || 842;
      const x1 = Math.min(autoMarkDragStart.x, autoMarkDragCurrent.x);
      const y1 = Math.min(autoMarkDragStart.y, autoMarkDragCurrent.y);
      const x2 = Math.max(autoMarkDragStart.x, autoMarkDragCurrent.x);
      const y2 = Math.max(autoMarkDragStart.y, autoMarkDragCurrent.y);

      const w = Math.max(10, x2 - x1);
      const h = Math.max(8, y2 - y1);

      const xPct = Math.max(0, Math.min(0.99, x1 / pageW));
      const yPct = Math.max(0, Math.min(0.99, y1 / pageH));
      const widthPct = Math.max(0.01, Math.min(1 - xPct, w / pageW));
      const heightPct = Math.max(0.01, Math.min(1 - yPct, h / pageH));

      setAutoMarkPendingRegion({ xPct, yPct, widthPct, heightPct });
      setIsSelectingAutoMarkRegion(false);
      setAutoMarkDragStart(null);
      setAutoMarkDragCurrent(null);
      return;
    }

    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isSelectingFence && fenceStartPt) {
      const endPt = fenceCurrentPt || fenceStartPt;
      const dist = Math.hypot(endPt.x - fenceStartPt.x, endPt.y - fenceStartPt.y);
      const pageIndex = currentPage - 1;
      const candidates = markups.filter(
        (m) => isMarkupBelongingToPane(m) && (m.pageIndex ?? 0) === pageIndex
      );

      if (dist >= 4) {
        if (activeFenceType === 'lasso' && fencePoints.length >= 3) {
          const hitIds = candidates
            .filter((m) => HitTester.isMarkupInLassoFence(m, fencePoints))
            .map((m) => m.id);
          selectMultipleMarkups(hitIds, e.shiftKey);
        } else {
          const fx = Math.min(fenceStartPt.x, endPt.x);
          const fy = Math.min(fenceStartPt.y, endPt.y);
          const fw = Math.abs(endPt.x - fenceStartPt.x);
          const fh = Math.abs(endPt.y - fenceStartPt.y);
          const isCrossing = endPt.x < fenceStartPt.x;
          const hitIds = candidates
            .filter((m) => HitTester.isMarkupInRectFence(m, { x: fx, y: fy, width: fw, height: fh }, isCrossing))
            .map((m) => m.id);
          selectMultipleMarkups(hitIds, e.shiftKey);
        }
      }
      setIsSelectingFence(false);
      setFenceStartPt(null);
      setFenceCurrentPt(null);
      setFencePoints([]);
      if (formatPainterStyle && !(formatPainterStyle as any).__waitingForSource) {
        const latestSel = useAppStore.getState().selectedMarkupIds;
        if (latestSel.length > 0) {
          applyFormatStyleToMarkups(latestSel, formatPainterStyle);
          setSavedToastMsg(`Formato applicato a ${latestSel.length} oggetti! (Esc per uscire)`);
          setTimeout(() => setSavedToastMsg(null), 2000);
        }
      }
      return;
    }

    if (isMovingMarkups) {
      setIsMovingMarkups(false);
      setMoveStartPt(null);
      setMoveSnapshots([]);
      setActiveSnapTarget(null);
      return;
    }

    if (isDraggingHandle) {
      setIsDraggingHandle(false);
      setActiveHandle(null);
      setHandleSnapshot(null);
      setActiveSnapTarget(null);
      return;
    }

    if (isDrawingFreehand) {
      if (freehandPoints.length >= 2) {
        const pageIndex = currentPage - 1;
        const baseFreehand = {
          id: crypto.randomUUID(),
          docId: (docId as 'primary' | 'secondary'),
          pageIndex,
          author: currentUser,
          creationDate: new Date().toISOString(),
          modificationDate: new Date().toISOString(),
          status: 'None' as const,
          strokeColor: activeColor,
          fillColor: activeFillColor,
          fillOpacity: activeFillOpacity,
          strokeWidth: activeTool === 'highlighter' ? Math.max(12, activeStrokeWidth) : Math.max(1.5, activeStrokeWidth),
          opacity: activeTool === 'highlighter' ? 0.38 : activeOpacity,
          lineStyle: activeLineStyle,
          lineStyleScale: activeLineStyleScale,
        };

        const recognized = activeTool === 'pen' ? recognizeFreehandShape(freehandPoints) : null;
        if (recognized?.kind === 'line') {
          const endPt = orthoEnabled
            ? snapStrictOrtho(recognized.startPoint, recognized.endPoint)
            : recognized.endPoint;
          addMarkup({
            ...baseFreehand,
            type: 'line',
            subject: 'Linea',
            contents: '',
            startPoint: recognized.startPoint,
            endPoint: endPt,
          } as LineMarkup);
        } else if (recognized?.kind === 'circle') {
          addMarkup({
            ...baseFreehand,
            type: 'ellipse',
            subject: 'Cerchio',
            contents: '',
            boxRect: recognized.boxRect,
          } as EllipseMarkup);
        } else if (recognized?.kind === 'rectangle') {
          addMarkup({
            ...baseFreehand,
            type: 'rectangle',
            subject: recognized.isSquare ? 'Quadrato' : 'Rettangolo',
            contents: '',
            boxRect: recognized.boxRect,
          } as RectangleMarkup);
        } else if (recognized?.kind === 'triangle') {
          addMarkup({
            ...baseFreehand,
            type: 'polygon',
            subject: 'Triangolo',
            contents: '',
            points: recognized.points,
          } as PolygonMarkup);
        } else {
          addMarkup({
            ...baseFreehand,
            type: activeTool,
            subject: activeTool === 'highlighter' ? 'Evidenziatore' : 'Penna',
            contents: '',
            points: freehandPoints,
          } as any);
        }
      }
      setIsDrawingFreehand(false);
      setFreehandPoints([]);
      return;
    }

    if (isDrawingFreehandCloudRef.current && activeTool === 'cloud') {
      isDrawingFreehandCloudRef.current = false;
      if (drawingPoints.length >= 3) {
        finishMultiPointDrawing();
      }
      return;
    }

    if (isDrawingDrag && dragStartPt) {
      const rawPt = getPdfPointFromEvent(e);
      if (rawPt) {
        const endPt = (snapEnabled && activeSnapTarget) ? activeSnapTarget.point : rawPt;
        const dist = Math.hypot(endPt.x - dragStartPt.x, endPt.y - dragStartPt.y);
        if (dist >= 5) {
          commitRectangularMarkup(dragStartPt, endPt);
        } else if (activeTool === 'textbox') {
          const defaultBox = { x: dragStartPt.x, y: dragStartPt.y, width: 140, height: 34 };
          const pageIndex = currentPage - 1;
          const tbId = crypto.randomUUID();
          const tb: TextMarkup = {
            id: tbId,
            docId: (docId as 'primary' | 'secondary'),
            pageIndex,
            author: currentUser,
            creationDate: new Date().toISOString(),
            modificationDate: new Date().toISOString(),
            status: 'None',
            strokeColor: activeColor,
            fillColor: activeFillColor,
            fillOpacity: activeFillOpacity,
            strokeWidth: activeStrokeWidth,
            opacity: activeOpacity,
            lineStyle: activeLineStyle,
            type: 'textbox',
            subject: 'Casella di Testo',
            contents: 'Testo',
            boxRect: defaultBox,
            text: 'Testo',
            fontSize: activeFontSize || 12,
            fontFamily: activeFontFamily || 'Arial, sans-serif',
          };
          addMarkup(tb);
          selectMarkup(tbId);
          setActiveTool('select');
          inlineEditorOpenTimeRef.current = Date.now();
          setInlineEditor({
            markupId: tbId,
            boxRect: defaultBox,
            text: 'Testo',
          });
          setDragStartPt(null);
          setIsDrawingDrag(false);
          return;
        }
      }
    }
  };

  const isErasingRef = useRef<boolean>(false);
  const isDrawingFreehandCloudRef = useRef<boolean>(false);
  const activePointersRef = useRef<Map<number, { x: number; y: number; type: string }>>(new Map());
  const activePenIdRef = useRef<number | null>(null);
  const lastPenTimeRef = useRef<number>(0);
  const singleTouchPanRef = useRef<{ pointerId: number; startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const lastDrawStartTimeRef = useRef<number>(0);
  const touchPinchRef = useRef<{
    active: boolean;
    startDist: number;
    startZoom: number;
    startMidX: number;
    startMidY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  const buildSyntheticMouseEvent = (clientX: number, clientY: number): React.MouseEvent =>
    ({
      clientX,
      clientY,
      button: 0,
      buttons: 1,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: () => {},
      stopPropagation: () => {},
    }) as unknown as React.MouseEvent;

  const cancelInProgressMicroDraw = () => {
    isDrawingFreehandCloudRef.current = false;
    if (isDrawingFreehand) {
      setIsDrawingFreehand(false);
      setFreehandPoints([]);
    }
    if (isDrawingDrag) {
      setIsDrawingDrag(false);
      setDragStartPt(null);
    }
    if (drawingPoints.length > 0 && Date.now() - lastDrawStartTimeRef.current < 300) {
      setDrawingPoints([]);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;

    // Palm rejection: scarta tocchi con area molto larga (>75px = palmo) o mentre la penna è poggiata
    if (e.pointerType === 'touch') {
      if (e.width > 75 || e.height > 75 || activePenIdRef.current !== null) {
        return;
      }
    }

    if (e.pointerType === 'pen') {
      activePenIdRef.current = e.pointerId;
      lastPenTimeRef.current = Date.now();
      singleTouchPanRef.current = null;
      touchPinchRef.current = null;
      lastDrawStartTimeRef.current = Date.now();
      handleMouseDown(buildSyntheticMouseEvent(e.clientX, e.clientY));
      return;
    }

    // Touch valido (dito)
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const touchPts = Array.from(activePointersRef.current.values()).filter((p) => p.type === 'touch');

    if (touchPts.length >= 2) {
      // 2 dita -> Pinch-to-Zoom + Pan (annulla eventuale micro-disegno appena iniziato dal 1° dito)
      cancelInProgressMicroDraw();
      singleTouchPanRef.current = null;
      const t1 = touchPts[0];
      const t2 = touchPts[1];
      const dist = Math.hypot(t2.x - t1.x, t2.y - t1.y);
      const midX = (t1.x + t2.x) / 2;
      const midY = (t1.y + t2.y) / 2;
      touchPinchRef.current = {
        active: true,
        startDist: Math.max(10, dist),
        startZoom: viewport.zoom,
        startMidX: midX,
        startMidY: midY,
        startPanX: viewport.panX,
        startPanY: viewport.panY,
      };
      return;
    }

    if (touchPts.length === 1 && !touchPinchRef.current?.active) {
      // Se si sta usando la Focus Pen (negli ultimi 6s) e lo strumento attivo disegna, 1 dito fa PAN invece di scarabocchiare
      const penUsedRecently = Date.now() - lastPenTimeRef.current < 6000;
      if (penUsedRecently && activeTool !== 'select' && activeTool !== 'select_text') {
        singleTouchPanRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          startPanX: viewport.panX,
          startPanY: viewport.panY,
        };
        return;
      }
      lastDrawStartTimeRef.current = Date.now();
      handleMouseDown(buildSyntheticMouseEvent(e.clientX, e.clientY));
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;

    if (e.pointerType === 'pen') {
      lastPenTimeRef.current = Date.now();
      if (activePenIdRef.current === e.pointerId || e.buttons > 0) {
        handleMouseMove(buildSyntheticMouseEvent(e.clientX, e.clientY));
      }
      return;
    }

    if (e.pointerType === 'touch') {
      if (activePenIdRef.current !== null || e.width > 75 || e.height > 75) return;
      if (!activePointersRef.current.has(e.pointerId)) return;
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

      const touchPts = Array.from(activePointersRef.current.values()).filter((p) => p.type === 'touch');
      if (touchPts.length >= 2 && touchPinchRef.current?.active && containerRef.current) {
        const t1 = touchPts[0];
        const t2 = touchPts[1];
        const dist = Math.hypot(t2.x - t1.x, t2.y - t1.y);
        const midX = (t1.x + t2.x) / 2;
        const midY = (t1.y + t2.y) / 2;
        const rect = containerRef.current.getBoundingClientRect();
        const pinch = touchPinchRef.current;

        const scaleFactor = dist / pinch.startDist;
        const nextZoom = Math.min(24.0, Math.max(0.04, pinch.startZoom * scaleFactor));
        const zoomRatio = nextZoom / pinch.startZoom;

        const anchorX = pinch.startMidX - rect.left;
        const anchorY = pinch.startMidY - rect.top;
        const deltaMidX = midX - pinch.startMidX;
        const deltaMidY = midY - pinch.startMidY;

        const nextPanX = anchorX - (anchorX - pinch.startPanX) * zoomRatio + deltaMidX;
        const nextPanY = anchorY - (anchorY - pinch.startPanY) * zoomRatio + deltaMidY;

        setViewport({ zoom: nextZoom, panX: nextPanX, panY: nextPanY });
        return;
      }

      if (singleTouchPanRef.current && singleTouchPanRef.current.pointerId === e.pointerId) {
        const p = singleTouchPanRef.current;
        setViewport({
          panX: p.startPanX + (e.clientX - p.startX),
          panY: p.startPanY + (e.clientY - p.startY),
        });
        return;
      }

      if (touchPts.length === 1 && !touchPinchRef.current?.active) {
        handleMouseMove(buildSyntheticMouseEvent(e.clientX, e.clientY));
      }
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;

    if (e.pointerType === 'pen') {
      if (activePenIdRef.current === e.pointerId) {
        activePenIdRef.current = null;
      }
      lastPenTimeRef.current = Date.now();
      handleMouseUp(buildSyntheticMouseEvent(e.clientX, e.clientY));
      return;
    }

    activePointersRef.current.delete(e.pointerId);
    if (singleTouchPanRef.current?.pointerId === e.pointerId) {
      singleTouchPanRef.current = null;
      return;
    }
    if (touchPinchRef.current?.active) {
      const touchPts = Array.from(activePointersRef.current.values()).filter((p) => p.type === 'touch');
      if (touchPts.length < 2) {
        touchPinchRef.current = null;
      }
      return;
    }
    handleMouseUp(buildSyntheticMouseEvent(e.clientX, e.clientY));
  };

  // Doppio Clic: Modifica testo inline
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (drawingPoints.length >= 2) {
      finishMultiPointDrawing();
      return;
    }

    const pt = getPdfPointFromEvent(e);
    if (!pt) return;

    const pageIndex = getPageIndexFromEvent(e);
    if (pageViewMode === 'continuous' && pageIndex + 1 !== currentPage) {
      // Aggiorna lastProgrammaticPageRef prima di cambiare pagina così il foglio NON salta da solo durante click/istantanea
      lastProgrammaticPageRef.current = pageIndex + 1;
      setCurrentPage(pageIndex + 1);
    }

    // Doppio click su Collegamento Ipertestuale: apre la finestra Azione per modificarlo
    const dblClickedLink = [...markups]
      .reverse()
      .find(
        (m) =>
          m.type === 'hyperlink' &&
          (m.pageIndex ?? 0) === pageIndex &&
          pt.x >= (m as any).boxRect.x &&
          pt.x <= (m as any).boxRect.x + (m as any).boxRect.width &&
          pt.y >= (m as any).boxRect.y &&
          pt.y <= (m as any).boxRect.y + (m as any).boxRect.height
      ) as any;
    if (dblClickedLink) {
      useAppStore.getState().setPendingHyperlink({
        pageIndex,
        boxRect: dblClickedLink.boxRect,
        existingMarkupId: dblClickedLink.id,
      });
      return;
    }

    // 1. Doppio clic su Casella di Testo, Callout, Cloud+, o qualsiasi markup dotato di boxRect (es. Nota / Evidenziatore / Rettangolo)
    const hitBoxMarkup = markups
      .filter((m) => isMarkupBelongingToPane(m) && (m.pageIndex ?? 0) === pageIndex && 'boxRect' in m)
      .reverse()
      .find((m) => {
        const b = (m as any).boxRect;
        if (!b) return false;
        const minX = Math.min(b.x, b.x + b.width) - 8;
        const maxX = Math.max(b.x, b.x + b.width) + 8;
        const minY = Math.min(b.y, b.y + b.height) - 8;
        const maxY = Math.max(b.y, b.y + b.height) + 8;
        return pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;
      });

    if (hitBoxMarkup) {
      selectMarkup(hitBoxMarkup.id);
      setActiveTool('select');

      // Se è un blocco raggruppato (compoundPaths), verifica se il doppio clic è su una casella di testo interna!
      if (hitBoxMarkup.compoundPaths && hitBoxMarkup.compoundPaths.length > 0) {
        const textSubIdx = hitBoxMarkup.compoundPaths.findIndex((cp) => {
          if (cp.type !== 'text' || !cp.rect) return false;
          const r = cp.rect;
          return (
            pt.x >= r.x - 4 &&
            pt.x <= r.x + r.width + 4 &&
            pt.y >= r.y - 4 &&
            pt.y <= r.y + r.height + 4
          );
        });
        if (textSubIdx >= 0) {
          const cp = hitBoxMarkup.compoundPaths[textSubIdx];
          const r = cp.rect!;
          inlineEditorOpenTimeRef.current = Date.now();
          setInlineEditor({
            markupId: hitBoxMarkup.id,
            subPathIndex: textSubIdx,
            boxRect: {
              x: r.x,
              y: r.y,
              width: Math.max(90, r.width),
              height: Math.max(24, r.height),
            },
            text: cp.text || '',
          });
          return;
        }
      }

      const b = (hitBoxMarkup as any).boxRect;
      const normBox = {
        x: Math.min(b.x, b.x + b.width),
        y: Math.min(b.y, b.y + b.height),
        width: Math.max(140, Math.abs(b.width)),
        height: Math.max(36, Math.abs(b.height)),
      };
      inlineEditorOpenTimeRef.current = Date.now();
      setInlineEditor({
        markupId: hitBoxMarkup.id,
        boxRect: normBox,
        text: (hitBoxMarkup as any).text || hitBoxMarkup.contents || '',
      });
      return;
    }

    // 2. Doppio clic su Nuvoletta / Poligono / Polilinea per modificarne il commento inline
    const hitPolyMarkup = markups
      .filter(
        (m) =>
          isMarkupBelongingToPane(m) &&
          (m.pageIndex ?? 0) === pageIndex &&
          (m.type === 'cloud' || m.type === 'cloud_rect' || m.type === 'polygon' || m.type === 'polyline')
      )
      .reverse()
      .find((m) => HitTester.hitTestMarkup(pt, m, 12 / viewport.zoom));

    if (hitPolyMarkup) {
      selectMarkup(hitPolyMarkup.id);
      setActiveTool('select');
      inlineEditorOpenTimeRef.current = Date.now();
      setInlineEditor({
        markupId: hitPolyMarkup.id,
        boxRect: {
          x: pt.x - 80,
          y: pt.y - 20,
          width: 180,
          height: 44,
        },
        text: hitPolyMarkup.contents || '',
      });
      return;
    }

    // Doppio clic su Quota (measure_length, measure_polyline, measure_area)
    const hitMeasure = markups
      .filter((m) => m.pageIndex === pageIndex && (m.type === 'measure_length' || m.type === 'measure_polyline' || m.type === 'measure_area' || m.type === 'measure_area_rect'))
      .reverse()
      .find((m) => HitTester.hitTestMarkup(pt, m, 20));

    if (hitMeasure) {
      selectMarkup(hitMeasure.id);
      if (hitMeasure.type === 'measure_length') {
        const ml = hitMeasure as MeasureLengthMarkup;
        const p1 = ml.startPoint;
        const p2 = ml.endPoint;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        const nx = len > 0 ? -dy / len : 0;
        const ny = len > 0 ? dx / len : 0;
        const offset = ml.extensionOffset !== undefined ? ml.extensionOffset : 24;
        const midX = (p1.x + p2.x) / 2 + nx * offset;
        const midY = (p1.y + p2.y) / 2 + ny * offset;

        const currentVal = ml.customText !== undefined && ml.customText !== ''
          ? ml.customText
          : (ml.showUnit === false && scaleCalibration
              ? (ml.measuredLength * (scaleCalibration.scaleRatio || 1)).toFixed(1)
              : ScaleManager.formatLength(ml.measuredLength, scaleCalibration));

        inlineEditorOpenTimeRef.current = Date.now();
        setInlineEditor({
          markupId: ml.id,
          boxRect: {
            x: midX - 60,
            y: midY - (ml.textPosition === 'center' ? 14 : 28),
            width: 120,
            height: 28,
          },
          text: currentVal,
        });
      } else {
        const currentVal = (hitMeasure as any).customText || hitMeasure.contents || '';
        inlineEditorOpenTimeRef.current = Date.now();
        setInlineEditor({
          markupId: hitMeasure.id,
          boxRect: {
            x: pt.x - 60,
            y: pt.y - 14,
            width: 120,
            height: 28,
          },
          text: currentVal,
        });
      }
      return;
    }
  };

  // Posizione sullo schermo per l'editor di testo inline (supporta sia Pagina Singola che Continue)
  const getInlineEditorScreenStyle = () => {
    if (!inlineEditor) return {};
    const targetMarkup = markups.find((m) => m.id === inlineEditor.markupId);
    const mPageIndex = targetMarkup?.pageIndex !== undefined 
      ? targetMarkup.pageIndex 
      : (pendingTextEditRef.current ? pendingTextEditRef.current.pageIndex : (currentPage - 1));

    let offX = 0;
    let offY = 0;
    if (pageViewMode === 'continuous') {
      const pInfo = pagesInfo[mPageIndex] || { width: 595, height: 842 };
      offX = (maxPageWidth - pInfo.width) / 2;
      offY = pageOffsets[mPageIndex] || 0;
    }

    const screenPt = CoordinateTransformer.pageToScreen(
      { x: inlineEditor.boxRect.x + offX, y: inlineEditor.boxRect.y + offY },
      viewport.panX,
      viewport.panY,
      viewport.zoom
    );
    const isMeasure = targetMarkup?.type?.startsWith('measure');
    const isSubText = inlineEditor.subPathIndex !== undefined;
    const subCp = isSubText ? targetMarkup?.compoundPaths?.[inlineEditor.subPathIndex!] : undefined;
    const subFs = subCp?.fontSize || (targetMarkup as any)?.fontSize || 10;
    const lineCount = Math.max(1, inlineEditor.text.split(/\r?\n/).length);
    const maxLineLen = Math.max(4, ...inlineEditor.text.split(/\r?\n/).map((l) => l.length));
    const estW = isSubText
      ? Math.max(inlineEditor.boxRect.width, maxLineLen * subFs * 0.66 + 14)
      : inlineEditor.boxRect.width;
    const estH = isSubText
      ? Math.max(inlineEditor.boxRect.height, lineCount * subFs * 1.35 + 4)
      : inlineEditor.boxRect.height;
    const minW = isSubText ? 60 : isMeasure ? 130 : 100;
    const minH = isSubText ? 18 : isMeasure ? 28 : 34;
    return {
      left: `${screenPt.x}px`,
      top: `${screenPt.y}px`,
      width: `${Math.max(minW, estW * viewport.zoom)}px`,
      height: `${Math.max(minH, estH * viewport.zoom)}px`,
    };
  };

  const getCanvasCursor = () => {
    if (isSelectingAutoMarkRegion) return 'cursor-crosshair';
    if (isPanning || isSpacePressed || activeTool === 'pan') {
      return 'cursor-grab active:cursor-grabbing';
    }
    if (activeTool === 'eraser') return 'cursor-crosshair';

    if (activeTool === 'select') {
      if (isMovingMarkups) return 'cursor-grabbing';
      if (isDraggingHandle) return 'cursor-crosshair';
      if (hoveredEntity) return 'cursor-move';
      return 'cursor-default';
    }
    return 'cursor-crosshair';
  };

  return (
    <div className="flex flex-col flex-1 h-full w-full overflow-hidden relative">
      {/* Intestazione Riquadro mostrata solo quando è attiva la Divisione Schermo (Split View) */}
      {isSplitActive && (
      <div
        className={`h-7 border-b flex items-center justify-between px-2 text-[11px] select-none z-10 shrink-0 transition-colors ${
          isActiveSplitPane
            ? 'bg-[#252528] border-[#0078d4] border-t-2 border-t-[#0078d4]'
            : 'bg-[#1d1d1f] border-[#333333] border-t-2 border-t-transparent'
        }`}
      >
        <div className="flex items-center space-x-2 truncate min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${isActiveSplitPane ? 'bg-[#0078d4]' : 'bg-[#555555]'}`} />
          
          {/* Selettore rapido documento nel riquadro */}
          {openDocuments.length > 1 ? (
            isSecondary ? (
              <div className="flex items-center space-x-1">
                <span className="text-[10px] text-[#00b7c3] font-semibold uppercase">Riquadro 2:</span>
                <select
                  value={secondaryDocumentId || (secondaryFileBytes ? '__custom__' : '__same__')}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__same__') {
                      const primaryDoc = openDocuments.find((d) => d.id === activeDocumentId);
                      if (primaryDoc) {
                        setSecondaryFromOpenDoc(primaryDoc.id);
                      }
                    } else if (val !== '__custom__') {
                      setSecondaryFromOpenDoc(val);
                    }
                  }}
                  className="bg-[#181818] border border-[#00b7c3] rounded px-1.5 py-0.5 text-[#00b7c3] text-[11px] font-semibold max-w-[210px] outline-none cursor-pointer hover:border-white"
                  title="Seleziona quale documento visualizzare in questo riquadro destro"
                >
                  {openDocuments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fileName}
                    </option>
                  ))}
                  <option value="__same__">Stesso documento ({primaryFileName || 'Principale'})</option>
                  {secondaryFileBytes && !secondaryDocumentId && (
                    <option value="__custom__">{secondaryFileName || 'PDF Esterno'}</option>
                  )}
                </select>
              </div>
            ) : (
              <div className="flex items-center space-x-1">
                <span className="text-[10px] text-[#0078d4] font-semibold uppercase">Riquadro 1:</span>
                <select
                  value={activeDocumentId}
                  onChange={(e) => switchDocument(e.target.value)}
                  className="bg-[#181818] border border-[#0078d4] rounded px-1.5 py-0.5 text-white text-[11px] font-semibold max-w-[210px] outline-none cursor-pointer hover:border-white"
                  title="Seleziona quale documento visualizzare in questo riquadro sinistro"
                >
                  {openDocuments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fileName}
                    </option>
                  ))}
                </select>
              </div>
            )
          ) : (
            <span className="font-semibold text-white truncate max-w-[220px]" title={fileName}>
              {fileName || (isSecondary ? 'Secondo Documento / Vista 2' : 'Nessun Documento')}
            </span>
          )}

          {isSecondary && !secondaryFileBytes && !secondaryDocumentId && (
            <span className="text-[10px] text-[#888] italic">
              (Stesso documento - Vista divisa)
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1.5">
          {/* Selettore pagina di questo riquadro */}
          {numPages > 0 && (
            <div className="flex items-center bg-[#181818] px-1.5 py-0.5 rounded border border-[#383838]">
              <button
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(currentPage - 1)}
                className="px-1 hover:bg-[#2d2d30] disabled:text-[#555] rounded"
                title="Pagina precedente"
              >
                ◀
              </button>
              <span className="text-[#ccc] font-mono px-1">
                {currentPage} / {numPages}
              </span>
              <button
                disabled={currentPage >= numPages}
                onClick={() => setCurrentPage(currentPage + 1)}
                className="px-1 hover:bg-[#2d2d30] disabled:text-[#555] rounded"
                title="Pagina successiva"
              >
                ▶
              </button>
            </div>
          )}

          {/* Zoom rapido per questo riquadro */}
          <div className="flex items-center bg-[#181818] px-1 py-0.5 rounded border border-[#383838] font-mono text-[10px] text-[#00b7c3]">
            <button
              onClick={() => setViewport({ zoom: Math.max(0.04, viewport.zoom * 0.85) })}
              className="px-1 hover:text-white"
              title="Zoom out"
            >
              -
            </button>
            <span>{Math.round(viewport.zoom * 100)}%</span>
            <button
              onClick={() => setViewport({ zoom: Math.min(24.0, viewport.zoom * 1.15) })}
              className="px-1 hover:text-white"
              title="Zoom in"
            >
              +
            </button>
          </div>

          {/* Azioni specifiche riquadro: carica 2° PDF (opzionale), dividi questo riquadro, chiudi questo riquadro */}
          {isSecondary && (
            <>
              <input
                type="file"
                ref={secondaryFileInputRef}
                onChange={handleOpenSecondaryFile}
                accept="application/pdf"
                className="hidden"
              />
              <button
                onClick={() => secondaryFileInputRef.current?.click()}
                className="hidden xl:flex items-center space-x-1 px-1.5 py-0.5 bg-[#2d2d30] hover:bg-[#3e3e42] text-white rounded text-[10px] transition cursor-pointer"
                title="Apri un altro file PDF in questo riquadro per confrontarli"
              >
                <FileUp size={11} className="text-[#00b7c3]" />
                <span>{secondaryFileBytes ? 'Cambia PDF' : 'Carica PDF'}</span>
              </button>

              {secondaryFileBytes && (
                <button
                  onClick={closeSecondaryDocument}
                  className="hidden xl:inline px-1.5 py-0.5 hover:bg-[#3e3e42] text-[#aaa] hover:text-white rounded text-[10px] cursor-pointer"
                  title="Torna a visualizzare il documento principale"
                >
                  Usa 1° PDF
                </button>
              )}
            </>
          )}

          <div className="flex items-center space-x-0.5 pl-1 border-l border-[#383838]">
            <button
              onClick={() => splitActivePane('vertical', effectivePaneId)}
              className="p-1 text-[#888] hover:text-white hover:bg-[#3e3e42] rounded transition cursor-pointer"
              title="Dividi questo riquadro verticalmente (Ctrl+2)"
            >
              <BluebeamIcon name="split_vertical" size={12} />
            </button>
            <button
              onClick={() => splitActivePane('horizontal', effectivePaneId)}
              className="p-1 text-[#888] hover:text-white hover:bg-[#3e3e42] rounded transition cursor-pointer"
              title="Dividi questo riquadro orizzontalmente (Ctrl+H)"
            >
              <BluebeamIcon name="split_horizontal" size={12} />
            </button>
            <button
              onClick={() => closeSplitPane(effectivePaneId)}
              className="p-1 hover:bg-red-500/20 text-[#888] hover:text-red-400 rounded transition cursor-pointer"
              title="Chiudi questo riquadro"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>
      )}

      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: 'none' }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (drawingPoints.length >= 2) {
            finishMultiPointDrawing();
            return;
          }
          const rawPt = getPdfPointFromEvent(e);
          const pageIndex = getPageIndexFromEvent(e);
          if (!rawPt) return;
          const hit = markups
            .filter((m) => isMarkupBelongingToPane(m) && (m.pageIndex ?? 0) === pageIndex)
            .reverse()
            .find((m) => HitTester.hitTestMarkup(rawPt, m, 8 / viewport.zoom));

          if (hit) {
            if (!selectedMarkupIds.includes(hit.id)) {
              selectMarkup(hit.id);
            }
          } else {
            selectMarkup(null);
          }

          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            pageIndex,
            pdfPt: rawPt,
            hitMarkupId: hit?.id || null,
          });
        }}
        className={`relative flex-1 bg-[#181818] overflow-hidden select-none ${getCanvasCursor()}`}
      >
      {/* Contenitore PDF + Markup (Supporta sia Pagina Singola che Pagine Continue con Distacco stile Bluebeam) */}
      <div
        className="absolute origin-top-left will-change-transform"
        style={{
          transform: `translate(${viewport.panX}px, ${viewport.panY}px)`,
        }}
      >
        {pageViewMode === 'single' ? (
          /* Modalità Pagina Singola */
          (currentPageInfo || pagesInfo[0]) && (
            <div className="relative shadow-2xl">
              <PDFPageView
                key={`${docId}_${currentPage - 1}_${(currentPageInfo || pagesInfo[0]).rotation}_${Math.round((currentPageInfo || pagesInfo[0]).width)}x${Math.round((currentPageInfo || pagesInfo[0]).height)}`}
                pageIndex={currentPage - 1}
                pageInfo={currentPageInfo || pagesInfo[0]}
                scale={viewport.zoom}
                rotation={viewport.rotation}
                docId={docId}
                fileBytes={fileBytes}
                markups={paneMarkups}
                selectedMarkupIds={selectedMarkupIds}
                scaleCalibration={scaleCalibration}
                isActivePage={true}
                isVisible={true}
                activeTool={activeTool}
                onTextEditClick={handleTextEditClick}
              />
            </div>
          )
        ) : (
          /* Modalità Pagine Continue con Distacco (Gap 18pt) stile Bluebeam Revu */
          <div 
            className="flex flex-col items-center" 
            style={{ 
              gap: `${PAGE_GAP * viewport.zoom}px`,
              width: `${maxPageWidth * viewport.zoom}px`
            }}
          >
            {pagesInfo.map((pInfo, idx) => {
              const pageTop = (pageOffsets[idx] || 0) * viewport.zoom + viewport.panY;
              const pageBottom = pageTop + (pInfo.height * viewport.zoom);
              const containerH = containerRef.current?.clientHeight || 800;
              const isVisible = numPages <= 5 || (pageBottom >= -1200 && pageTop <= containerH + 1200);

              return (
                <PDFPageView
                  key={`${docId}_${idx}_${pInfo.rotation}_${Math.round(pInfo.width)}x${Math.round(pInfo.height)}`}
                  pageIndex={idx}
                  pageInfo={pInfo}
                  scale={viewport.zoom}
                  rotation={viewport.rotation}
                  docId={docId}
                  fileBytes={fileBytes}
                  markups={paneMarkups}
                  selectedMarkupIds={selectedMarkupIds}
                  scaleCalibration={scaleCalibration}
                  isActivePage={currentPage === idx + 1}
                  isVisible={isVisible}
                  activeTool={activeTool}
                  onTextEditClick={handleTextEditClick}
                  onPageClick={(pIdx) => {
                    lastProgrammaticPageRef.current = pIdx + 1;
                    setCurrentPage(pIdx + 1);
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Riquadro interattivo di selezione area AutoMark (visibile in tempo reale e scompare al rilascio) */}
        {isSelectingAutoMarkRegion && autoMarkDragStart && autoMarkDragCurrent && (
          <div
            className="absolute pointer-events-none border-2 border-dashed border-[#00b7c3] bg-[#0078d4]/25 z-50"
            style={{
              left: `${Math.min(autoMarkDragStart.x, autoMarkDragCurrent.x) * viewport.zoom}px`,
              top: `${Math.min(autoMarkDragStart.y, autoMarkDragCurrent.y) * viewport.zoom}px`,
              width: `${Math.max(2, Math.abs(autoMarkDragCurrent.x - autoMarkDragStart.x) * viewport.zoom)}px`,
              height: `${Math.max(2, Math.abs(autoMarkDragCurrent.y - autoMarkDragStart.y) * viewport.zoom)}px`,
            }}
          >
            <div className="absolute -top-5 left-0 bg-[#0078d4] text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap">
              Regione da estrarre
            </div>
          </div>
        )}
      </div>

      {/* Canvas Markup Globale Sovrapposto per Anteprime Disegno Live (dimensionato al viewport per massima reattività) */}
      <canvas ref={markupCanvasRef} className="absolute inset-0 pointer-events-none z-30" />

      {/* Editor di Testo Inline Diretto sul Canvas */}
      {inlineEditor && (() => {
        const targetMarkup = markups.find((m) => m.id === inlineEditor.markupId);
        const subCp =
          inlineEditor.subPathIndex !== undefined
            ? targetMarkup?.compoundPaths?.[inlineEditor.subPathIndex]
            : undefined;
        const editInfo = pendingTextEditRef.current;
        const rawFontSize = subCp?.fontSize || editInfo?.fontSize || (targetMarkup as any)?.fontSize || 12;
        const scaledFontSize = Math.max(9, Math.round(rawFontSize * viewport.zoom));
        const fontFamily = subCp?.fontFamily || editInfo?.fontFamily || (targetMarkup as any)?.fontFamily || 'Helvetica, Arial, sans-serif';
        const fontWeight = editInfo?.fontWeight || (targetMarkup as any)?.fontWeight || 'normal';
        const fontStyle = editInfo?.fontStyle || (targetMarkup as any)?.fontStyle || 'normal';
        const color = subCp?.strokeColor || (targetMarkup as any)?.textColor || targetMarkup?.strokeColor || '#000000';
        const textAlign = subCp?.textAlign || (targetMarkup as any)?.textAlign || activeTextAlign || 'left';
        const isMeasure = targetMarkup?.type?.startsWith('measure');

        return (
          <div
            className="absolute z-40 bg-white/95 border border-[#0078d4] shadow-lg rounded-sm px-0.5 py-0 flex flex-col box-border"
            style={getInlineEditorScreenStyle()}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <textarea
              ref={inlineTextareaRef}
              value={inlineEditor.text}
              onChange={(e) =>
                setInlineEditor({ ...inlineEditor, text: e.target.value })
              }
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
                  e.preventDefault();
                  e.stopPropagation();
                  setInlineEditor(null);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  commitInlineText();
                } else if (e.key === 'Enter') {
                  if (isMeasure || inlineEditor.subPathIndex !== undefined || e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    commitInlineText();
                  }
                }
              }}
              onBlur={() => {
                if (Date.now() - inlineEditorOpenTimeRef.current < 250) {
                  inlineTextareaRef.current?.focus();
                  return;
                }
                commitInlineText();
              }}
              style={{
                fontSize: `${scaledFontSize}px`,
                fontFamily,
                fontWeight,
                fontStyle,
                color,
                lineHeight: 1.2,
                textAlign,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
              className="w-full h-full bg-transparent outline-none resize-none overflow-hidden leading-tight p-0 m-0"
              placeholder={isMeasure ? "Valore quota..." : "Scrivi testo..."}
            />
          </div>
        );
      })()}

      {/* Banner Notifica Selezione Area AutoMark (stile Bluebeam Revu) */}
      {isSelectingAutoMarkRegion && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#1e1e1e]/95 border-2 border-[#0078d4] text-white px-4 py-2 rounded-lg shadow-2xl flex items-center space-x-3 z-50 animate-in fade-in duration-150">
          <div className="flex items-center space-x-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00ff66] animate-ping" />
            <span className="font-semibold text-white">
              Trascina un rettangolo sul <strong>Cartiglio</strong> per selezionare l'area di estrazione
            </span>
          </div>
          <button
            onClick={() => {
              setIsSelectingAutoMarkRegion(false);
              setAutoMarkDragStart(null);
              setAutoMarkDragCurrent(null);
            }}
            className="px-2.5 py-0.5 bg-[#333336] hover:bg-[#444] rounded text-[11px] text-[#ccc] hover:text-white transition"
          >
            Annulla (Esc)
          </button>
        </div>
      )}

      {/* HUD compatto in basso a sinistra solo durante piazzamento simbolo, toast o snap attivo */}
      {(activeToolChestMarkup || savedToastMsg || (snapEnabled && activeTool !== 'select' && activeTool !== 'pan')) && (
        <div className="absolute bottom-2 left-3 bg-[#1e1e1e]/95 backdrop-blur px-2.5 py-1 rounded border border-[#333333] text-[11px] text-[#aaaaaa] flex items-center space-x-2.5 z-40 shadow-lg">
          {activeToolChestMarkup && (
            <>
              <span>
                Simbolo: <strong className="text-white">{activeToolChestMarkup.subject}</strong>
              </span>
              <button
                onClick={() => {
                  setActiveToolChestMarkup(null);
                  setActiveTool('select');
                }}
                className="px-2 py-0.5 bg-red-600/80 hover:bg-red-600 text-white rounded text-[10px] font-semibold transition"
              >
                Fine Piazzamento (Esc)
              </button>
            </>
          )}

          {savedToastMsg && (
            <span className="px-2 py-0.5 bg-[#107c41] text-white rounded text-[10px] font-bold animate-pulse">
              ✓ {savedToastMsg}
            </span>
          )}

          {snapEnabled && activeTool !== 'select' && activeTool !== 'pan' && (
            <span className="text-[#00ff66] flex items-center space-x-1">
              <span>🧲 Snap Attivo</span>
            </span>
          )}
        </div>
      )}

      {/* Slider verticale a destra per scorrere rapidamente le pagine del documento */}
      {numPages > 1 && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 bottom-10 right-1.5 z-20 w-4 flex flex-col items-center py-1 select-none"
        >
          <button
            type="button"
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="w-4 h-4 flex items-center justify-center text-[9px] text-[#999] hover:text-white disabled:text-[#444] rounded hover:bg-[#2d2d30] cursor-pointer"
            title="Pagina precedente"
          >
            ▲
          </button>

          <div
            className="relative flex-1 w-4 my-1 flex justify-center cursor-pointer group"
            title={`Pagina ${currentPage} di ${numPages} — trascina per scorrere`}
            onPointerDown={(e) => {
              e.stopPropagation();
              const track = e.currentTarget;
              track.setPointerCapture(e.pointerId);
              const updateFromClientY = (clientY: number) => {
                const rect = track.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)));
                const target = 1 + Math.round(ratio * (numPages - 1));
                if (target !== useAppStore.getState().currentPage || isSecondary) {
                  setCurrentPage(target);
                }
              };
              updateFromClientY(e.clientY);
              const onMove = (ev: PointerEvent) => updateFromClientY(ev.clientY);
              const onUp = () => {
                track.removeEventListener('pointermove', onMove);
                track.removeEventListener('pointerup', onUp);
                track.removeEventListener('pointercancel', onUp);
              };
              track.addEventListener('pointermove', onMove);
              track.addEventListener('pointerup', onUp);
              track.addEventListener('pointercancel', onUp);
            }}
          >
            {/* Track */}
            <div className="w-1.5 h-full rounded-full bg-[#2a2a2e] border border-[#3a3a40]" />
            {/* Thumb */}
            <div
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-6 rounded-full bg-[#4a4a54] group-hover:bg-[#0078d4] border border-[#181818] shadow transition-colors flex items-center justify-center"
              style={{
                top: `${((currentPage - 1) / Math.max(1, numPages - 1)) * 100}%`,
              }}
            >
              <div className="w-1.5 h-0.5 bg-white/70 rounded-full" />
            </div>
            {/* Tooltip pagina corrente al passaggio / trascinamento */}
            <div
              className="pointer-events-none opacity-0 group-hover:opacity-100 absolute right-5 -translate-y-1/2 px-2 py-0.5 rounded bg-[#1e1e1e]/95 border border-[#0078d4]/60 text-[10.5px] font-mono text-white whitespace-nowrap shadow-lg transition-opacity"
              style={{
                top: `${((currentPage - 1) / Math.max(1, numPages - 1)) * 100}%`,
              }}
            >
              Pag. {currentPage} / {numPages}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCurrentPage(Math.min(numPages, currentPage + 1))}
            disabled={currentPage >= numPages}
            className="w-4 h-4 flex items-center justify-center text-[9px] text-[#999] hover:text-white disabled:text-[#444] rounded hover:bg-[#2d2d30] cursor-pointer"
            title="Pagina successiva"
          >
            ▼
          </button>
        </div>
      )}

      {/* Coordinate HUD in basso a destra */}
      {currentMousePt && (
        <div className={`absolute bottom-2 ${numPages > 1 ? 'right-7' : 'right-3'} bg-[#1e1e1e]/85 backdrop-blur px-2.5 py-1 rounded border border-[#333333] text-[11px] font-mono text-[#888888] pointer-events-none`}>
          X: <span className="text-white">{currentMousePt.x.toFixed(1)}</span> pt | Y:{' '}
          <span className="text-white">{currentMousePt.y.toFixed(1)}</span> pt
        </div>
      )}

      {/* Modal Calibrazione Scala */}
      {calibModalPts && (
        <CalibrationModal
          p1={calibModalPts.p1}
          p2={calibModalPts.p2}
          onClose={() => setCalibModalPts(null)}
        />
      )}

      {/* Menu Contestuale Tasto Destro stile Bluebeam Revu */}
      {contextMenu && (
        <BluebeamContextMenu
          menu={contextMenu}
          docId={isSecondary ? 'secondary' : 'primary'}
          currentPage={currentPage}
          numPages={numPages}
          onSetCurrentPage={setCurrentPage}
          onClose={() => setContextMenu(null)}
          onToast={(msg) => {
            setSavedToastMsg(msg);
            setTimeout(() => setSavedToastMsg(null), 2400);
          }}
        />
      )}
    </div>
    </div>
  );
};
