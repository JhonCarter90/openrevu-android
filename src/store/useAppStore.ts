import { create } from 'zustand';
import { AnyMarkup, MarkupType, MarkupLayer, ScaleCalibration, UnitType, Point2D, LineStyle, HatchPattern, LineEnding, TextAlign, VerticalAlign } from '@/types/markup';
import { PDFPageInfo, ViewportTransform } from '@/types/pdf';
import { BTXParser, BTXToolSet, CompoundSubPath } from '@/core/btx/btxParser';
import { TextLayoutHelper } from '@/core/markup/textLayoutHelper';
import { saveRecentFileData, deleteRecentFileData } from '@/core/storage/recentFilesDb';
import { setClipboardImageDataUrl } from '@/core/utils/imageImport';
import { SearchResultItem } from '@/core/pdf/pdfSearchService';

export interface DocumentBookmark {
  id: string;
  title: string;
  pageNumber: number;
}

export interface OpenDocumentItem {
  id: string;
  fileName: string;
  fileBytes: Uint8Array;
  numPages: number;
  currentPage: number;
  pagesInfo: PDFPageInfo[];
  viewport: ViewportTransform;
  markups: AnyMarkup[];
  bookmarks?: DocumentBookmark[];
  bookmarksDirty?: boolean;
  format?: string;
  isDirty?: boolean;
  fileHandle?: any;
  nativeFilePath?: string;
  isReadOnly?: boolean;
}

export interface RecentDocumentItem {
  id: string;
  fileName: string;
  numPages: number;
  lastOpened: string;
  format?: string;
  fileSize?: string;
  isSample?: boolean;
}

export type SplitNode =
  | { type: 'leaf'; id: string }
  | {
      type: 'split';
      id: string;
      direction: 'vertical' | 'horizontal';
      ratio: number;
      first: SplitNode;
      second: SplitNode;
    };

function countSplitLeaves(node: SplitNode): number {
  if (node.type === 'leaf') return 1;
  return countSplitLeaves(node.first) + countSplitLeaves(node.second);
}

function findFirstLeafId(node: SplitNode): string {
  if (node.type === 'leaf') return node.id;
  return findFirstLeafId(node.first);
}

function splitLeafInTree(
  node: SplitNode,
  targetLeafId: string,
  direction: 'vertical' | 'horizontal',
  newSplitId: string,
  newLeafId: string
): { tree: SplitNode; didSplit: boolean } {
  if (node.type === 'leaf') {
    if (node.id === targetLeafId) {
      return {
        tree: {
          type: 'split',
          id: newSplitId,
          direction,
          ratio: 0.5,
          first: node,
          second: { type: 'leaf', id: newLeafId },
        },
        didSplit: true,
      };
    }
    return { tree: node, didSplit: false };
  }
  const firstRes = splitLeafInTree(node.first, targetLeafId, direction, newSplitId, newLeafId);
  if (firstRes.didSplit) {
    return { tree: { ...node, first: firstRes.tree }, didSplit: true };
  }
  const secondRes = splitLeafInTree(node.second, targetLeafId, direction, newSplitId, newLeafId);
  if (secondRes.didSplit) {
    return { tree: { ...node, second: secondRes.tree }, didSplit: true };
  }
  return { tree: node, didSplit: false };
}

function removeLeafFromTree(node: SplitNode, targetLeafId: string): SplitNode | null {
  if (node.type === 'leaf') {
    return node.id === targetLeafId ? null : node;
  }
  const nextFirst = removeLeafFromTree(node.first, targetLeafId);
  const nextSecond = removeLeafFromTree(node.second, targetLeafId);
  if (!nextFirst && !nextSecond) return null;
  if (!nextFirst) return nextSecond;
  if (!nextSecond) return nextFirst;
  if (nextFirst === node.first && nextSecond === node.second) return node;
  return { ...node, first: nextFirst, second: nextSecond };
}

function updateRatioInTree(node: SplitNode, splitId: string, ratio: number): SplitNode {
  if (node.type === 'leaf') return node;
  if (node.id === splitId) {
    return { ...node, ratio: Math.max(0.15, Math.min(0.85, ratio)) };
  }
  const nextFirst = updateRatioInTree(node.first, splitId, ratio);
  const nextSecond = updateRatioInTree(node.second, splitId, ratio);
  if (nextFirst === node.first && nextSecond === node.second) return node;
  return { ...node, first: nextFirst, second: nextSecond };
}

interface AppState {
  // Configurazione Utente
  currentUser: string;
  setCurrentUser: (user: string) => void;

  // Gestione Multi-Documento, Schede (Tabs) & Home Page
  openDocuments: OpenDocumentItem[];
  activeDocumentId: string | 'home';
  recentDocuments: RecentDocumentItem[];
  openDocument: (
    fileName: string,
    bytes: Uint8Array,
    numPages: number,
    pagesInfo: PDFPageInfo[],
    markups?: AnyMarkup[],
    docId?: string,
    sourceMeta?: { fileHandle?: any; nativeFilePath?: string; isReadOnly?: boolean }
  ) => void;
  openMultipleDocuments: (
    docs: {
      id?: string;
      fileName: string;
      bytes: Uint8Array;
      numPages: number;
      pagesInfo: PDFPageInfo[];
      markups?: AnyMarkup[];
      fileHandle?: any;
      nativeFilePath?: string;
      isReadOnly?: boolean;
    }[]
  ) => void;
  switchDocument: (id: string | 'home') => void;
  closeDocument: (id: string) => void;
  setDocumentBookmarks: (docId: string, bookmarks: DocumentBookmark[], markDirty?: boolean) => void;
  markDocumentSaved: (docId?: string) => void;
  updateActiveDocumentSaveTarget: (target: {
    fileHandle?: any;
    nativeFilePath?: string;
    fileName?: string;
    isReadOnly?: boolean;
  }) => void;
  applyFlattenedDocument: (docId: string, newBytes: Uint8Array, remainingMarkups: AnyMarkup[]) => void;
  updateActiveDocumentStructure: (
    newBytes: Uint8Array,
    newPagesInfo: PDFPageInfo[],
    newMarkups: AnyMarkup[],
    newCurrentPage?: number
  ) => void;
  isInsertPagesModalOpen: boolean;
  setInsertPagesModalOpen: (open: boolean) => void;
  pendingHyperlink: {
    pageIndex: number;
    boxRect: { x: number; y: number; width: number; height: number };
    existingMarkupId?: string;
  } | null;
  setPendingHyperlink: (
    pending: {
      pageIndex: number;
      boxRect: { x: number; y: number; width: number; height: number };
      existingMarkupId?: string;
    } | null
  ) => void;
  closeAllDocuments: () => void;
  addRecentDocument: (item: RecentDocumentItem) => void;
  removeRecentDocument: (id: string) => void;

  // Strumento attivo e proprietà disegno
  activeTool: MarkupType;
  setActiveTool: (tool: MarkupType) => void;
  activeColor: string;
  setActiveColor: (color: string) => void;
  activeFillColor: string;
  setActiveFillColor: (color: string) => void;
  activeFillOpacity: number;
  setActiveFillOpacity: (opacity: number) => void;
  snapEnabled: boolean;
  setSnapEnabled: (enabled: boolean) => void;
  orthoEnabled: boolean;
  setOrthoEnabled: (enabled: boolean) => void;
  mouseWheelMode: 'zoom' | 'scroll';
  setMouseWheelMode: (mode: 'zoom' | 'scroll') => void;
  toggleMouseWheelMode: () => void;
  pageViewMode: 'single' | 'continuous';
  setPageViewMode: (mode: 'single' | 'continuous') => void;
  activeStrokeWidth: number;
  setActiveStrokeWidth: (width: number) => void;
  activeOpacity: number;
  setActiveOpacity: (opacity: number) => void;
  activeLineStyle: LineStyle;
  setActiveLineStyle: (style: LineStyle) => void;
  activeLineStyleScale: number;
  setActiveLineStyleScale: (scale: number) => void;
  activeHatchPattern: HatchPattern;
  setActiveHatchPattern: (pattern: HatchPattern) => void;
  activeHatchColor: string;
  setActiveHatchColor: (color: string) => void;
  activeHatchScale: number;
  setActiveHatchScale: (scale: number) => void;
  activeHatchAngle: number;
  setActiveHatchAngle: (angle: number) => void;
  activeStartHead: LineEnding;
  setActiveStartHead: (head: LineEnding) => void;
  activeEndHead: LineEnding;
  setActiveEndHead: (head: LineEnding) => void;

  // Modalità selezione area interattiva per AutoMark / Segnalibri
  isSelectingAutoMarkRegion: boolean;
  setIsSelectingAutoMarkRegion: (active: boolean) => void;
  autoMarkPendingRegion: { xPct: number; yPct: number; widthPct: number; heightPct: number } | null;
  setAutoMarkPendingRegion: (region: { xPct: number; yPct: number; widthPct: number; heightPct: number } | null) => void;

  // Stato PDF
  fileName: string;
  fileBytes: Uint8Array | null;
  numPages: number;
  currentPage: number;
  pagesInfo: PDFPageInfo[];
  setPDFDocument: (fileName: string, bytes: Uint8Array, numPages: number, pagesInfo: PDFPageInfo[]) => void;
  setCurrentPage: (page: number) => void;

  // Viewport (Pan e Zoom)
  viewport: ViewportTransform;
  setViewport: (transform: Partial<ViewportTransform>) => void;
  resetViewport: () => void;

  // Split View & Vista Divisa Multipla (Stile Bluebeam Revu: albero ricorsivo di riquadri)
  splitMode: 'none' | 'vertical' | 'horizontal';
  setSplitMode: (mode: 'none' | 'vertical' | 'horizontal') => void;
  splitTree: SplitNode;
  activePaneId: string;
  setActivePaneId: (paneId: string) => void;
  splitActivePane: (direction: 'vertical' | 'horizontal', targetPaneId?: string) => void;
  closeSplitPane: (paneId: string) => void;
  updateSplitNodeRatio: (splitId: string, ratio: number) => void;
  resetSplitPanes: () => void;
  syncSplitViews: boolean;
  setSyncSplitViews: (sync: boolean) => void;
  splitRatio: number;
  setSplitRatio: (ratio: number) => void;

