import React from 'react';
import iconData from '@/core/icons/bluebeamIcons.json';

const rawIcons = iconData as Record<string, string>;

const ICON_MAP: Record<string, string> = {
  // Navigazione & Selezione (Geometrie ufficiali Bluebeam Revu)
  select: rawIcons['SelectGeometry'],
  pan: rawIcons['PanGeometry'],
  select_text: rawIcons['SelectTextGeometry'],
  edit_pdf_text: rawIcons['EditTextGeometry'],
  single_page: 'M5 2h10a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1zm1 2v12h8V4H6z',
  continuous_page: 'M5 1h10a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V2a1 1 0 011-1zm1 1.5v4h8v-4H6zm-1 7.5h10a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1v-5a1 1 0 011-1zm1 1.5v4h8v-4H6z',

  // Marcature & Forme (Geometrie ufficiali Bluebeam Revu)
  cloud_rect: rawIcons['CloudAnnotationGeometry'],
  cloud: rawIcons['CloudAnnotationGeometry'],
  cloud_plus: rawIcons['CloudPlusAnnotationGeometry'],
  callout: rawIcons['CalloutAnnotationGeometry'],
  textbox: rawIcons['TextBoxAnnotationGeometry'],
  typewriter: rawIcons['TypeWriterAnnotationGeometry'],
  note: rawIcons['NoteAnnotationGeometry'],
  rectangle: rawIcons['RectangleAnnotationGeometry'],
  ellipse: rawIcons['EllipseAnnotationGeometry'],
  polygon: rawIcons['PolygonAnnotationGeometry'],
  polyline: rawIcons['PolylineAnnotationGeometry'],
  line: rawIcons['LineAnnotationGeometry'],
  arrow: rawIcons['ArrowAnnotationGeometry'],
  connector: 'M2 15h6V5h8.5V3l3 3-3 3V7H10v10H2v-2z',
  arc: rawIcons['ArcAnnotationGeometry'],
  pen: rawIcons['PenAnnotationGeometry'],
  highlighter: rawIcons['HighlighterAnnotationGeometry'],
  eraser: rawIcons['EraserGeometry'],
  image: rawIcons['ImageAnnotationGeometry'],
  flag: rawIcons['FlagAddGeometry'] || rawIcons['FlagGeometry'],

  // Misure & Takeoff (Geometrie ufficiali Bluebeam Revu)
  measure_length: rawIcons['DimensionAnnotationGeometry'] || rawIcons['MeasureLengthGeometry'],
  measure_polyline: rawIcons['MeasurePolylengthGeometry'],
  measure_area_rect: rawIcons['MeasurePerimeterGeometry'] || rawIcons['RectangleAnnotationGeometry'],
  measure_area: rawIcons['MeasureCutoutPolygonGeometry'] || rawIcons['PolygonAnnotationGeometry'],
  measure_count: rawIcons['CountCheckmarkGeometry'] || rawIcons['CountCircleGeometry'] || rawIcons['MeasureToolGeometryPart2'],
  calibrate: rawIcons['MeasureToolGeometry'],
  stamp: rawIcons['StampAnnotationGeometry'] || rawIcons['StampGeometry'],
  snapshot: rawIcons['SnapshotGeometry'] || rawIcons['SnapshotAnnotationGeometry'],
  erase_content: rawIcons['EraseContentGeometry'] || rawIcons['EraserGeometry'],
  flatten: rawIcons['FlattenGeometry'],

  // Utilità
  crop: rawIcons['CropGeometry'],
  lock: rawIcons['LockGeometry'],
  trash: rawIcons['TrashGeometry'],
  split_vertical: rawIcons['SplitVerticalGeometry'],
  split_horizontal: rawIcons['SplitHorizontalGeometry'],
  unsplit: rawIcons['UnSplitGeometry'],
  home: rawIcons['IconHomePageGeometry'],
};

const PART2_MAP: Record<string, { d: string; color: string }> = {
  pen: { d: rawIcons['PenAnnotationGeometryPart2'], color: '#38bdf8' },
  highlighter: { d: rawIcons['HighlighterAnnotationGeometryPart2'], color: '#facc15' },
  eraser: { d: rawIcons['EraserGeometryPart2'], color: '#f87171' },
  measure_polyline: { d: rawIcons['MeasurePolylengthGeometryPart2'], color: '#38bdf8' },
  measure_area_rect: { d: rawIcons['MeasurePerimeterGeometryPart2'], color: '#38bdf8' },
  measure_area: { d: rawIcons['MeasureCutoutPolygonGeometryPart2'], color: '#38bdf8' },
  calibrate: { d: rawIcons['MeasureToolGeometryPart2'], color: '#f59e0b' },
  flag: { d: rawIcons['FlagAddGeometryPart2'], color: '#4ade80' },
  flatten: { d: rawIcons['FlattenGeometryPart2'], color: '#facc15' },
};

interface BluebeamIconProps {
  name: string;
  size?: number;
  className?: string;
  color?: string;
}

export const BluebeamIcon: React.FC<BluebeamIconProps> = ({
  name,
  size = 16,
  className = '',
  color = 'currentColor',
}) => {
  const pathD = ICON_MAP[name] || rawIcons[name];
  const part2 = PART2_MAP[name];

  if (!pathD) {
    return <span className={`inline-block w-[${size}px] h-[${size}px] bg-gray-500 rounded-sm`} />;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={color}
      className={`inline-block align-middle transition-colors shrink-0 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={pathD} fillRule="evenodd" clipRule="evenodd" />
      {part2?.d && (
        <path d={part2.d} fill={part2.color} fillRule="evenodd" clipRule="evenodd" />
      )}
    </svg>
  );
};
