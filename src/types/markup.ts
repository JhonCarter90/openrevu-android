export type MarkupType =
  | 'select'
  | 'pan'
  | 'select_text'       // Selezione testo PDF nativo per Copia/Incolla (Ctrl+C)
  | 'edit_pdf_text'     // Modifica Testo Originale PDF (Stile Bluebeam Edit Text)
  | 'cloud'             // Nuvoletta poligonale (punto per punto)
  | 'cloud_rect'        // Nuvoletta rettangolare (drag rapido a 2 punti)
  | 'cloud_plus'        // Nuvoletta con Callout integrato (K)
  | 'callout'           // Freccia direttrice + Text box (Q)
  | 'textbox'           // Solo casella di testo (T)
  | 'rectangle'         // Rettangolo / Quadrato (drag - R)
  | 'ellipse'           // Ellisse / Cerchio (drag - E)
  | 'pen'               // Disegno a mano libera / Penna (P)
  | 'highlighter'       // Evidenziatore (H)
  | 'line'              // Linea semplice (L)
  | 'arrow'             // Freccia (A)
  | 'connector'         // Connettore ortogonale a spezzata automatica
  | 'polyline'          // Polilinea (Shift+N)
  | 'polygon'           // Poligono (Shift+P)
  | 'measure_length'    // Quota lineare (M / Shift+Alt+L)
  | 'measure_polyline'  // Lunghezza cumulativa (Shift+Alt+Q)
  | 'measure_area'      // Area poligonale (Shift+Alt+A)
  | 'measure_area_rect' // Area rettangolare (drag)
  | 'measure_count'     // Pallinatura conteggio (Shift+Alt+C)
  | 'stamp'             // Timbro tecnico (S)
  | 'snapshot'          // Istantanea area PDF negli appunti (G)
  | 'hyperlink'         // Collegamento ipertestuale / Azione PDF (Shift+H)
  | 'erase_content'     // Cancella contenuto (rettangolo bianco coprente)
  | 'calibrate';        // Calibrazione scala a 2 punti

export interface Point2D {
  x: number; // PDF points (72 DPI)
  y: number;
}

export type UnitType = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export interface ScaleCalibration {
  pixelDistance: number; // Distanza in punti PDF (72 pt = 1 pollice)
  realDistance: number;  // Distanza reale inserita dall'utente
  unit: UnitType;        // Unità di misura
  scaleRatio: number;    // Unità reali per punto PDF
  formattedText: string; // Es. "1 : 50" o "10 mm = 1 m"
}

export type MarkupStatus = 'None' | 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed';

export type HatchPattern =
  | 'none'
  | 'solid'
  | 'diagonal_right'   // ANSI31 (45° tratteggio standard)
  | 'diagonal_left'    // 135° tratteggio opposto
  | 'crosshatch'       // ANSI37 (Tratteggio incrociato a quadretti)
  | 'horizontal'       // Linee orizzontali
  | 'vertical'         // Linee verticali
  | 'brick'            // Muratura / Mattoni sfalsati
  | 'dots'             // Calcestruzzo / Ghiaia / Stipple
  | 'zigzag';          // Terreno / Isolamento

export type LineStyle =
  | 'solid'
  | 'dashed'
  | 'dotted'
  | 'dash_dot'
  | 'dash_dot_dot'
  | 'long_dash'
  | 'zigzag'
  | 'gas'
  | 'water'
  | 'hot_water'
  | 'steam'
  | 'drain'
  | 'electric_signal'
  | 'pneumatic'
  | 'hydraulic'
  | 'capillary'
  | 'electromagnetic'
  | 'data_link'
  | 'heat_traced';