  // Secondo Documento / Riquadro 2
  secondaryDocumentId: string | null;
  secondaryFileName: string;
  secondaryFileBytes: Uint8Array | null;
  secondaryNumPages: number;
  secondaryCurrentPage: number;
  secondaryPagesInfo: PDFPageInfo[];
  secondaryViewport: ViewportTransform;
  setSecondaryPDFDocument: (fileName: string, bytes: Uint8Array, numPages: number, pagesInfo: PDFPageInfo[]) => void;
  setSecondaryCurrentPage: (page: number) => void;
  setSecondaryViewport: (transform: Partial<ViewportTransform>) => void;
  setSecondaryFromOpenDoc: (docId: string) => void;
  closeSecondaryDocument: () => void;

  // Calibrazione Scala
  scaleCalibration: ScaleCalibration | null;
  setScaleCalibration: (scale: ScaleCalibration | null) => void;

  // Markup & Annotazioni
  markups: AnyMarkup[];
  selectedMarkupIds: string[];
  lockedMarkupIds: string[];
  selectFenceMode: 'rect' | 'lasso';
  setSelectFenceMode: (mode: 'rect' | 'lasso') => void;
  addingCalloutLeaderId: string | null;
  setAddingCalloutLeaderId: (id: string | null) => void;
  toggleLockMarkup: (id: string) => void;
  addMarkup: (markup: AnyMarkup) => void;
  updateMarkup: (id: string, updates: Partial<AnyMarkup>, recordHistory?: boolean) => void;
  pushUndoSnapshot: () => void;
  deleteMarkup: (id: string) => void;
  selectMarkup: (id: string | null, multi?: boolean) => void;
  selectMultipleMarkups: (ids: string[], append?: boolean) => void;
  setMarkups: (markups: AnyMarkup[]) => void;
  groupSelectedMarkups: (customName?: string) => AnyMarkup | null;
  ungroupSelectedMarkup: () => void;
  saveSelectedToToolChest: (target: 'myTools' | number, customName?: string) => AnyMarkup | null;

  // Gestione Pannelli Laterali Stile Bluebeam Revu
  activeLeftPanel: 'thumbnails' | 'bookmarks' | 'toolchest' | 'measurements' | 'layers' | 'search' | 'none';
  setActiveLeftPanel: (panel: 'thumbnails' | 'bookmarks' | 'toolchest' | 'measurements' | 'layers' | 'search' | 'none') => void;
  searchResults: SearchResultItem[];
  activeSearchResultId: string | null;
  searchFocusRequest: {
    docId: string;
    pageIndex: number;
    rect: { x: number; y: number; width: number; height: number };
    ts: number;
  } | null;
  setSearchResults: (results: SearchResultItem[]) => void;
  focusSearchResult: (item: SearchResultItem) => void;
  clearSearchResults: () => void;
  activeRightPanel: 'properties' | 'none';
  setActiveRightPanel: (panel: 'properties' | 'none') => void;

  // Gestione Livelli / Layer (Stile Bluebeam)
  layers: MarkupLayer[];
  activeLayerId: string;
  setActiveLayerId: (id: string) => void;
  createLayer: (name: string) => string;
  renameLayer: (id: string, name: string) => void;
  deleteLayer: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
  toggleLayerLock: (id: string) => void;
  moveLayer: (id: string, direction: 'up' | 'down') => void;
  assignMarkupsToLayer: (markupIds: string[], layerId: string) => void;

  // Modale Elaborazione Colore per istantanee / snapshot
  colorProcessingIds: string[] | null;
  setColorProcessingIds: (ids: string[] | null) => void;

  // Copia formato (Format Painter) stile Bluebeam
  formatPainterStyle: Partial<AnyMarkup> | null;
  setFormatPainterStyle: (style: Partial<AnyMarkup> | null) => void;
  applyFormatStyleToMarkups: (targetIds: string[], style: Partial<AnyMarkup>) => void;

  // Tipografia & Font Stile Bluebeam
  activeFontFamily: string;
  setActiveFontFamily: (font: string) => void;
  activeFontSize: number;
  setActiveFontSize: (size: number) => void;
  activeFontBold: boolean;
  setActiveFontBold: (bold: boolean) => void;
  activeFontItalic: boolean;
  setActiveFontItalic: (italic: boolean) => void;
  activeTextAlign: TextAlign;
  setActiveTextAlign: (align: TextAlign) => void;
  activeVerticalAlign: VerticalAlign;
  setActiveVerticalAlign: (align: VerticalAlign) => void;
  autoSizeSelectedMarkups: () => void;

  // Tool Chest & .btx (con persistenza localStorage)
  myTools: AnyMarkup[];
  setMyTools: (tools: AnyMarkup[]) => void;
  addMyTool: (tool: AnyMarkup) => void;
  removeMyTool: (id: string) => void;
  toolSets: BTXToolSet[];
  recentTools: AnyMarkup[];
  activeToolChestMarkup: AnyMarkup | null;
  setToolSets: (sets: BTXToolSet[]) => void;
  addToolSet: (toolSet: BTXToolSet) => void;
  removeToolSet: (index: number) => void;
  addToolToSet: (setIndex: number, tool: AnyMarkup) => void;
  removeToolFromSet: (setIndex: number, toolId: string) => void;
  createCustomToolSet: (title: string) => void;
  addRecentTool: (tool: AnyMarkup) => void;
  clearRecentTools: () => void;
  setActiveToolChestMarkup: (markup: AnyMarkup | null) => void;

  // History (Undo / Redo)
  undoStack: AnyMarkup[][];
  redoStack: AnyMarkup[][];
  undo: () => void;
  redo: () => void;
  clipboardMarkups: AnyMarkup[];
  copySelectedMarkups: () => void;
  cutSelectedMarkups: () => void;
  pasteMarkups: (options?: { targetPt?: Point2D | null; targetPageIndex?: number; inPlace?: boolean }) => void;
}

export const sanitizeToolMarkup = (raw: any): AnyMarkup => {
  const m: any = structuredClone(raw);
  if (m.type === 'measure') m.type = 'measure_length';
  if (
    (m.type === 'rectangle' || m.type === 'ellipse' || m.type === 'textbox' || m.type === 'stamp') &&
    !m.boxRect
  ) {
    m.boxRect = {
      x: typeof m.x === 'number' ? m.x : 5,
      y: typeof m.y === 'number' ? m.y : 5,
      width: typeof m.width === 'number' ? m.width : 30,
      height: typeof m.height === 'number' ? m.height : 30,
    };
  }
  if (
    (m.type === 'line' || m.type === 'arrow' || m.type === 'measure_length') &&
    (!m.startPoint || !m.endPoint)
  ) {
    m.startPoint = m.startPoint || { x: m.startX ?? 5, y: m.startY ?? 35 };
    m.endPoint = m.endPoint || { x: m.endX ?? 35, y: m.endY ?? 5 };
    if (m.type === 'measure_length') {
      const dist = Math.hypot(m.endPoint.x - m.startPoint.x, m.endPoint.y - m.startPoint.y);
      m.measuredLength = m.measuredLength || dist;
      m.realLength = m.realLength || dist;
      m.unit = m.unit || 'mm';
    }
  }
  if (m.type === 'callout') {
    if (!m.arrowPoint) m.arrowPoint = { x: m.arrowX ?? 4, y: m.arrowY ?? 34 };
    if (!m.boxRect) {
      m.boxRect = {
        x: m.boxX ?? 14,
        y: m.boxY ?? 6,
        width: m.width ?? 22,
        height: m.height ?? 16,
      };
    }
  }
  if (
    (m.type === 'cloud' ||
      m.type === 'cloud_rect' ||
      m.type === 'polyline' ||
      m.type === 'polygon' ||
      m.type === 'pen' ||
      m.type === 'highlighter' ||
      m.type === 'measure_polyline' ||
      m.type === 'measure_area' ||
      m.type === 'measure_area_rect') &&
    (!Array.isArray(m.points) || m.points.length < 2)
  ) {
    m.points = [
      { x: 6, y: 6 },
      { x: 34, y: 6 },
      { x: 34, y: 34 },
      { x: 6, y: 34 },
    ];
  }
  return m as AnyMarkup;
};

