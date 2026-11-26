import { TextAlign, VerticalAlign } from '@/types/markup';

export interface TextFormatOptions {
  fontSize: number;
  fontFamily: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textColor: string;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  paddingX?: number;
  paddingY?: number;
  lineHeightMultiplier?: number;
}

export class TextLayoutHelper {
  private static measurementCanvas: HTMLCanvasElement | null = null;
  private static measurementCtx: CanvasRenderingContext2D | null = null;

  public static getMeasurementContext(): CanvasRenderingContext2D {
    if (!this.measurementCtx) {
      this.measurementCanvas = document.createElement('canvas');
      this.measurementCtx = this.measurementCanvas.getContext('2d');
    }
    return this.measurementCtx!;
  }

  public static buildFontString(
    fontSize: number,
    fontFamily: string,
    fontWeight?: 'normal' | 'bold',
    fontStyle?: 'normal' | 'italic'
  ): string {
    const style = fontStyle && fontStyle !== 'normal' ? `${fontStyle} ` : '';
    const weight = fontWeight && fontWeight !== 'normal' ? `${fontWeight} ` : '';
    return `${style}${weight}${fontSize}px ${fontFamily || 'Segoe UI, sans-serif'}`;
  }

  private static splitWordToFit(ctx: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
    if (ctx.measureText(word).width <= maxWidth || word.length <= 1) {
      return [word];
    }
    const chunks: string[] = [];
    let current = '';
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      const test = current + char;
      if (ctx.measureText(test).width <= maxWidth || current.length === 0) {
        current = test;
      } else {
        chunks.push(current);
        current = char;
      }
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }

  /**
   * Divide un testo in paragrafi e righe che si adattano alla larghezza massima (Word Wrap)
   */
  public static wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): { paragraphIndex: number; lineIndex: number; isLastInParagraph: boolean; text: string; words: string[] }[] {
    const paragraphs = text.split('\n');
    const result: { paragraphIndex: number; lineIndex: number; isLastInParagraph: boolean; text: string; words: string[] }[] = [];

    const effectiveMaxWidth = Math.max(20, maxWidth);

    paragraphs.forEach((pText, pIdx) => {
      if (pText.trim().length === 0) {
        result.push({
          paragraphIndex: pIdx,
          lineIndex: 0,
          isLastInParagraph: true,
          text: '',
          words: [],
        });
        return;
      }

      const rawWords = pText.split(' ');
      let currentLineWords: string[] = [];
      const linesForThisParagraph: string[][] = [];

      rawWords.forEach((word) => {
        // Se la singola parola supera l'intera larghezza del rettangolo (es. stringhe continue o codici),
        // spezzala a livello di caratteri per evitare in ogni caso che sbordi dalla casella
        if (ctx.measureText(word).width > effectiveMaxWidth) {
          if (currentLineWords.length > 0) {
            linesForThisParagraph.push(currentLineWords);
            currentLineWords = [];
          }
          const wordChunks = this.splitWordToFit(ctx, word, effectiveMaxWidth);
          wordChunks.forEach((chunk, chunkIdx) => {
            if (chunkIdx < wordChunks.length - 1) {
              linesForThisParagraph.push([chunk]);
            } else {
              currentLineWords = [chunk];
            }
          });
          return;
        }

        const testLine = currentLineWords.length > 0 ? `${currentLineWords.join(' ')} ${word}` : word;
        const testWidth = ctx.measureText(testLine).width;

        if (testWidth <= effectiveMaxWidth || currentLineWords.length === 0) {
          currentLineWords.push(word);
        } else {
          linesForThisParagraph.push(currentLineWords);
          currentLineWords = [word];
        }
      });

      if (currentLineWords.length > 0) {
        linesForThisParagraph.push(currentLineWords);
      }

      linesForThisParagraph.forEach((lineWords, lineIdx) => {
        result.push({
          paragraphIndex: pIdx,
          lineIndex: lineIdx,
          isLastInParagraph: lineIdx === linesForThisParagraph.length - 1,
          text: lineWords.join(' '),
          words: lineWords,
        });
      });
    });

    return result;
  }

  /**
   * Rendering completo con adattamento al rettangolo, allineamento orizzontale e giustificazione verticale
   */
  public static renderFormattedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    boxRect: { x: number; y: number; width: number; height: number },
    options: TextFormatOptions
  ) {
    if (!text) return;

    ctx.save();
    const fontSize = options.fontSize || 12;
    const padX = options.paddingX !== undefined ? options.paddingX : 5;
    const padY = options.paddingY !== undefined ? options.paddingY : 5;
    const textAlign: TextAlign = options.textAlign || 'left';
    const verticalAlign: VerticalAlign = options.verticalAlign || 'top';
    const lineHeightMultiplier = options.lineHeightMultiplier || 1.25;
    const lineHeight = Math.round(fontSize * lineHeightMultiplier);

    ctx.font = this.buildFontString(fontSize, options.fontFamily, options.fontWeight, options.fontStyle);
    ctx.fillStyle = options.textColor || '#000000';
    ctx.textBaseline = 'top';

    const availWidth = Math.max(10, boxRect.width - padX * 2);
    const availHeight = Math.max(lineHeight, boxRect.height - padY * 2);

    // Clip al perimetro interno della casella per evitare qualsiasi sbordamento oltre il bordo
    ctx.beginPath();
    ctx.rect(boxRect.x, boxRect.y, Math.max(1, boxRect.width), Math.max(1, boxRect.height));
    ctx.clip();

    // Esegui il wrapping del testo per adattarlo al rettangolo
    const wrappedLines = this.wrapText(ctx, text, availWidth);
    const totalTextHeight = wrappedLines.length * lineHeight;

    // Calcola l'offset verticale in base all'allineamento (Top / Middle / Bottom)
    let startY = boxRect.y + padY;
    if (verticalAlign === 'middle') {
      startY = boxRect.y + padY + Math.max(0, (availHeight - totalTextHeight) / 2);
    } else if (verticalAlign === 'bottom') {
      startY = boxRect.y + padY + Math.max(0, availHeight - totalTextHeight);
    }

    // Disegna ciascuna riga con l'allineamento orizzontale specificato
    wrappedLines.forEach((lineInfo, idx) => {
      const lineY = startY + idx * lineHeight;

      // Se la riga esce dal rettangolo inferiore ed è impostato clipping, non straborda
      if (lineY + lineHeight < boxRect.y || lineY > boxRect.y + boxRect.height) {
        return;
      }

      const lineWidth = ctx.measureText(lineInfo.text).width;

      if (textAlign === 'left') {
        ctx.fillText(lineInfo.text, boxRect.x + padX, lineY);
      } else if (textAlign === 'center') {
        const lineX = boxRect.x + padX + Math.max(0, (availWidth - lineWidth) / 2);
        ctx.fillText(lineInfo.text, lineX, lineY);
      } else if (textAlign === 'right') {
        const lineX = boxRect.x + padX + Math.max(0, availWidth - lineWidth);
        ctx.fillText(lineInfo.text, lineX, lineY);
      } else if (textAlign === 'justify') {
        // Se è l'ultima riga del paragrafo o ha solo 1 parola, allinea a sinistra
        if (lineInfo.isLastInParagraph || lineInfo.words.length <= 1) {
          ctx.fillText(lineInfo.text, boxRect.x + padX, lineY);
        } else {
          // Distribuisci uniformemente gli spazi tra le parole
          const words = lineInfo.words;
          const wordsTotalWidth = words.reduce((acc, w) => acc + ctx.measureText(w).width, 0);
          const totalSpaceToDistribute = Math.max(0, availWidth - wordsTotalWidth);
          const spaceWidth = totalSpaceToDistribute / (words.length - 1);

          let curX = boxRect.x + padX;
          words.forEach((w) => {
            ctx.fillText(w, curX, lineY);
            curX += ctx.measureText(w).width + spaceWidth;
          });
        }
      }
    });

    ctx.restore();
  }

  /**
   * Calcola le dimensioni ottimali per adattare il rettangolo al testo (Alt+Z / Auto Size Text Box come Bluebeam Revu)
   * Se la casella ha già una larghezza definita (currentWidth), mantiene la larghezza della colonna e accorcia lo spazio vuoto in basso.
   */
  public static calculateAutoSize(
    text: string,
    options: {
      fontSize: number;
      fontFamily: string;
      fontWeight?: 'normal' | 'bold';
      fontStyle?: 'normal' | 'italic';
      paddingX?: number;
      paddingY?: number;
      lineHeightMultiplier?: number;
      currentWidth?: number;
    }
  ): { width: number; height: number } {
    const ctx = this.getMeasurementContext();
    const fontSize = options.fontSize || 12;
    const padX = options.paddingX !== undefined ? options.paddingX : 6;
    const padY = options.paddingY !== undefined ? options.paddingY : 6;
    const lineHeightMultiplier = options.lineHeightMultiplier || 1.25;
    const lineHeight = Math.round(fontSize * lineHeightMultiplier);

    ctx.font = this.buildFontString(fontSize, options.fontFamily, options.fontWeight, options.fontStyle);

    const textToMeasure = text && text.trim().length > 0 ? text : 'Testo';

    // Se esiste già una larghezza impostata per la casella (currentWidth):
    // Rispettiamo la sagoma attuale ed eseguiamo il wrapping sul rettangolo corrente,
    // in modo che Alt+Z accorci l'eccesso di altezza in basso e rifinisca la larghezza,
    // senza appiattire un testo su più righe in una striscia orizzontale infinita!
    if (options.currentWidth && options.currentWidth > 30) {
      const availWidth = Math.max(20, options.currentWidth - padX * 2);
      const wrappedLines = this.wrapText(ctx, textToMeasure, availWidth);
      
      let maxLineWidth = 0;
      wrappedLines.forEach((l) => {
        const w = ctx.measureText(l.text || ' ').width;
        if (w > maxLineWidth) maxLineWidth = w;
      });

      // La nuova larghezza non deforma la colonna, e l'altezza si accorcia dal basso eliminando lo spazio vuoto
      const calculatedWidth = Math.max(30, Math.ceil(maxLineWidth + padX * 2 + 4));
      const calculatedHeight = Math.max(lineHeight + padY * 2, Math.ceil(wrappedLines.length * lineHeight + padY * 2 + 2));

      return {
        width: calculatedWidth,
        height: calculatedHeight,
      };
    }

    // Se currentWidth non è specificata (es. calcolo da zero o singola riga esplicita):
    const paragraphs = textToMeasure.split('\n');
    let maxLineWidth = 0;
    paragraphs.forEach((p) => {
      const w = ctx.measureText(p || ' ').width;
      if (w > maxLineWidth) {
        maxLineWidth = w;
      }
    });

    const calculatedWidth = Math.max(30, Math.ceil(maxLineWidth + padX * 2 + 4));
    const calculatedHeight = Math.max(lineHeight + padY * 2, Math.ceil(paragraphs.length * lineHeight + padY * 2 + 2));

    return {
      width: calculatedWidth,
      height: calculatedHeight,
    };
  }
}