export type LineEnding = 'none' | 'arrow' | 'open_arrow' | 'circle' | 'square' | 'tick';

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface MarkupLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface BaseMarkup {
  id: string;               // UUID per /NM
  docId?: 'primary' | 'secondary'; // Identificativo documento per viste divise (Split View)
  layerId?: string;         // Livello / Layer di appartenenza (default: 'default')
  type: MarkupType;
  pageIndex: number;        // Indice pagina (0-based)
  author: string;           // /T (Autore)
  subject: string;          // /Subj (Categoria)
  contents: string;         // /Contents (Commento testuale)
  creationDate: string;     // /CreationDate (Formato ISO PDF D:YYYYMMDD...)
  modificationDate: string; // /M
  status: MarkupStatus;     // Stato approvazione
  strokeColor: string;      // Colore bordo HEX (#FF0000)
  fillColor?: string;       // Colore riempimento HEX
  strokeWidth: number;      // Spessore bordo in pt
  opacity: number;          // Opacità globale 0..1
  fillOpacity?: number;     // Opacità riempimento 0..1
  lineStyle?: LineStyle;    // Continuo, tratteggiato, assi, tubazioni
  lineStyleScale?: number;  // Scala del tipo di linea (moltiplicatore passo tratteggio, default 1.0)
  hatchPattern?: HatchPattern; // Retino / Campitura tecnica
  hatchColor?: string;      // Colore delle linee di campitura
  hatchScale?: number;      // Scala/densità del retino (passo in pt, default 1.0)
  hatchAngle?: number;      // Angolo di inclinazione del retino in gradi (default 0)
  startHead?: LineEnding;   // Terminazione iniziale linea/polilinea (none, arrow, open_arrow, circle, square, tick)
  endHead?: LineEnding;     // Terminazione finale linea/polilinea
  compoundPaths?: Array<{
    type: 'polyline' | 'polygon' | 'circle' | 'ellipse' | 'line' | 'rect' | 'text';
    points?: Point2D[];
    circle?: { cx: number; cy: number; r: number };
    ellipse?: { cx: number; cy: number; rx: number; ry: number };
    rect?: { x: number; y: number; width: number; height: number };
    text?: string;
    fontSize?: number;
    textAlign?: TextAlign;
    fontFamily?: string;
    strokeColor: string;
    strokeWidth: number;
    fillColor?: string;
  }>;
  boxRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isGroup?: boolean;
  isSymbol?: boolean;
  locked?: boolean;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textColor?: string;
  autoSize?: boolean;
}

export interface CloudMarkup extends BaseMarkup {
  type: 'cloud' | 'cloud_rect';
  points: Point2D[];        // Vertici del poligono o rettangolo guida per gli archi
  arcRadius?: number;       // Raggio degli archetti
}

export interface CloudPlusMarkup extends BaseMarkup {
  type: 'cloud_plus';
  cloudPoints: Point2D[];   // Vertici guida della nuvoletta
  leaderPoint: Point2D;     // Punto di ancoraggio sul bordo della nuvoletta
  elbowPoint?: Point2D;     // Gomito / deviazione opzionale della direttrice
  textFillColor?: string;   // Colore sfondo separato per il box di testo
  textFillOpacity?: number; // Opacità sfondo box di testo
  boxRect: {                // Box di testo
    x: number;
    y: number;
    width: number;
    height: number;
  };
  text: string;
  fontSize: number;
  fontFamily: string;
}