const convertMarkupsToCompoundSubPaths = (items: AnyMarkup[]): CompoundSubPath[] => {
  const subPaths: CompoundSubPath[] = [];
  for (const m of items) {
    if (m.compoundPaths && m.compoundPaths.length > 0) {
      subPaths.push(...structuredClone(m.compoundPaths));
      continue;
    }
    const stroke = m.strokeColor || '#ff0000';
    const width = m.strokeWidth ?? 1.5;
    const fill = m.fillColor && m.fillColor !== 'transparent' ? m.fillColor : undefined;

    if ('startPoint' in m && 'endPoint' in m && (m as any).startPoint && (m as any).endPoint) {
      subPaths.push({
        type: 'line',
        points: [
          { x: (m as any).startPoint.x, y: (m as any).startPoint.y },
          { x: (m as any).endPoint.x, y: (m as any).endPoint.y },
        ],
        strokeColor: stroke,
        strokeWidth: width,
      });
    } else if (m.type === 'ellipse' && m.boxRect) {
      const bx = Math.min(m.boxRect.x, m.boxRect.x + m.boxRect.width);
      const by = Math.min(m.boxRect.y, m.boxRect.y + m.boxRect.height);
      const bw = Math.abs(m.boxRect.width);
      const bh = Math.abs(m.boxRect.height);
      subPaths.push({
        type: 'ellipse',
        ellipse: { cx: bx + bw / 2, cy: by + bh / 2, rx: bw / 2, ry: bh / 2 },
        strokeColor: stroke,
        strokeWidth: width,
        fillColor: fill,
      });
    } else if ((m.type === 'textbox' || m.type === 'callout') && m.boxRect) {
      const bx = Math.min(m.boxRect.x, m.boxRect.x + m.boxRect.width);
      const by = Math.min(m.boxRect.y, m.boxRect.y + m.boxRect.height);
      const bw = Math.abs(m.boxRect.width);
      const bh = Math.abs(m.boxRect.height);
      if (m.type === 'callout' && (m as any).arrowPoint) {
        subPaths.push({
          type: 'line',
          points: [(m as any).arrowPoint, { x: bx + bw / 2, y: by + bh / 2 }],
          strokeColor: stroke,
          strokeWidth: width,
        });
      }
      if (width > 0 || fill) {
        subPaths.push({
          type: 'rect',
          rect: { x: bx, y: by, width: bw, height: bh },
          strokeColor: stroke,
          strokeWidth: width,
          fillColor: fill,
        });
      }
      const txt = (m as any).text || m.contents || '';
      if (txt) {
        subPaths.push({
          type: 'text',
          rect: { x: bx, y: by, width: bw, height: bh },
          text: txt,
          fontSize: (m as any).fontSize || 11,
          strokeColor: (m as any).textColor || stroke,
          strokeWidth: 0,
        });
      }
    } else if (m.boxRect) {
      const bx = Math.min(m.boxRect.x, m.boxRect.x + m.boxRect.width);
      const by = Math.min(m.boxRect.y, m.boxRect.y + m.boxRect.height);
      const bw = Math.abs(m.boxRect.width);
      const bh = Math.abs(m.boxRect.height);
      subPaths.push({
        type: 'rect',
        rect: { x: bx, y: by, width: bw, height: bh },
        strokeColor: stroke,
        strokeWidth: width,
        fillColor: fill,
      });
    } else if ('points' in m && Array.isArray((m as any).points) && (m as any).points.length >= 2) {
      const isPoly =
        m.type === 'polygon' ||
        m.type === 'cloud' ||
        m.type === 'cloud_rect' ||
        m.type === 'measure_area' ||
        m.type === 'measure_area_rect';
      subPaths.push({
        type: isPoly ? 'polygon' : 'polyline',
        points: (m as any).points.map((p: Point2D) => ({ x: p.x, y: p.y })),
        strokeColor: stroke,
        strokeWidth: width,
        fillColor: isPoly ? fill : undefined,
      });
    }
  }
  return subPaths;
};

const loadSavedMyTools = (): AnyMarkup[] => {
  try {
    const raw = localStorage.getItem('openrevu_my_tools_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(sanitizeToolMarkup);
      }
    }
  } catch {}
  return [];
};

const IDB_NAME = 'openrevu_persistent_db';
const IDB_STORE = 'toolchest';

function openToolChestIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No IndexedDB'));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, val: unknown) {
  try {
    const db = await openToolChestIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
  } catch {}
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openToolChestIDB();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function notifyHostDirtyState(docs: OpenDocumentItem[]) {
  if (typeof window === 'undefined') return;
  const hasDirty = docs.some((d) => Boolean(d.isDirty));
  try {
    (window as any).chrome?.webview?.postMessage(JSON.stringify({ type: 'dirty_state', hasDirty }));
  } catch {}
}

