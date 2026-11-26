export interface FontOption {
  id: string;
  name: string;
  category: 'CAD / Tecnico' | 'Sans-Serif' | 'Serif' | 'Monospace';
  family: string;
}

export const AVAILABLE_FONTS: FontOption[] = [
  // 1. FONT CAD E TECNICI
  { id: 'isocpeur', name: 'ISOCPEUR (CAD Standard)', category: 'CAD / Tecnico', family: 'ISOCPEUR, "Segoe UI", sans-serif' },
  { id: 'isocteur', name: 'ISOCTEUR (CAD Corsivo)', category: 'CAD / Tecnico', family: 'ISOCTEUR, "Segoe UI", sans-serif' },
  { id: 'romans', name: 'Romans (CAD Simplex)', category: 'CAD / Tecnico', family: 'Romans, "Courier New", monospace' },
  { id: 'titillium', name: 'Titillium Web (CAD Tech)', category: 'CAD / Tecnico', family: '"Titillium Web", sans-serif' },
  { id: 'arch', name: 'Archivo (Ingegneria)', category: 'CAD / Tecnico', family: 'Archivo, sans-serif' },

  // 2. STANDARD SANS-SERIF
  { id: 'segoe', name: 'Segoe UI (Default Revu)', category: 'Sans-Serif', family: '"Segoe UI", sans-serif' },
  { id: 'arial', name: 'Arial', category: 'Sans-Serif', family: 'Arial, sans-serif' },
  { id: 'helvetica', name: 'Helvetica', category: 'Sans-Serif', family: 'Helvetica, Arial, sans-serif' },
  { id: 'calibri', name: 'Calibri', category: 'Sans-Serif', family: 'Calibri, sans-serif' },
  { id: 'roboto', name: 'Roboto', category: 'Sans-Serif', family: 'Roboto, sans-serif' },
  { id: 'opensans', name: 'Open Sans', category: 'Sans-Serif', family: '"Open Sans", sans-serif' },
  { id: 'verdana', name: 'Verdana', category: 'Sans-Serif', family: 'Verdana, sans-serif' },
  { id: 'tahoma', name: 'Tahoma', category: 'Sans-Serif', family: 'Tahoma, sans-serif' },
  { id: 'trebuchet', name: 'Trebuchet MS', category: 'Sans-Serif', family: '"Trebuchet MS", sans-serif' },
  { id: 'ubuntu', name: 'Ubuntu', category: 'Sans-Serif', family: 'Ubuntu, sans-serif' },
  { id: 'montserrat', name: 'Montserrat', category: 'Sans-Serif', family: 'Montserrat, sans-serif' },

  // 3. MONOSPACE / CODICE / TABELLE
  { id: 'consolas', name: 'Consolas', category: 'Monospace', family: 'Consolas, monospace' },
  { id: 'courier', name: 'Courier New', category: 'Monospace', family: '"Courier New", Courier, monospace' },
  { id: 'firacode', name: 'Fira Code (CAD Monospace)', category: 'Monospace', family: '"Fira Code", monospace' },
  { id: 'inconsolata', name: 'Inconsolata', category: 'Monospace', family: 'Inconsolata, monospace' },

  // 4. SERIF
  { id: 'times', name: 'Times New Roman', category: 'Serif', family: '"Times New Roman", Times, serif' },
  { id: 'georgia', name: 'Georgia', category: 'Serif', family: 'Georgia, serif' },
];

/**
 * Normalizza e deduce le proprietà del font a partire dai metadati originali estratti da PDF.js
 */
export function resolveOriginalPdfFont(rawFontName: string): {
  family: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
} {
  if (!rawFontName) {
    return { family: 'Arial, sans-serif', fontWeight: 'normal', fontStyle: 'normal' };
  }

  const lower = rawFontName.toLowerCase();

  // Deduce peso (Bold) e stile (Italic)
  const isBold = lower.includes('bold') || lower.includes('black') || lower.includes('heavy') || lower.includes('bolder');
  const isItalic = lower.includes('italic') || lower.includes('oblique') || lower.includes('slanted');

  const fontWeight: 'normal' | 'bold' = isBold ? 'bold' : 'normal';
  const fontStyle: 'normal' | 'italic' = isItalic ? 'italic' : 'normal';

  // Cerca corrispondenze con famiglie font reali
  if (lower.includes('isocpeur') || lower.includes('isocp')) {
    return { family: 'ISOCPEUR, "Segoe UI", sans-serif', fontWeight, fontStyle };
  }
  if (lower.includes('isocteur') || lower.includes('isoct')) {
    return { family: 'ISOCTEUR, "Segoe UI", sans-serif', fontWeight, fontStyle: 'italic' };
  }
  if (lower.includes('romans') || lower.includes('simplex') || lower.includes('txt')) {
    return { family: 'Romans, "Courier New", monospace', fontWeight, fontStyle };
  }
  if (lower.includes('helvetica')) {
    return { family: 'Helvetica, Arial, sans-serif', fontWeight, fontStyle };
  }
  if (lower.includes('arial')) {
    return { family: 'Arial, sans-serif', fontWeight, fontStyle };
  }
  if (lower.includes('times')) {
    return { family: '"Times New Roman", Times, serif', fontWeight, fontStyle };
  }
  if (lower.includes('courier')) {
    return { family: '"Courier New", Courier, monospace', fontWeight, fontStyle };
  }
  if (lower.includes('segoe')) {
    return { family: '"Segoe UI", sans-serif', fontWeight, fontStyle };
  }
  if (lower.includes('calibri')) {
    return { family: 'Calibri, sans-serif', fontWeight, fontStyle };
  }
  if (lower.includes('roboto')) {
    return { family: 'Roboto, sans-serif', fontWeight, fontStyle };
  }
  if (lower.includes('consolas')) {
    return { family: 'Consolas, monospace', fontWeight, fontStyle };
  }
  if (lower.includes('verdana')) {
    return { family: 'Verdana, sans-serif', fontWeight, fontStyle };
  }
  if (lower.includes('tahoma')) {
    return { family: 'Tahoma, sans-serif', fontWeight, fontStyle };
  }

  // Fallback universale: sans-serif leggibile
  return { family: 'Arial, "Segoe UI", sans-serif', fontWeight, fontStyle };
}