export interface RectangleMarkup extends BaseMarkup {
  type: 'rectangle';
  boxRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface EllipseMarkup extends BaseMarkup {
  type: 'ellipse';
  boxRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface CalloutMarkup extends BaseMarkup {
  type: 'callout';
  arrowPoint: Point2D;      // Vertice della freccia principale
  extraArrows?: Point2D[];  // Eventuali frecce aggiuntive collegate allo stesso gomito
  elbowPoint?: Point2D;     // Gomito / deviazione
  boxRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  text: string;
  fontSize: number;
  fontFamily: string;
}

export interface TextMarkup extends BaseMarkup {
  type: 'textbox';
  boxRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  text: string;
  fontSize: number;
  fontFamily: string;
}

export interface LineMarkup extends BaseMarkup {
  type: 'line' | 'arrow';
  startPoint: Point2D;
  endPoint: Point2D;
  startHead?: LineEnding;
  endHead?: LineEnding;
}

export interface PolylineMarkup extends BaseMarkup {
  type: 'polyline';
  points: Point2D[];
}

export interface PolygonMarkup extends BaseMarkup {
  type: 'polygon';
  points: Point2D[];
}

export interface MeasureLengthMarkup extends BaseMarkup {
  type: 'measure_length';
  startPoint: Point2D;
  endPoint: Point2D;
  measuredLength: number;   // In punti PDF
  realLength: number;       // Calcolato con la scala
  unit: UnitType;
  // Proprietà Quota CAD avanzata (stile Bluebeam Revu / AutoCAD)
  extensionOffset?: number;     // Distanza perpendicolare delle linee di estensione / quota (default: 24 pt)
  extensionOvershoot?: number;  // Sconfinamento dei testimoni oltre la linea di quota (default: 5 pt)
  extensionGap?: number;        // Spazio di stacco tra punto misurato e inizio testimone (default: 2 pt)
  dimensionEnding?: LineEnding; // Terminazione: 'tick' (slash 45° default), 'arrow', 'open_arrow', 'circle'
  customText?: string;          // Testo modificabile che sovrascrive o personalizza la quota (es. "575")
  fontSize?: number;            // Dimensione font del testo quota (default: 12 pt)
  fontFamily?: string;          // Famiglia carattere (default: 'Segoe UI, sans-serif')
  textColor?: string;           // Colore del testo quota (default: '#ffff00' o strokeColor)
  showUnit?: boolean;           // Mostra unità (es. "575 mm" vs "575")
  textPosition?: 'above' | 'center'; // Posizione testo quota: 'above' (standard CAD sopra la linea) o 'center' (in mezzo)
  showTextBackground?: boolean;      // Mostra riquadro di sfondo sotto il testo della quota (default: false per CAD trasparente)
  textFillColor?: string;            // Colore di riempimento dello sfondo del testo se attivo
}

export interface MeasurePolylineMarkup extends BaseMarkup {
  type: 'measure_polyline';
  points: Point2D[];
  measuredLength: number;
  realLength: number;
  unit: UnitType;
  customText?: string;
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
  showTextBackground?: boolean;
}

export interface MeasureAreaMarkup extends BaseMarkup {
  type: 'measure_area' | 'measure_area_rect';
  points: Point2D[];
  measuredArea: number;     // Punti quadrati
  realArea: number;         // Calcolato in m² o unità selezionata
  unit: UnitType;
  customText?: string;
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
  showTextBackground?: boolean;
}

export interface MeasureCountMarkup extends BaseMarkup {
  type: 'measure_count';
  locations: Point2D[];
  countNumber: number;
  symbol: 'circle' | 'square' | 'triangle' | 'cross';
}

export interface StampMarkup extends BaseMarkup {
  type: 'stamp';
  boxRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  stampTitle: string;
  dateStamp: string;
  signature?: string;
  pdfDataUri?: string;
  imageDataUrl?: string;
  rotation?: number;        // Rotazione in gradi (senso orario)
}

export interface PenMarkup extends BaseMarkup {
  type: 'pen' | 'highlighter';
  points: Point2D[];
}

export interface HyperlinkMarkup extends BaseMarkup {
  type: 'hyperlink';
  boxRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  actionType: 'goto_page' | 'url' | 'open_file';
  targetPage?: number;       // 1-based page number
  targetDocId?: string;      // Optional target open document id
  targetDocName?: string;    // Display name / file name
  targetUrl?: string;        // External URL (https://...)
  targetFilePath?: string;   // External file path
  targetScale?: 'fit_page' | 'keep_zoom';
}

export type AnyMarkup =
  | CloudMarkup
  | CloudPlusMarkup
  | RectangleMarkup
  | EllipseMarkup
  | CalloutMarkup
  | TextMarkup
  | LineMarkup
  | PolylineMarkup
  | PolygonMarkup
  | PenMarkup
  | MeasureLengthMarkup
  | MeasurePolylineMarkup
  | MeasureAreaMarkup
  | MeasureCountMarkup
  | StampMarkup
  | HyperlinkMarkup;