let toolChestHydrated = false;
let diskSyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDiskToolChestSync(force = false) {
  if (typeof window === 'undefined') return;
  if (!toolChestHydrated && !force) return;
  if (diskSyncTimer) clearTimeout(diskSyncTimer);
  diskSyncTimer = setTimeout(() => {
    try {
      const st = useAppStore.getState();
      const payload = JSON.stringify({
        myTools: st.myTools,
        toolSets: st.toolSets,
        recentTools: st.recentTools,
      });
      void fetch('/__api/toolchest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }, 60);
}

const saveMyToolsToStorage = (tools: AnyMarkup[]) => {
  try {
    localStorage.setItem('openrevu_my_tools_v2', JSON.stringify(tools));
  } catch {}
  void idbSet('myTools', tools);
  scheduleDiskToolChestSync(true);
};

const loadSavedToolSets = (): BTXToolSet[] => {
  try {
    const raw = localStorage.getItem('openrevu_toolsets_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (ts: BTXToolSet) =>
              ts &&
              typeof ts.title === 'string' &&
              !/^789c[0-9a-fA-F]+/i.test(ts.title) &&
              Array.isArray(ts.items)
          )
          .map((ts: BTXToolSet) => ({
            id: ts.id || `set-${ts.title}`,
            title: ts.title,
            items: ts.items.map(sanitizeToolMarkup),
          }));
      }
    }
  } catch {}
  return [];
};

const saveToolSetsToStorage = (sets: BTXToolSet[]) => {
  try {
    localStorage.setItem('openrevu_toolsets_v2', JSON.stringify(sets));
  } catch {}
  void idbSet('toolSets', sets);
  scheduleDiskToolChestSync(true);
};

const loadSavedRecentTools = (): AnyMarkup[] => {
  try {
    const raw = localStorage.getItem('openrevu_recent_tools_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(sanitizeToolMarkup);
      }
    }
  } catch {}
  return [];
};

const saveRecentToolsToStorage = (tools: AnyMarkup[]) => {
  try {
    localStorage.setItem('openrevu_recent_tools_v2', JSON.stringify(tools));
  } catch {}
  void idbSet('recentTools', tools);
  scheduleDiskToolChestSync();
};

const loadSavedRecents = (): RecentDocumentItem[] => {
  try {
    const raw = localStorage.getItem('openrevu_recent_docs');
    if (raw) {
      const parsed = JSON.parse(raw) as RecentDocumentItem[];
      return parsed.filter(
        (item) => !item.isSample && !item.fileName?.includes('Schema_PID_Impianto_Industriale')
      );
    }
  } catch (e) {}
  return [];
};

export const extractFormatStyle = (m: AnyMarkup): Partial<AnyMarkup> => {
  const style: any = {
    strokeColor: m.strokeColor,
    strokeWidth: m.strokeWidth,
    fillColor: m.fillColor,
    fillOpacity: m.fillOpacity,
    opacity: m.opacity,
    lineStyle: m.lineStyle,
    lineStyleScale: m.lineStyleScale,
    hatchPattern: m.hatchPattern,
    startHead: m.startHead,
    endHead: m.endHead,
  };
  if (m.type === 'textbox' || m.type === 'callout' || m.type === 'cloud_plus') {
    const tm = m as any;
    style.fontSize = tm.fontSize;
    style.fontFamily = tm.fontFamily;
    style.fontBold = tm.fontBold;
    style.fontItalic = tm.fontItalic;
    style.textColor = tm.textColor;
    style.textAlign = tm.textAlign;
    style.verticalAlign = tm.verticalAlign;
  }
  return style;
};

export const useAppStore = create<AppState>((set, get) => ({
  currentUser: 'Fabio Ferreri',
  setCurrentUser: (user) => set({ currentUser: user }),

  openDocuments: [],
  activeDocumentId: 'home',
  recentDocuments: loadSavedRecents(),

  openDocument: (fileName, bytes, numPages, pagesInfo, markups = [], docId, sourceMeta) => {
    const currentActiveId = get().activeDocumentId;
    let docs = get().openDocuments;
    if (currentActiveId !== 'home') {
      docs = docs.map((d) =>
        d.id === currentActiveId
          ? { ...d, currentPage: get().currentPage, viewport: get().viewport, markups: get().markups }
          : d
      );
    }

    const firstPageW = pagesInfo[0]?.width || 595;
    const initZoom = Number(Math.min(1.0, Math.max(0.38, 1020 / firstPageW)).toFixed(2));
    const initViewport = { zoom: initZoom, panX: 24, panY: 20, rotation: 0 };

    const existingIndex = docs.findIndex((d) => d.fileName === fileName);
    if (bytes && bytes.byteLength > 0) {
      void saveRecentFileData(fileName, bytes);
    }
    if (existingIndex >= 0) {
      const targetId = docId || docs[existingIndex].id;
      const effectiveMarkups = markups.length > 0 ? markups : (docs[existingIndex].markups || []);
      const updatedDoc: OpenDocumentItem = {
        ...docs[existingIndex],
        id: targetId,
        fileBytes: bytes,
        numPages,
        pagesInfo,
        currentPage: 1,
        viewport: initViewport,
        markups: effectiveMarkups,
        ...(sourceMeta?.fileHandle !== undefined ? { fileHandle: sourceMeta.fileHandle } : {}),
        ...(sourceMeta?.nativeFilePath !== undefined ? { nativeFilePath: sourceMeta.nativeFilePath } : {}),
        ...(sourceMeta?.isReadOnly !== undefined ? { isReadOnly: sourceMeta.isReadOnly } : {}),
      };
      const newDocs = [...docs];
      newDocs[existingIndex] = updatedDoc;
      set({
        openDocuments: newDocs,
        activeDocumentId: targetId,
        fileName,
        fileBytes: bytes,
        numPages,
        pagesInfo,
        currentPage: 1,
        viewport: initViewport,
        markups: effectiveMarkups,
        selectedMarkupIds: [],
      });
      return;
    }

    const newDocId = docId || crypto.randomUUID();
    const newDoc: OpenDocumentItem = {
      id: newDocId,
      fileName,
      fileBytes: bytes,
      numPages,
      currentPage: 1,
      pagesInfo,
      viewport: initViewport,
      markups,
      format: pagesInfo[0] ? (pagesInfo[0].width > 1200 ? 'A1' : pagesInfo[0].width > 900 ? 'A3' : 'A4') : 'A4',
      fileHandle: sourceMeta?.fileHandle,
      nativeFilePath: sourceMeta?.nativeFilePath,
      isReadOnly: sourceMeta?.isReadOnly,
    };

    get().addRecentDocument({
      id: newDocId,
      fileName,
      numPages,
      lastOpened: new Date().toISOString(),
      format: newDoc.format,
    });

    set({
      openDocuments: [...docs, newDoc],
      activeDocumentId: newDocId,
      fileName,
      fileBytes: bytes,
      numPages,
      pagesInfo,
      currentPage: 1,
      viewport: initViewport,
      markups,
      selectedMarkupIds: [],
    });
  },

  openMultipleDocuments: (docs) => {
    if (docs.length === 0) return;
    docs.forEach((doc) => {
      get().openDocument(doc.fileName, doc.bytes, doc.numPages, doc.pagesInfo, doc.markups || [], doc.id, {
        fileHandle: doc.fileHandle,
        nativeFilePath: doc.nativeFilePath,
        isReadOnly: doc.isReadOnly,
      });
    });
  },

  switchDocument: (id) => {
    if (id === get().activeDocumentId) return;

    const currentActiveId = get().activeDocumentId;
    let docs = get().openDocuments;
    if (currentActiveId !== 'home') {
      docs = docs.map((d) =>
        d.id === currentActiveId
          ? { ...d, currentPage: get().currentPage, viewport: get().viewport, markups: get().markups }
          : d
      );
    }

    if (id === 'home') {
      set({
        openDocuments: docs,
        activeDocumentId: 'home',
      });
      return;
    }

    const targetDoc = docs.find((d) => d.id === id);
    if (targetDoc) {
      set({
        openDocuments: docs,
        activeDocumentId: id,
        fileName: targetDoc.fileName,
        fileBytes: targetDoc.fileBytes,
        numPages: targetDoc.numPages,
        currentPage: targetDoc.currentPage,
        pagesInfo: targetDoc.pagesInfo,
        viewport: targetDoc.viewport,
        markups: targetDoc.markups,
        selectedMarkupIds: [],
      });
    }
  },

  closeDocument: (id) => {
    const currentActiveId = get().activeDocumentId;
    const docs = get().openDocuments.filter((d) => d.id !== id);
    notifyHostDirtyState(docs);
    void import('@/core/pdf/pdfManager').then(({ PDFManager }) => {
      void PDFManager.getInstance().releaseDocument(id);
    });

    if (currentActiveId === id) {
      if (docs.length > 0) {
        const next = docs[docs.length - 1];
        set({
          openDocuments: docs,
          activeDocumentId: next.id,
          fileName: next.fileName,
          fileBytes: next.fileBytes,
          numPages: next.numPages,
          currentPage: next.currentPage,
          pagesInfo: next.pagesInfo,
          viewport: next.viewport,
          markups: next.markups,
          selectedMarkupIds: [],
        });
      } else {
        set({
          openDocuments: [],
          activeDocumentId: 'home',
          fileName: '',
          fileBytes: null,
          numPages: 0,
          currentPage: 1,
          pagesInfo: [],
          markups: [],
          selectedMarkupIds: [],
        });
      }
    } else {
      set({ openDocuments: docs });
    }
  },

  setDocumentBookmarks: (docId, bookmarks, markDirty = true) => {
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === docId
        ? {
            ...d,
            bookmarks,
            ...(markDirty ? { bookmarksDirty: true, isDirty: true } : {}),
          }
        : d
    );
    set({ openDocuments: updatedDocs });
    if (markDirty) {
      notifyHostDirtyState(updatedDocs);
    }
  },

  markDocumentSaved: (docId) => {
    const targetId = docId || get().activeDocumentId;
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === targetId ? { ...d, isDirty: false, bookmarksDirty: false } : d
    );
    set({ openDocuments: updatedDocs });
    notifyHostDirtyState(updatedDocs);
  },

  updateActiveDocumentSaveTarget: (target) => {
    const activeId = get().activeDocumentId;
    if (activeId === 'home') return;
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === activeId
        ? {
            ...d,
            ...(target.fileHandle !== undefined ? { fileHandle: target.fileHandle } : {}),
            ...(target.nativeFilePath !== undefined ? { nativeFilePath: target.nativeFilePath } : {}),
            ...(target.fileName !== undefined ? { fileName: target.fileName } : {}),
            ...(target.isReadOnly !== undefined ? { isReadOnly: target.isReadOnly } : {}),
          }
        : d
    );
    set({
      openDocuments: updatedDocs,
      ...(target.fileName !== undefined ? { fileName: target.fileName } : {}),
    });
  },

  applyFlattenedDocument: (docId, newBytes, remainingMarkups) => {
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === docId
        ? { ...d, fileBytes: newBytes, markups: remainingMarkups, isDirty: true }
        : d
    );
    const isCurrent = get().activeDocumentId === docId;
    set({
      openDocuments: updatedDocs,
      ...(isCurrent
        ? {
            fileBytes: newBytes,
            markups: remainingMarkups,
            selectedMarkupIds: [],
            undoStack: [],
            redoStack: [],
          }
        : {}),
    });
    notifyHostDirtyState(updatedDocs);
  },

  isInsertPagesModalOpen: false,
  setInsertPagesModalOpen: (open) => set({ isInsertPagesModalOpen: open }),
  pendingHyperlink: null,
  setPendingHyperlink: (pending) => set({ pendingHyperlink: pending }),
  closeAllDocuments: () => {
    const docs = get().openDocuments;
    void import('@/core/pdf/pdfManager').then(({ PDFManager }) => {
      docs.forEach((d) => void PDFManager.getInstance().releaseDocument(d.id));
    });
    set({
      openDocuments: [],
      activeDocumentId: 'home',
      fileName: '',
      fileBytes: null,
      numPages: 0,
      currentPage: 1,
      pagesInfo: [],
      markups: [],
      selectedMarkupIds: [],
    });
    notifyHostDirtyState([]);
  },

  updateActiveDocumentStructure: (newBytes, newPagesInfo, newMarkups, newCurrentPage) => {
    const activeId = get().activeDocumentId;
    if (activeId === 'home') return;
    const nextNumPages = newPagesInfo.length;
    const resolvedCurrentPage = Math.max(
      1,
      Math.min(nextNumPages, newCurrentPage ?? get().currentPage)
    );
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === activeId
        ? {
            ...d,
            fileBytes: newBytes,
            numPages: nextNumPages,
            pagesInfo: newPagesInfo,
            currentPage: resolvedCurrentPage,
            markups: newMarkups,
            isDirty: true,
          }
        : d
    );
    set({
      openDocuments: updatedDocs,
      fileBytes: newBytes,
      numPages: nextNumPages,
      pagesInfo: newPagesInfo,
      currentPage: resolvedCurrentPage,
      markups: newMarkups,
      selectedMarkupIds: [],
    });
    notifyHostDirtyState(updatedDocs);
  },

  addRecentDocument: (item) => {
    const recents = get().recentDocuments.filter((r) => r.fileName !== item.fileName);
    const updated = [item, ...recents].slice(0, 20);
    try {
      localStorage.setItem('openrevu_recent_docs', JSON.stringify(updated));
    } catch (e) {}
    set({ recentDocuments: updated });
  },

  removeRecentDocument: (id) => {
    const target = get().recentDocuments.find((r) => r.id === id);
    const updated = get().recentDocuments.filter((r) => r.id !== id);
    if (target?.fileName) {
      void deleteRecentFileData(target.fileName);
    }
    try {
      localStorage.setItem('openrevu_recent_docs', JSON.stringify(updated));
    } catch (e) {}
    set({ recentDocuments: updated });
  },

  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool }),
  activeColor: '#ff0000', // Default Bluebeam Red
  setActiveColor: (color) => set({ activeColor: color }),
  activeFillColor: 'transparent', // Default Bluebeam: nessun riempimento
  setActiveFillColor: (color) => set({ activeFillColor: color }),
  activeFillOpacity: 1.0,
  setActiveFillOpacity: (opacity) => set({ activeFillOpacity: opacity }),
  snapEnabled: true,
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  orthoEnabled: false,
  setOrthoEnabled: (enabled) => set({ orthoEnabled: enabled }),
  mouseWheelMode: ((typeof window !== 'undefined' && localStorage.getItem('openrevu_mouse_wheel_mode')) as 'zoom' | 'scroll') || 'zoom',
  setMouseWheelMode: (mode) => {
    if (typeof window !== 'undefined') localStorage.setItem('openrevu_mouse_wheel_mode', mode);
    set({ mouseWheelMode: mode });
  },
  toggleMouseWheelMode: () => {
    const current = get().mouseWheelMode;
    const next = current === 'zoom' ? 'scroll' : 'zoom';
    if (typeof window !== 'undefined') localStorage.setItem('openrevu_mouse_wheel_mode', next);
    set({ mouseWheelMode: next });
  },
  pageViewMode: ((typeof window !== 'undefined' && localStorage.getItem('openrevu_page_view_mode')) as 'single' | 'continuous') || 'continuous',
  setPageViewMode: (mode) => {
    if (typeof window !== 'undefined') localStorage.setItem('openrevu_page_view_mode', mode);
    set({ pageViewMode: mode });
  },
  activeStrokeWidth: 1, // Default Bluebeam 1.00 pt
  setActiveStrokeWidth: (width) => set({ activeStrokeWidth: width }),
  activeOpacity: 1,
  setActiveOpacity: (opacity) => set({ activeOpacity: opacity }),
  activeLineStyle: 'solid',
  setActiveLineStyle: (style) => set({ activeLineStyle: style }),
  activeLineStyleScale: 1.0,
  setActiveLineStyleScale: (scale) => set({ activeLineStyleScale: scale }),
  activeHatchPattern: 'none',
  setActiveHatchPattern: (pattern) => set({ activeHatchPattern: pattern }),
  activeHatchColor: '#ff0000',
  setActiveHatchColor: (color) => set({ activeHatchColor: color }),
  activeHatchScale: 1.0,
  setActiveHatchScale: (scale) => set({ activeHatchScale: scale }),
  activeHatchAngle: 0,
  setActiveHatchAngle: (angle) => set({ activeHatchAngle: angle }),
  activeStartHead: 'none',
  setActiveStartHead: (head) => set({ activeStartHead: head }),
  activeEndHead: 'none',
  setActiveEndHead: (head) => set({ activeEndHead: head }),

  isSelectingAutoMarkRegion: false,
  setIsSelectingAutoMarkRegion: (active) => set({ isSelectingAutoMarkRegion: active }),
  autoMarkPendingRegion: null,
  setAutoMarkPendingRegion: (region) => set({ autoMarkPendingRegion: region }),

  fileName: '',
  fileBytes: null,
  numPages: 0,
  currentPage: 1,
  pagesInfo: [],
  setPDFDocument: (fileName, bytes, numPages, pagesInfo) => {
    get().openDocument(fileName, bytes, numPages, pagesInfo);
  },
  setCurrentPage: (page) => set({ currentPage: page }),

  viewport: { zoom: 1.0, panX: 0, panY: 0, rotation: 0 },
  setViewport: (transform) =>
    set((state) => {
      const nextViewport = { ...state.viewport, ...transform };
      if (state.syncSplitViews) {
        return {
          viewport: nextViewport,
          secondaryViewport: { ...state.secondaryViewport, ...transform },
        };
      }
      return { viewport: nextViewport };
    }),
  resetViewport: () =>
    set((state) => {
      const reset = { zoom: 1.0, panX: 0, panY: 0, rotation: 0 };
      if (state.syncSplitViews) {
        return { viewport: reset, secondaryViewport: reset };
      }
      return { viewport: reset };
    }),

  splitMode: 'none',
  splitTree: { type: 'leaf', id: 'primary' },
  activePaneId: 'primary',
  setActivePaneId: (paneId) => set({ activePaneId: paneId }),
  resetSplitPanes: () =>
    set({
      splitMode: 'none',
      splitTree: { type: 'leaf', id: 'primary' },
      activePaneId: 'primary',
      secondaryDocumentId: null,
      secondaryFileName: '',
      secondaryFileBytes: null,
      secondaryNumPages: 0,
      secondaryCurrentPage: 1,
      secondaryPagesInfo: [],
    }),
  splitActivePane: (direction, targetPaneId) =>
    set((state) => {
      if (countSplitLeaves(state.splitTree) >= 8) {
        return {};
      }
      const targetId = targetPaneId || state.activePaneId || findFirstLeafId(state.splitTree);
      const uniqueSuffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const newSplitId = `split_${uniqueSuffix}`;
      const newLeafId = `pane_${uniqueSuffix}`;
      let res = splitLeafInTree(state.splitTree, targetId, direction, newSplitId, newLeafId);
      if (!res.didSplit) {
        const fallbackId = findFirstLeafId(state.splitTree);
        res = splitLeafInTree(state.splitTree, fallbackId, direction, newSplitId, newLeafId);
      }

      const wasSingle = state.splitTree.type === 'leaf';
      const otherDoc = state.openDocuments.find((d) => d.id !== state.activeDocumentId);
      const secondaryPatch = wasSingle
        ? otherDoc
          ? {
              secondaryDocumentId: otherDoc.id,
              secondaryFileName: otherDoc.fileName,
              secondaryFileBytes: otherDoc.fileBytes,
              secondaryNumPages: otherDoc.numPages,
              secondaryCurrentPage: otherDoc.currentPage || 1,
              secondaryPagesInfo: otherDoc.pagesInfo,
              secondaryViewport: { ...otherDoc.viewport },
            }
          : {
              secondaryDocumentId: state.activeDocumentId !== 'home' ? state.activeDocumentId : null,
              secondaryFileName: state.fileName,
              secondaryFileBytes: state.fileBytes,
              secondaryNumPages: state.numPages,
              secondaryCurrentPage: state.currentPage,
              secondaryPagesInfo: state.pagesInfo,
              secondaryViewport: { ...state.viewport },
            }
        : {};

      return {
        splitMode: direction,
        splitTree: res.tree,
        activePaneId: newLeafId,
        ...secondaryPatch,
      };
    }),
  closeSplitPane: (paneId) =>
    set((state) => {
      if (state.splitTree.type === 'leaf') {
        return {};
      }
      const nextTree = removeLeafFromTree(state.splitTree, paneId);
      if (!nextTree || nextTree.type === 'leaf') {
        return {
          splitMode: 'none',
          splitTree: { type: 'leaf', id: 'primary' },
          activePaneId: 'primary',
          secondaryDocumentId: null,
          secondaryFileName: '',
          secondaryFileBytes: null,
          secondaryNumPages: 0,
          secondaryCurrentPage: 1,
          secondaryPagesInfo: [],
        };
      }
      const nextActive = state.activePaneId === paneId ? findFirstLeafId(nextTree) : state.activePaneId;
      return {
        splitTree: nextTree,
        activePaneId: nextActive,
        splitMode: nextTree.direction,
      };
    }),
  updateSplitNodeRatio: (splitId, ratio) =>
    set((state) => ({
      splitTree: updateRatioInTree(state.splitTree, splitId, ratio),
      splitRatio: Math.max(0.15, Math.min(0.85, ratio)),
    })),
  setSplitMode: (mode) => {
    if (mode === 'none') {
      get().resetSplitPanes();
      return;
    }
    get().splitActivePane(mode);
  },
  syncSplitViews: false,
  setSyncSplitViews: (sync) =>
    set((state) => ({
      syncSplitViews: sync,
      ...(sync ? { secondaryViewport: { ...state.viewport } } : {}),
    })),
  splitRatio: 0.5,
  setSplitRatio: (ratio) => set({ splitRatio: Math.max(0.15, Math.min(0.85, ratio)) }),

  secondaryDocumentId: null,
  secondaryFileName: '',
  secondaryFileBytes: null,
  secondaryNumPages: 0,
  secondaryCurrentPage: 1,
  secondaryPagesInfo: [],
  secondaryViewport: { zoom: 1.0, panX: 0, panY: 0, rotation: 0 },
  setSecondaryPDFDocument: (fileName, bytes, numPages, pagesInfo) => {
    if (get().splitTree.type === 'leaf') {
      get().splitActivePane('vertical');
    }
    set({
      secondaryDocumentId: null,
      secondaryFileName: fileName,
      secondaryFileBytes: bytes,
      secondaryNumPages: numPages,
      secondaryPagesInfo: pagesInfo,
      secondaryCurrentPage: 1,
      secondaryViewport: { zoom: 1.0, panX: 0, panY: 0, rotation: 0 },
      splitMode: get().splitMode === 'none' ? 'vertical' : get().splitMode,
    });
  },
  setSecondaryFromOpenDoc: (docId) => {
    const doc = get().openDocuments.find((d) => d.id === docId);
    if (!doc) return;
    if (get().splitTree.type === 'leaf') {
      get().splitActivePane('vertical');
    }
    set({
      secondaryDocumentId: doc.id,
      secondaryFileName: doc.fileName,
      secondaryFileBytes: doc.fileBytes,
      secondaryNumPages: doc.numPages,
      secondaryCurrentPage: doc.currentPage || 1,
      secondaryPagesInfo: doc.pagesInfo,
      secondaryViewport: { ...doc.viewport },
      splitMode: get().splitMode === 'none' ? 'vertical' : get().splitMode,
    });
  },
  setSecondaryCurrentPage: (page) => set({ secondaryCurrentPage: page }),
  setSecondaryViewport: (transform) =>
    set((state) => {
      const nextSecondary = { ...state.secondaryViewport, ...transform };
      if (state.syncSplitViews) {
        return {
          secondaryViewport: nextSecondary,
          viewport: { ...state.viewport, ...transform },
        };
      }
      return { secondaryViewport: nextSecondary };
    }),
  closeSecondaryDocument: () =>
    set({
      secondaryDocumentId: null,
      secondaryFileName: '',
      secondaryFileBytes: null,
      secondaryNumPages: 0,
      secondaryCurrentPage: 1,
      secondaryPagesInfo: [],
    }),

  scaleCalibration: null,
  setScaleCalibration: (scale) => set({ scaleCalibration: scale }),

  markups: [],
  selectedMarkupIds: [],
  lockedMarkupIds: [],
  toggleLockMarkup: (id) =>
    set((state) => ({
      lockedMarkupIds: state.lockedMarkupIds.includes(id)
        ? state.lockedMarkupIds.filter((x) => x !== id)
        : [...state.lockedMarkupIds, id],
    })),

  activeLeftPanel: 'toolchest',
  setActiveLeftPanel: (panel) =>
    set((state) => ({
      activeLeftPanel: state.activeLeftPanel === panel ? 'none' : panel,
    })),
  searchResults: [],
  activeSearchResultId: null,
  searchFocusRequest: null,
  setSearchResults: (results) => set({ searchResults: results, activeSearchResultId: null }),
  focusSearchResult: (item) => {
    const st = get();
    if (item.docId && item.docId !== st.activeDocumentId) {
      st.switchDocument(item.docId);
    }
    const targetPage = item.pageIndex + 1;
    set({
      currentPage: targetPage,
      activeSearchResultId: item.id,
      searchFocusRequest: {
        docId: item.docId,
        pageIndex: item.pageIndex,
        rect: item.rect,
        ts: Date.now(),
      },
      ...(item.markupId ? { selectedMarkupIds: [item.markupId] } : {}),
    });
  },
  clearSearchResults: () =>
    set({ searchResults: [], activeSearchResultId: null, searchFocusRequest: null }),
  activeRightPanel: 'properties',
  setActiveRightPanel: (panel) =>
    set((state) => ({
      activeRightPanel: state.activeRightPanel === panel ? 'none' : panel,
    })),
  colorProcessingIds: null,
  setColorProcessingIds: (ids) => set({ colorProcessingIds: ids }),

  formatPainterStyle: null,
  setFormatPainterStyle: (style) => set({ formatPainterStyle: style }),
  applyFormatStyleToMarkups: (targetIds, style) => {
    if (!targetIds.length) return;
    get().pushUndoSnapshot();
    targetIds.forEach((id) => {
      const target = get().markups.find((m) => m.id === id);
      if (!target || target.locked) return;
      const updates: any = {
        strokeColor: style.strokeColor,
        strokeWidth: style.strokeWidth,
        fillColor: style.fillColor,
        fillOpacity: style.fillOpacity,
        opacity: style.opacity,
        lineStyle: style.lineStyle,
        lineStyleScale: style.lineStyleScale,
        hatchPattern: style.hatchPattern,
      };
      if (style.startHead !== undefined) updates.startHead = style.startHead;
      if (style.endHead !== undefined) updates.endHead = style.endHead;
      if (
        (target.type === 'textbox' || target.type === 'callout' || target.type === 'cloud_plus') &&
        (style as any).fontSize !== undefined
      ) {
        updates.fontSize = (style as any).fontSize;
        updates.fontFamily = (style as any).fontFamily;
        updates.fontBold = (style as any).fontBold;
        updates.fontItalic = (style as any).fontItalic;
        updates.textColor = (style as any).textColor;
        updates.textAlign = (style as any).textAlign;
        updates.verticalAlign = (style as any).verticalAlign;
      }
      if (target.compoundPaths && target.compoundPaths.length > 0) {
        updates.compoundPaths = target.compoundPaths.map((cp) => ({
          ...cp,
          strokeColor: style.strokeColor !== 'transparent' ? style.strokeColor : cp.strokeColor,
          strokeWidth: style.strokeWidth !== undefined ? style.strokeWidth : cp.strokeWidth,
          lineStyle: style.lineStyle !== undefined ? style.lineStyle : (cp as any).lineStyle,
        }));
      }
      get().updateMarkup(id, updates);
    });
  },

  activeFontFamily: 'Segoe UI, Arial, sans-serif',
  setActiveFontFamily: (font) => set({ activeFontFamily: font }),
  activeFontSize: 11,
  setActiveFontSize: (size) => set({ activeFontSize: size }),
  activeFontBold: false,
  setActiveFontBold: (bold) => set({ activeFontBold: bold }),
  activeFontItalic: false,
  setActiveFontItalic: (italic) => set({ activeFontItalic: italic }),
  activeTextAlign: 'left',
  setActiveTextAlign: (align) => set({ activeTextAlign: align }),
  activeVerticalAlign: 'top',
  setActiveVerticalAlign: (align) => set({ activeVerticalAlign: align }),
  autoSizeSelectedMarkups: () => {
    const state = get();
    if (state.selectedMarkupIds.length === 0) return;
    const selectedSet = new Set(state.selectedMarkupIds);

    const updated = state.markups.map((m) => {
      if (!selectedSet.has(m.id)) return m;
      if (m.type === 'textbox' || m.type === 'callout' || m.type === 'cloud_plus') {
        const textVal = m.text || m.contents || '';
        const size = TextLayoutHelper.calculateAutoSize(textVal, {
          fontSize: m.fontSize || 12,
          fontFamily: m.fontFamily || 'Segoe UI, sans-serif',
          fontWeight: (m as any).fontWeight,
          fontStyle: (m as any).fontStyle,
          paddingX: 6,
          paddingY: 6,
          currentWidth: m.boxRect.width,
        });

        return {
          ...m,
          boxRect: {
            ...m.boxRect,
            width: size.width,
            height: size.height,
          },
        };
      }
      return m;
    });

    const activeId = get().activeDocumentId;
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === activeId ? { ...d, markups: updated } : d
    );

    set({ markups: updated, openDocuments: updatedDocs });
  },
  addMarkup: (markup) => {
    const current = get().markups;
    const withLayer: AnyMarkup = markup.layerId
      ? markup
      : { ...markup, layerId: get().activeLayerId || 'default' };
    const next = [...current, withLayer];
    const activeId = get().activeDocumentId;
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === activeId ? { ...d, markups: next, isDirty: true } : d
    );
    set({
      markups: next,
      openDocuments: updatedDocs,
      undoStack: [...get().undoStack, current],
      redoStack: [],
    });
    notifyHostDirtyState(updatedDocs);
    get().addRecentTool(withLayer);
  },
  pushUndoSnapshot: () => {
    const current = get().markups;
    set({
      undoStack: [...get().undoStack, current],
      redoStack: [],
    });
  },
  updateMarkup: (id, updates, recordHistory = true) => {
    const current = get().markups;
    const next = current.map((m) =>
      m.id === id
        ? ({ ...m, ...updates, modificationDate: new Date().toISOString() } as AnyMarkup)
        : m
    );
    const activeId = get().activeDocumentId;
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === activeId ? { ...d, markups: next, isDirty: true } : d
    );
    if (recordHistory) {
      set({
        markups: next,
        openDocuments: updatedDocs,
        undoStack: [...get().undoStack, current],
        redoStack: [],
      });
    } else {
      set({
        markups: next,
        openDocuments: updatedDocs,
      });
    }
    notifyHostDirtyState(updatedDocs);
  },
  deleteMarkup: (id) => {
    const current = get().markups;
    const next = current.filter((m) => m.id !== id);
    const activeId = get().activeDocumentId;
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === activeId ? { ...d, markups: next, isDirty: true } : d
    );
    set({
      markups: next,
      openDocuments: updatedDocs,
      selectedMarkupIds: get().selectedMarkupIds.filter((selId) => selId !== id),
      undoStack: [...get().undoStack, current],
      redoStack: [],
    });
    notifyHostDirtyState(updatedDocs);
  },

  layers: [
    { id: 'default', name: 'Predefinito', visible: true, locked: false },
  ],
  activeLayerId: 'default',
  setActiveLayerId: (id) => set({ activeLayerId: id }),
  createLayer: (name) => {
    const cleanName = name.trim() || `Livello ${get().layers.length + 1}`;
    const id = `layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set({
      layers: [...get().layers, { id, name: cleanName, visible: true, locked: false }],
    });
    return id;
  },
  renameLayer: (id, name) => {
    const clean = name.trim();
    if (!clean) return;
    set({
      layers: get().layers.map((l) => (l.id === id ? { ...l, name: clean } : l)),
    });
  },
  deleteLayer: (id) => {
    if (id === 'default') return;
    const nextLayers = get().layers.filter((l) => l.id !== id);
    const current = get().markups;
    const nextMarkups = current.map((m) =>
      m.layerId === id ? { ...m, layerId: 'default' } : m
    );
    const activeId = get().activeDocumentId;
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === activeId ? { ...d, markups: nextMarkups } : d
    );
    set({
      layers: nextLayers,
      activeLayerId: get().activeLayerId === id ? 'default' : get().activeLayerId,
      markups: nextMarkups,
      openDocuments: updatedDocs,
    });
  },
  toggleLayerVisibility: (id) => {
    set({
      layers: get().layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    });
  },
  toggleLayerLock: (id) => {
    set({
      layers: get().layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l)),
    });
  },
  moveLayer: (id, direction) => {
    const arr = [...get().layers];
    const idx = arr.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= arr.length) return;
    [arr[idx], arr[targetIdx]] = [arr[targetIdx], arr[idx]];
    set({ layers: arr });
  },
  assignMarkupsToLayer: (markupIds, layerId) => {
    if (markupIds.length === 0) return;
    const idSet = new Set(markupIds);
    const current = get().markups;
    const next = current.map((m) =>
      idSet.has(m.id) ? ({ ...m, layerId, modificationDate: new Date().toISOString() } as AnyMarkup) : m
    );
    const activeId = get().activeDocumentId;
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === activeId ? { ...d, markups: next, isDirty: true } : d
    );
    set({
      markups: next,
      openDocuments: updatedDocs,
      undoStack: [...get().undoStack, current],
      redoStack: [],
    });
    notifyHostDirtyState(updatedDocs);
  },

  selectMarkup: (id, multi = false) => {
    if (!id) {
      set({ selectedMarkupIds: [] });
      return;
    }
    if (multi) {
      const current = get().selectedMarkupIds;
      if (current.includes(id)) {
        set({ selectedMarkupIds: current.filter((x) => x !== id) });
      } else {
        set({ selectedMarkupIds: [...current, id] });
      }
    } else {
      set({ selectedMarkupIds: [id] });
    }
  },
  selectMultipleMarkups: (ids, append = false) => {
    if (!append) {
      set({ selectedMarkupIds: Array.from(new Set(ids)) });
    } else {
      const merged = new Set([...get().selectedMarkupIds, ...ids]);
      set({ selectedMarkupIds: Array.from(merged) });
    }
  },
  setMarkups: (markups) => set({ markups }),

  selectFenceMode: 'rect',
  setSelectFenceMode: (mode) => set({ selectFenceMode: mode }),
  addingCalloutLeaderId: null,
  setAddingCalloutLeaderId: (id) => set({ addingCalloutLeaderId: id }),

  groupSelectedMarkups: (customName) => {
    const selectedIds = get().selectedMarkupIds;
    const allMarkups = get().markups;
    const selected = allMarkups.filter((m) => selectedIds.includes(m.id));
    if (selected.length < 1) return null;

    const subPaths = convertMarkupsToCompoundSubPaths(selected);
    if (subPaths.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const sp of subPaths) {
      if (sp.points) {
        for (const p of sp.points) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      if (sp.circle) {
        minX = Math.min(minX, sp.circle.cx - sp.circle.r);
        minY = Math.min(minY, sp.circle.cy - sp.circle.r);
        maxX = Math.max(maxX, sp.circle.cx + sp.circle.r);
        maxY = Math.max(maxY, sp.circle.cy + sp.circle.r);
      }
      if (sp.ellipse) {
        minX = Math.min(minX, sp.ellipse.cx - sp.ellipse.rx);
        minY = Math.min(minY, sp.ellipse.cy - sp.ellipse.ry);
        maxX = Math.max(maxX, sp.ellipse.cx + sp.ellipse.rx);
        maxY = Math.max(maxY, sp.ellipse.cy + sp.ellipse.ry);
      }
      if (sp.rect) {
        minX = Math.min(minX, sp.rect.x);
        minY = Math.min(minY, sp.rect.y);
        maxX = Math.max(maxX, sp.rect.x + sp.rect.width);
        maxY = Math.max(maxY, sp.rect.y + sp.rect.height);
      }
    }
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 40; maxY = 40; }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    const first = selected[0];
    const groupSubject =
      customName?.trim() ||
      (selected.length === 1 ? first.subject : `Simbolo Gruppo (${selected.length} elem.)`);

    const groupedMarkup: AnyMarkup = {
      id: crypto.randomUUID(),
      docId: first.docId,
      pageIndex: first.pageIndex ?? 0,
      type: 'polyline',
      author: get().currentUser,
      subject: groupSubject,
      contents: groupSubject,
      creationDate: new Date().toISOString(),
      modificationDate: new Date().toISOString(),
      status: 'None',
      strokeColor: first.strokeColor || '#ff0000',
      fillColor: first.fillColor,
      strokeWidth: first.strokeWidth || 1.5,
      opacity: first.opacity ?? 1,
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
      boxRect: { x: minX, y: minY, width, height },
      compoundPaths: subPaths,
      isGroup: true,
      isSymbol: true,
    } as AnyMarkup;

    const remaining = allMarkups.filter((m) => !selectedIds.includes(m.id));
    const next = [...remaining, groupedMarkup];
    const activeId = get().activeDocumentId;
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === activeId ? { ...d, markups: next } : d
    );
    set({
      markups: next,
      openDocuments: updatedDocs,
      selectedMarkupIds: [groupedMarkup.id],
      undoStack: [...get().undoStack, allMarkups],
      redoStack: [],
    });
    return groupedMarkup;
  },

  ungroupSelectedMarkup: () => {
    const selectedIds = get().selectedMarkupIds;
    const allMarkups = get().markups;
    const toUngroup = allMarkups.filter(
      (m) => selectedIds.includes(m.id) && m.compoundPaths && m.compoundPaths.length > 0
    );
    if (toUngroup.length === 0) return;

    const ungroupedMarkups: AnyMarkup[] = [];
    const ungroupIds = new Set(toUngroup.map((m) => m.id));

    for (const grp of toUngroup) {
      const now = new Date().toISOString();
      (grp.compoundPaths || []).forEach((cp, idx) => {
        const base = {
          id: crypto.randomUUID(),
          docId: grp.docId,
          pageIndex: grp.pageIndex ?? 0,
          author: get().currentUser,
          subject: `${grp.subject || 'Elemento'} #${idx + 1}`,
          contents: '',
          creationDate: now,
          modificationDate: now,
          status: 'None' as const,
          strokeColor: cp.strokeColor || grp.strokeColor || '#ff0000',
          fillColor: cp.fillColor,
          strokeWidth: cp.strokeWidth || grp.strokeWidth || 1.5,
          opacity: grp.opacity ?? 1,
        };
        if (cp.type === 'line' && cp.points && cp.points.length >= 2) {
          ungroupedMarkups.push({
            ...base,
            type: 'line',
            startPoint: { ...cp.points[0] },
            endPoint: { ...cp.points[cp.points.length - 1] },
          } as AnyMarkup);
        } else if (cp.circle) {
          ungroupedMarkups.push({
            ...base,
            type: 'ellipse',
            boxRect: {
              x: cp.circle.cx - cp.circle.r,
              y: cp.circle.cy - cp.circle.r,
              width: cp.circle.r * 2,
              height: cp.circle.r * 2,
            },
          } as AnyMarkup);
        } else if (cp.ellipse) {
          ungroupedMarkups.push({
            ...base,
            type: 'ellipse',
            boxRect: {
              x: cp.ellipse.cx - cp.ellipse.rx,
              y: cp.ellipse.cy - cp.ellipse.ry,
              width: cp.ellipse.rx * 2,
              height: cp.ellipse.ry * 2,
            },
          } as AnyMarkup);
        } else if (cp.type === 'text' && cp.rect) {
          const textStr = cp.text || '';
          const fs = cp.fontSize || 11;
          const align = cp.textAlign || 'center';
          const longestLine = textStr.split(/\r?\n/).reduce((max, l) => Math.max(max, l.length), 0);
          const safeW = Math.max(cp.rect.width, longestLine * fs * 0.68 + 6);
          const safeH = Math.max(cp.rect.height, fs * 1.3);
          const adjX =
            align === 'center'
              ? cp.rect.x + cp.rect.width / 2 - safeW / 2
              : align === 'right'
              ? cp.rect.x + cp.rect.width - safeW
              : cp.rect.x;
          const adjY = cp.rect.y + cp.rect.height / 2 - safeH / 2;

          ungroupedMarkups.push({
            ...base,
            type: 'textbox',
            strokeColor: 'transparent',
            strokeWidth: 0,
            fillColor: 'transparent',
            textColor: cp.strokeColor || grp.strokeColor || '#ff0000',
            textAlign: align,
            verticalAlign: 'middle',
            boxRect: { x: adjX, y: adjY, width: safeW, height: safeH },
            text: textStr,
            contents: '',
            fontSize: fs,
            fontFamily: 'Helvetica, Arial, sans-serif',
          } as AnyMarkup);
        } else if (cp.rect) {
          ungroupedMarkups.push({
            ...base,
            type: 'rectangle',
            boxRect: { ...cp.rect },
          } as AnyMarkup);
        } else if (cp.points && cp.points.length >= 2) {
          ungroupedMarkups.push({
            ...base,
            type: cp.type === 'polygon' ? 'polygon' : 'polyline',
            points: cp.points.map((p) => ({ ...p })),
          } as AnyMarkup);
        }
      });
    }

    const remaining = allMarkups.filter((m) => !ungroupIds.has(m.id));
    const next = [...remaining, ...ungroupedMarkups];
    const activeId = get().activeDocumentId;
    const updatedDocs = get().openDocuments.map((d) =>
      d.id === activeId ? { ...d, markups: next } : d
    );
    set({
      markups: next,
      openDocuments: updatedDocs,
      selectedMarkupIds: ungroupedMarkups.map((m) => m.id),
      undoStack: [...get().undoStack, allMarkups],
      redoStack: [],
    });
  },

  saveSelectedToToolChest: (target, customName) => {
    const selectedIds = get().selectedMarkupIds;
    const selected = get().markups.filter((m) => selectedIds.includes(m.id));
    if (selected.length === 0) return null;

    const toSymbol = (single: AnyMarkup, nameOverride?: string): AnyMarkup => {
      let src = single;
      if (!single.compoundPaths || single.compoundPaths.length === 0) {
        const subPaths = convertMarkupsToCompoundSubPaths([single]);
        if (subPaths.length > 0) {
          src = {
            ...single,
            compoundPaths: subPaths,
            isSymbol: true,
          };
        }
      }
      return BTXParser.markupToSymbolTool(src, nameOverride);
    };

    const addOne = (sym: AnyMarkup) => {
      if (target === 'myTools') {
        get().addMyTool(sym);
      } else if (typeof target === 'number' && get().toolSets[target]) {
        get().addToolToSet(target, sym);
      } else {
        get().addMyTool(sym);
      }
    };

    // Selezione multipla: aggiungi ogni simbolo/elemento separatamente mantenendo il suo nome originale!
    if (selected.length > 1) {
      let lastSaved: AnyMarkup | null = null;
      selected.forEach((item, idx) => {
        const nameForItem = customName?.trim()
          ? `${customName.trim()} (${idx + 1})`
          : item.subject || `Simbolo ${idx + 1}`;
        const sym = toSymbol(item, nameForItem);
        addOne(sym);
        lastSaved = sym;
      });
      return lastSaved;
    }

    const symbolTool = toSymbol(selected[0], customName?.trim() || selected[0].subject);
    addOne(symbolTool);
    return symbolTool;
  },

  myTools: loadSavedMyTools(),
  setMyTools: (tools) => {
    const clean = tools.map(sanitizeToolMarkup);
    set({ myTools: clean });
    saveMyToolsToStorage(clean);
  },
  addMyTool: (tool) => {
    const clean = sanitizeToolMarkup(tool);
    const next = [...get().myTools, clean];
    set({ myTools: next });
    saveMyToolsToStorage(next);
  },
  removeMyTool: (id) => {
    const next = get().myTools.filter((t) => t.id !== id);
    set({ myTools: next });
    saveMyToolsToStorage(next);
  },

  toolSets: loadSavedToolSets(),
  recentTools: loadSavedRecentTools(),
  activeToolChestMarkup: null,
  setToolSets: (sets) => {
    set({ toolSets: sets });
    saveToolSetsToStorage(sets);
  },
  addToolSet: (toolSet) => {
    const existing = get().toolSets;
    const filtered = existing.filter((ts) => ts.title !== toolSet.title);
    const next = [...filtered, toolSet];
    set({ toolSets: next });
    saveToolSetsToStorage(next);
  },
  removeToolSet: (index) => {
    const next = get().toolSets.filter((_, idx) => idx !== index);
    set({ toolSets: next });
    saveToolSetsToStorage(next);
  },
  addToolToSet: (setIndex, tool) => {
    const clean = sanitizeToolMarkup(tool);
    const next = get().toolSets.map((ts, idx) =>
      idx === setIndex ? { ...ts, items: [...ts.items, clean] } : ts
    );
    set({ toolSets: next });
    saveToolSetsToStorage(next);
  },
  removeToolFromSet: (setIndex, toolId) => {
    const next = get().toolSets.map((ts, idx) =>
      idx === setIndex ? { ...ts, items: ts.items.filter((it) => it.id !== toolId) } : ts
    );
    set({ toolSets: next });
    saveToolSetsToStorage(next);
  },
  createCustomToolSet: (title) => {
    const next = [...get().toolSets, { title: title.trim() || 'Nuova Libreria Simboli', items: [] }];
    set({ toolSets: next });
    saveToolSetsToStorage(next);
  },
  addRecentTool: (tool) => {
    const clean = BTXParser.markupToSymbolTool(sanitizeToolMarkup(tool));
    const recents = get().recentTools.filter(
      (t) =>
        t.subject !== clean.subject ||
        t.type !== clean.type ||
        t.strokeColor !== clean.strokeColor
    );
    const next = [clean, ...recents].slice(0, 15);
    saveRecentToolsToStorage(next);
    set({ recentTools: next });
  },
  clearRecentTools: () => {
    saveRecentToolsToStorage([]);
    set({ recentTools: [] });
  },
  setActiveToolChestMarkup: (markup) =>
    set({ activeToolChestMarkup: markup ? sanitizeToolMarkup(markup) : null }),

  undoStack: [],
  redoStack: [],
  undo: () => {
    const { undoStack, markups, redoStack, activeDocumentId, openDocuments } = get();
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    set({
      markups: previous,
      openDocuments: openDocuments.map((d) =>
        d.id === activeDocumentId ? { ...d, markups: previous } : d
      ),
      selectedMarkupIds: [],
      undoStack: undoStack.slice(0, undoStack.length - 1),
      redoStack: [markups, ...redoStack],
    });
  },
  redo: () => {
    const { redoStack, markups, undoStack, activeDocumentId, openDocuments } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    set({
      markups: next,
      openDocuments: openDocuments.map((d) =>
        d.id === activeDocumentId ? { ...d, markups: next } : d
      ),
      selectedMarkupIds: [],
      redoStack: redoStack.slice(1),
      undoStack: [...undoStack, markups],
    });
  },

  clipboardMarkups: [],
  copySelectedMarkups: () => {
    const { selectedMarkupIds, markups } = get();
    if (selectedMarkupIds.length === 0) return;
    const selected = markups.filter((m) => selectedMarkupIds.includes(m.id));
    if (selected.length === 0) return;
    const clones = selected.map((m) => JSON.parse(JSON.stringify(m)) as AnyMarkup);
    setClipboardImageDataUrl(null);
    set({ clipboardMarkups: clones });
  },
  cutSelectedMarkups: () => {
    const { selectedMarkupIds, markups, undoStack, activeDocumentId, openDocuments } = get();
    if (selectedMarkupIds.length === 0) return;
    const selectedSet = new Set(selectedMarkupIds);
    const selected = markups.filter((m) => selectedSet.has(m.id));
    if (selected.length === 0) return;
    const clones = selected.map((m) => JSON.parse(JSON.stringify(m)) as AnyMarkup);
    setClipboardImageDataUrl(null);
    const remaining = markups.filter((m) => !selectedSet.has(m.id));
    const updatedDocs = openDocuments.map((d) =>
      d.id === activeDocumentId ? { ...d, markups: remaining, isDirty: true } : d
    );
    set({
      clipboardMarkups: clones,
      markups: remaining,
      openDocuments: updatedDocs,
      selectedMarkupIds: [],
      undoStack: [...undoStack, markups],
      redoStack: [],
    });
    notifyHostDirtyState(updatedDocs);
  },
  pasteMarkups: (options) => {
    const { clipboardMarkups, markups, undoStack, activeDocumentId, openDocuments, currentPage } = get();
    if (clipboardMarkups.length === 0 || activeDocumentId === 'home') return;

    const targetPageIndex =
      typeof options?.targetPageIndex === 'number'
        ? options.targetPageIndex
        : Math.max(0, currentPage - 1);

    // Calcola il centro complessivo dei markup copiati per poterli centrare sotto il cursore
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const expandPt = (p?: Point2D) => {
      if (!p) return;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    };
    clipboardMarkups.forEach((m: any) => {
      if (m.boxRect) {
        expandPt({ x: m.boxRect.x, y: m.boxRect.y });
        expandPt({ x: m.boxRect.x + m.boxRect.width, y: m.boxRect.y + m.boxRect.height });
      }
      expandPt(m.startPoint);
      expandPt(m.endPoint);
      expandPt(m.arrowPoint);
      expandPt(m.elbowPoint);
      expandPt(m.leaderPoint);
      if (Array.isArray(m.points)) m.points.forEach(expandPt);
      if (Array.isArray(m.cloudPoints)) m.cloudPoints.forEach(expandPt);
      if (Array.isArray(m.locations)) m.locations.forEach(expandPt);
    });

    const centerX = isFinite(minX) ? (minX + maxX) / 2 : 0;
    const centerY = isFinite(minY) ? (minY + maxY) / 2 : 0;
    const dx = options?.inPlace ? 0 : options?.targetPt ? options.targetPt.x - centerX : 18;
    const dy = options?.inPlace ? 0 : options?.targetPt ? options.targetPt.y - centerY : 18;

    const shiftPt = (p?: Point2D) => (p ? { x: p.x + dx, y: p.y + dy } : p);
    const now = new Date().toISOString();
    const pastedIds: string[] = [];

    const pasted: AnyMarkup[] = clipboardMarkups.map((orig) => {
      const clone: any = JSON.parse(JSON.stringify(orig));
      const newId = crypto.randomUUID();
      pastedIds.push(newId);
      clone.id = newId;
      clone.pageIndex = targetPageIndex;
      clone.creationDate = now;
      clone.modificationDate = now;
      if (clone.boxRect) {
        clone.boxRect = {
          ...clone.boxRect,
          x: clone.boxRect.x + dx,
          y: clone.boxRect.y + dy,
        };
      }
      if (clone.startPoint) clone.startPoint = shiftPt(clone.startPoint);
      if (clone.endPoint) clone.endPoint = shiftPt(clone.endPoint);
      if (clone.arrowPoint) clone.arrowPoint = shiftPt(clone.arrowPoint);
      if (clone.elbowPoint) clone.elbowPoint = shiftPt(clone.elbowPoint);
      if (clone.leaderPoint) clone.leaderPoint = shiftPt(clone.leaderPoint);
      if (Array.isArray(clone.points)) clone.points = clone.points.map(shiftPt);
      if (Array.isArray(clone.cloudPoints)) clone.cloudPoints = clone.cloudPoints.map(shiftPt);
      if (Array.isArray(clone.locations)) clone.locations = clone.locations.map(shiftPt);
      if (Array.isArray(clone.extraArrows)) clone.extraArrows = clone.extraArrows.map(shiftPt);
      if (Array.isArray(clone.compoundPaths)) {
        clone.compoundPaths = clone.compoundPaths.map((cp: any) => {
          const ncp = { ...cp };
          if (Array.isArray(ncp.points)) ncp.points = ncp.points.map(shiftPt);
          if (ncp.rect) ncp.rect = { ...ncp.rect, x: ncp.rect.x + dx, y: ncp.rect.y + dy };
          if (ncp.circle) ncp.circle = { ...ncp.circle, cx: ncp.circle.cx + dx, cy: ncp.circle.cy + dy };
          if (ncp.ellipse) ncp.ellipse = { ...ncp.ellipse, cx: ncp.ellipse.cx + dx, cy: ncp.ellipse.cy + dy };
          return ncp;
        });
      }
      return clone as AnyMarkup;
    });

    const nextMarkups = [...markups, ...pasted];
    const updatedDocs = openDocuments.map((d) =>
      d.id === activeDocumentId ? { ...d, markups: nextMarkups, isDirty: true } : d
    );
    set({
      markups: nextMarkups,
      openDocuments: updatedDocs,
      selectedMarkupIds: pastedIds,
      undoStack: [...undoStack, markups],
      redoStack: [],
    });
    notifyHostDirtyState(updatedDocs);
  },
}));

// Idratazione automatica da file su disco (%LOCALAPPDATA%\OpenRevu\toolchest_data.json) + IndexedDB
if (typeof window !== 'undefined') {
  void (async () => {
    let diskData: { myTools?: AnyMarkup[]; toolSets?: BTXToolSet[]; recentTools?: AnyMarkup[] } | null = null;
    try {
      const resp = await fetch('/__api/toolchest', { cache: 'no-store' });
      if (resp.ok) {
        diskData = await resp.json();
      }
    } catch {}

    const [idbMyTools, idbSets, idbRecent] = await Promise.all([
      idbGet<AnyMarkup[]>('myTools'),
      idbGet<BTXToolSet[]>('toolSets'),
      idbGet<AnyMarkup[]>('recentTools'),
    ]);

    const st = useAppStore.getState();
    const patch: Partial<AppState> = {};

    const bestMyTools =
      Array.isArray(diskData?.myTools) && diskData!.myTools.length > 0
        ? diskData!.myTools
        : Array.isArray(idbMyTools) && idbMyTools.length > st.myTools.length
        ? idbMyTools
        : null;
    if (bestMyTools && bestMyTools.length >= st.myTools.length) {
      patch.myTools = bestMyTools.map(sanitizeToolMarkup);
    }

    const countTotalItems = (sets: BTXToolSet[] | null | undefined) =>
      Array.isArray(sets) ? sets.reduce((sum, s) => sum + (s?.items?.length || 0), 0) : 0;

    const stSetsCount = st.toolSets.length;
    const stSetsItems = countTotalItems(st.toolSets);

    const diskSets = Array.isArray(diskData?.toolSets) ? diskData!.toolSets : null;
    const idbSetsValid = Array.isArray(idbSets) ? idbSets : null;

    let bestSets: BTXToolSet[] | null = null;
    for (const candidate of [diskSets, idbSetsValid]) {
      if (!candidate) continue;
      const candItems = countTotalItems(candidate);
      const bestItems = bestSets ? countTotalItems(bestSets) : stSetsItems;
      const bestLen = bestSets ? bestSets.length : stSetsCount;
      if (candItems > bestItems || (candItems === bestItems && candidate.length > bestLen)) {
        bestSets = candidate;
      }
    }

    if (bestSets) {
      patch.toolSets = bestSets.map((ts) => ({
        id: ts.id || `set-${ts.title}`,
        title: ts.title,
        items: (ts.items || []).map(sanitizeToolMarkup),
      }));
    }

    const bestRecent =
      Array.isArray(diskData?.recentTools) && diskData!.recentTools.length > 0
        ? diskData!.recentTools
        : Array.isArray(idbRecent) && idbRecent.length > st.recentTools.length
        ? idbRecent
        : null;
    if (bestRecent && bestRecent.length > st.recentTools.length) {
      patch.recentTools = bestRecent.map(sanitizeToolMarkup);
    }

    if (Object.keys(patch).length > 0) {
      useAppStore.setState(patch);
    }
    toolChestHydrated = true;
  })();
}
