import { Injectable, signal } from '@angular/core';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

import type { StudioPdfDocument } from '../models/pdf-document.model';
import type {
  PdfDocumentContentAnalysis,
  PdfExistingTextBlock,
  PdfExistingImageBlock,
  PdfPageContentAnalysis,
  PdfTextTransform,
  PdfSourceTextRun
} from '../models/pdf-content-analysis.model';

@Injectable({ providedIn: 'root' })
export class PdfContentAnalysisService {
  private readonly analysisState = signal<PdfDocumentContentAnalysis | null>(null);
  private activeDocumentId: string | null = null;
  private readonly inFlight = new Map<number, Promise<PdfPageContentAnalysis | null>>();
  /** Browser font faces registered from PDF.js source font programs. */
  private readonly sourceFontFaces = new Map<string, Promise<string | null>>();

  readonly analysis = this.analysisState.asReadonly();

  reset(): void {
    this.activeDocumentId = null;
    this.inFlight.clear();
    this.sourceFontFaces.clear();
    this.analysisState.set(null);
  }

  begin(document: StudioPdfDocument): void {
    this.activeDocumentId = document.id;
    this.inFlight.clear();
    this.analysisState.set({
      documentId: document.id,
      pageCount: document.pageCount,
      analyzedPages: 0,
      totalTextBlocks: 0,
      totalImagePaints: 0,
      pages: {},
      status: 'idle',
      error: null
    });
  }

  async ensurePage(
    document: StudioPdfDocument,
    pageNumber: number,
    getPage: (pageNumber: number) => Promise<PDFPageProxy>
  ): Promise<PdfPageContentAnalysis | null> {
    if (this.activeDocumentId !== document.id) {
      this.begin(document);
    }

    const current = this.analysisState();
    const existing = current?.pages[pageNumber];
    if (existing) return existing;

    const running = this.inFlight.get(pageNumber);
    if (running) return running;

    const task = this.analyzePage(document, pageNumber, getPage)
      .finally(() => this.inFlight.delete(pageNumber));
    this.inFlight.set(pageNumber, task);
    return task;
  }

  private async analyzePage(
    document: StudioPdfDocument,
    pageNumber: number,
    getPage: (pageNumber: number) => Promise<PDFPageProxy>
  ): Promise<PdfPageContentAnalysis | null> {
    this.patchStatus('analyzing', null);

    try {
      const page = await getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const [operatorList, pdfjs] = await Promise.all([
        page.getOperatorList(),
        import('pdfjs-dist')
      ]);
      const sourceTextColors = this.extractTextFillColors(operatorList, pdfjs);

      /*
       * Materialize the page operator list before resolving commonObjs fonts.
       * This makes the source PDF.js FontFaceObject available deterministically
       * instead of relying on a later render to populate the shared font map.
       */
      const styles = textContent.styles as Record<string, { fontFamily?: string; fontWeight?: string | number; fontStyle?: string; ascent?: number; descent?: number }> ;

      const sourceTextItems = (textContent.items as readonly unknown[])
        .filter((item): item is {
          str: string;
          transform: readonly [number, number, number, number, number, number];
          width: number;
          height: number;
          fontName?: string;
        } => this.isTextItem(item));

      const textBlocks: PdfExistingTextBlock[] = [];
      let index = 0;
      let sourceTextItemIndex = 0;

      for (const rawItem of sourceTextItems) {
        // Keep the colour cursor aligned with the complete PDF.js text-item
        // stream, including whitespace-only items that are intentionally not
        // exposed as Studio objects.
        const sourceTextColor = sourceTextColors[sourceTextItemIndex++] ?? null;
        const text = rawItem.str.trim();
        if (!text) continue;

        // PDF.js textItem.transform is expressed in viewport coordinates
        // (origin at the top-left, Y growing downward). Export uses pdf-lib
        // PDF coordinates (origin at the bottom-left, Y growing upward).
        // Keep the source matrix in the coordinate system that the export
        // service actually consumes. Converting only the translation (e/f)
        // is not sufficient: the Y components of both matrix basis vectors
        // must also be inverted.
        const rawTransform = rawItem.transform;
        const transform: PdfTextTransform = [
          rawTransform[0],
          -rawTransform[1],
          rawTransform[2],
          -rawTransform[3],
          rawTransform[4],
          viewport.height - rawTransform[5]
        ];
        const [a, b, c, d, e, f] = transform;
        const style = styles[rawItem.fontName || ''];
        const fontSizePdf = Math.max(0.01, Math.hypot(c, d) || Math.hypot(a, b));
        const rawWidth = Math.abs(rawItem.width || fontSizePdf);
        const rawHeight = Math.abs(rawItem.height || Math.hypot(c, d) || fontSizePdf);
        const width = Math.min(1, Math.max(0, rawWidth / viewport.width));
        const height = Math.min(1, Math.max(0, rawHeight / viewport.height));
        const detectedFontSize = Math.min(0.12, Math.max(0.004, Math.hypot(a, b) / viewport.height));
        const rotation = Math.atan2(b, a) * 180 / Math.PI;
        const lineHeightPdf = this.inferSourceLineHeightPdf(
          rawItem,
          sourceTextItems,
          fontSizePdf,
        );
        const lineHeight = Math.max(
          detectedFontSize,
          lineHeightPdf / Math.max(1, viewport.height),
        );
        const x = Math.min(1, Math.max(0, e / viewport.width));
        // PDF coordinates grow upward; Studio coordinates grow downward.
        const y = Math.min(1, Math.max(0, 1 - (f + rawHeight) / viewport.height));

        textBlocks.push({
          id: `pdf-text-${pageNumber}-${index++}`,
          pageNumber,
          text,
          fontName: rawItem.fontName || 'Unknown',
          x,
          y,
          width,
          height,
          transform,
          detectedFontSize,
          rotation,
          lineHeight,
          fontFamily: this.resolveSourceFontFamily(style?.fontFamily, rawItem.fontName),
          fontWeight: this.normalizeFontWeight(style?.fontWeight),
          fontStyle: /italic|oblique/i.test(String(style?.fontStyle ?? rawItem.fontName ?? '')) ? 'italic' : 'normal',
          textColor: sourceTextColor,
          ascent: typeof style?.ascent === 'number' ? style.ascent : null,
          descent: typeof style?.descent === 'number' ? style.descent : null,
          // Phase 2: capture source metrics at PDF.js scale=1 before any
          // Studio normalization, zoom, or display rotation is applied.
          pageWidthPdf: viewport.width,
          pageHeightPdf: viewport.height,
          fontSizePdf,
          textWidthPdf: Math.max(0, rawWidth),
          textHeightPdf: Math.max(0, rawHeight),
          lineHeightPdf,
          // Effective magnitudes of the source text-matrix basis vectors.
          // These are deliberately not CSS/browser scale values.
          transformScaleX: Math.max(0.000001, Math.hypot(a, b)),
          transformScaleY: Math.max(0.000001, Math.hypot(c, d)),
          // The converted matrix above is now in true PDF page coordinates,
          // so e/f are the source text origin/baseline used by pdf-lib.
          baselineXPdf: e,
          baselineYPdf: f,
          sourceRuns: [{
            text,
            startIndex: 0,
            endIndex: text.length,
            baselineXPdf: e,
            widthPdf: Math.max(0, rawWidth),
          }],
          ascentPdf: typeof style?.ascent === 'number' ? style.ascent * fontSizePdf : null,
          descentPdf: typeof style?.descent === 'number' ? style.descent * fontSizePdf : null,
          /*
           * Filled from PDF.js commonObjs after the page operator list has
           * materialized the actual source font face.
           */
          sourceFontFamily: null,
          sourceFontCssFamily: null
        });
      }

      const imageBlocks = await this.extractImageBlocks(page, viewport.width, viewport.height);

      /*
       * extractImageBlocks() obtains the page operator list, which causes
       * PDF.js to materialize the page's shared font objects. Read loadedName
       * only after that point so the Studio HTML overlay can use the exact font
       * face that PDF.js uses for the original PDF canvas, rather than guessing
       * from TextStyle.fontFamily.
       */
      const enrichedTextBlocks = await Promise.all(textBlocks.map(async block => {
        const loadedFont =
          this.resolveLoadedFont(page, block.fontName);

        const sourceFontCssFamily = loadedFont?.loadedName
          ? await this.ensureBrowserSourceFontFace(
              document.id,
              page.pageNumber,
              block.fontName,
              loadedFont.loadedName,
              loadedFont.data,
              loadedFont.mimetype,
              loadedFont.weight,
              loadedFont.italic,
            )
          : null;

        return {
          ...block,
          sourceFontFamily:
            loadedFont?.familyName ?? block.sourceFontFamily ?? block.fontFamily ?? null,
          sourceFontCssFamily:
            sourceFontCssFamily ?? loadedFont?.loadedName ?? null,
          fontWeight:
            loadedFont?.weight ?? block.fontWeight,
          fontStyle:
            loadedFont?.italic === true
              ? 'italic'
              : block.fontStyle
        };
      }));

      const imagePaintCount = imageBlocks.length;

      /*
       * Phase 3.10 — expose one editable object per visual text line rather
       * than one object per arbitrary PDF.js text chunk.
       *
       * PDF.js may split a single rendered line into several text items
       * (sometimes only a couple of words). Using those raw chunks as edit
       * targets made the UX inconsistent: clicking different words could open
       * editors of different widths, and replacing a short chunk left the
       * remainder of the original line visible beside the replacement.
       *
       * Collapse adjacent, same-style source runs that share the same visual
       * baseline into one deterministic line block. The original PDF canvas
       * remains authoritative for untouched content; the line block is only
       * the edit/cover/replacement target.
       */
      const editableLineBlocks =
        this.groupTextBlocksIntoEditableLines(enrichedTextBlocks);

      const result: PdfPageContentAnalysis = {
        pageNumber,
        textBlocks: editableLineBlocks,
        imageBlocks,
        imagePaintCount,
        analyzedAt: Date.now()
      };

      if (this.activeDocumentId === document.id) {
        const current = this.analysisState();
        if (!current) return result;
        const pages = { ...current.pages, [pageNumber]: result };
        const values = Object.values(pages);
        this.analysisState.set({
          ...current,
          pages,
          analyzedPages: values.length,
          totalTextBlocks: values.reduce((sum, item) => sum + item.textBlocks.length, 0),
          totalImagePaints: values.reduce((sum, item) => sum + item.imagePaintCount, 0),
          status: 'ready',
          error: null
        });
      }

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to analyze this PDF page.';
      this.patchStatus('error', message);
      return null;
    }
  }

  /**
   * Collapse PDF.js text chunks into deterministic visual-line edit targets.
   *
   * A PDF does not have to store one text operator per visual line. PDF.js can
   * therefore expose "nec ultricies.", "Sed vulputate..." etc. as separate
   * text items even though the user sees one continuous line. Studio should
   * not make the user guess which chunk was hit.
   *
   * We group only compatible runs:
   *   - same page and near-identical baseline
   *   - same rotation
   *   - same embedded/source CSS font
   *   - same weight/style/colour
   *   - physically adjacent on the same line
   *
   * Keeping style compatibility is deliberate. A line containing a bold or
   * differently-coloured segment must not silently lose that source styling
   * merely because the user clicked it.
   */
  private groupTextBlocksIntoEditableLines(
    blocks: readonly PdfExistingTextBlock[]
  ): PdfExistingTextBlock[] {
    if (blocks.length <= 1) {
      return [...blocks];
    }

    const sorted = [...blocks].sort((left, right) => {
      if (left.pageNumber !== right.pageNumber) {
        return left.pageNumber - right.pageNumber;
      }

      const baselineDelta =
        right.baselineYPdf - left.baselineYPdf;

      if (Math.abs(baselineDelta) > 0.01) {
        return baselineDelta;
      }

      return left.baselineXPdf - right.baselineXPdf;
    });

    const groups: PdfExistingTextBlock[][] = [];

    for (const block of sorted) {
      const previous =
        groups.length > 0
          ? groups[groups.length - 1][groups[groups.length - 1].length - 1]
          : null;

      if (
        previous &&
        this.canJoinTextBlocksIntoLine(previous, block)
      ) {
        groups[groups.length - 1].push(block);
      } else {
        groups.push([block]);
      }
    }

    return groups.map(group => {
      if (group.length === 1) {
        return group[0];
      }

      const first = group[0];
      const pageWidth = Math.max(1, first.pageWidthPdf);
      const pageHeight = Math.max(1, first.pageHeightPdf);

      const minXPdf =
        Math.min(...group.map(item => item.baselineXPdf));
      const maxXPdf =
        Math.max(
          ...group.map(
            item => item.baselineXPdf + item.textWidthPdf
          )
        );

      const minYPdf =
        Math.min(
          ...group.map(
            item => (1 - item.y - item.height) * pageHeight
          )
        );
      const maxYPdf =
        Math.max(
          ...group.map(
            item => (1 - item.y) * pageHeight
          )
        );

      /*
       * Text items are sorted left-to-right. Insert a normal word separator
       * only when there is a real PDF-space gap. This preserves chunks that
       * were split inside a word while reconstructing normal word boundaries
       * between separate PDF.js items.
       */
      let text = '';
      const sourceRuns: PdfSourceTextRun[] = [];

      for (let index = 0; index < group.length; index++) {
        const item = group[index];
        const prior = index > 0 ? group[index - 1] : null;
        const gapPdf = prior
          ? item.baselineXPdf - (prior.baselineXPdf + prior.textWidthPdf)
          : 0;
        const separator = prior && gapPdf > 0.5 ? ' ' : '';
        text += separator;
        const startIndex = text.length;
        text += item.text;
        const endIndex = text.length;
        sourceRuns.push({
          text: item.text,
          startIndex,
          endIndex,
          baselineXPdf: item.baselineXPdf,
          widthPdf: item.textWidthPdf
        });
      }

      const widthPdf =
        Math.max(0.01, maxXPdf - minXPdf);
      const heightPdf =
        Math.max(0.01, maxYPdf - minYPdf);

      /*
       * Preserve the exact start/width of every source PDF.js run. The logical
       * editor string may contain a normal separator for usability, but the
       * renderer/exporter must never reconstruct those gaps as browser spaces.
       */
      return {
        ...first,
        id: first.id,
        text,
        x: minXPdf / pageWidth,
        y: (pageHeight - maxYPdf) / pageHeight,
        width: widthPdf / pageWidth,
        height: heightPdf / pageHeight,
        textWidthPdf: widthPdf,
        textHeightPdf: heightPdf,
        baselineXPdf: minXPdf,
        sourceRuns
      };
    });
  }

  private canJoinTextBlocksIntoLine(
    left: PdfExistingTextBlock,
    right: PdfExistingTextBlock
  ): boolean {
    if (left.pageNumber !== right.pageNumber) {
      return false;
    }

    const leftRotation =
      Math.abs(left.rotation ?? 0);
    const rightRotation =
      Math.abs(right.rotation ?? 0);

    if (Math.abs(leftRotation - rightRotation) > 0.5) {
      return false;
    }

    const baselineTolerance =
      Math.max(
        1,
        Math.min(
          3,
          Math.max(
            left.fontSizePdf,
            right.fontSizePdf
          ) * 0.25
        )
      );

    if (
      Math.abs(
        left.baselineYPdf -
        right.baselineYPdf
      ) > baselineTolerance
    ) {
      return false;
    }

    if (
      left.sourceFontCssFamily !==
      right.sourceFontCssFamily ||
      left.sourceFontFamily !==
      right.sourceFontFamily ||
      left.fontWeight !==
      right.fontWeight ||
      left.fontStyle !==
      right.fontStyle ||
      left.textColor !==
      right.textColor
    ) {
      return false;
    }

    const pageWidth =
      Math.max(1, left.pageWidthPdf);
    const gapPdf =
      right.baselineXPdf -
      (
        left.baselineXPdf +
        left.textWidthPdf
      );

    /*
     * A normal inter-word gap is tiny. Allow a few font sizes for operators
     * that split a line into larger chunks, but do not bridge normal columns
     * or table cells.
     */
    const maxGapPdf =
      Math.max(
        18,
        Math.max(
          left.fontSizePdf,
          right.fontSizePdf
        ) * 3
      );

    if (gapPdf < -1 || gapPdf > maxGapPdf) {
      return false;
    }

    /*
     * Do not join a vertical/rotated run into a horizontal line. For rotated
     * text, the existing matrix-based bounds remain the safer edit target.
     */
    if (leftRotation >= 0.5) {
      return false;
    }

    void pageWidth;
    return true;
  }

  /** Prefer a usable PDF.js CSS family, then a cleaned PDF resource name. */
  private resolveSourceFontFamily(
    styleFamily: string | undefined,
    fontName: string | undefined
  ): string | null {
    const clean = (value: string | undefined): string => String(value ?? '')
      .replace(/^\/?[A-Z]{6}\+/, '')
      .trim();
    const candidate = clean(styleFamily);
    // PDF.js sometimes exposes internal names such as g_d0_f12. Those are not
    // browser font families and must not override a meaningful source name.
    if (candidate && !/^g_[a-z0-9_]+_f\d+$/i.test(candidate) && !/^(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif)$/i.test(candidate)) {
      return candidate;
    }
    const raw = clean(fontName);
    return raw && !/^g_[a-z0-9_]+_f\d+$/i.test(raw) ? raw : null;
  }

  /**
   * Recover the real baseline-to-baseline distance used by the PDF text runs.
   * PDF.js `TextItem.height` is a glyph-box height, not paragraph line spacing,
   * so using it as line-height collapses Calibri 10.56 pt text to 1.00 and clips
   * descenders in the live editor. We infer spacing from neighbouring runs that
   * share the same font and text-matrix orientation.
   */
  private inferSourceLineHeightPdf(
    item: {
      str: string;
      transform: readonly [number, number, number, number, number, number];
      width: number;
      height: number;
      fontName?: string;
    },
    items: readonly {
      str: string;
      transform: readonly [number, number, number, number, number, number];
      width: number;
      height: number;
      fontName?: string;
    }[],
    fontSizePdf: number,
  ): number {
    const [a, b, c, d, e, f] = item.transform;
    const uxLength = Math.hypot(a, b) || 1;
    const vyLength = Math.hypot(c, d) || 1;
    const ux = a / uxLength;
    const uy = b / uxLength;
    const vx = c / vyLength;
    const vy = d / vyLength;

    const gaps: number[] = [];

    for (const candidate of items) {
      if (candidate === item || candidate.fontName !== item.fontName) continue;
      const [ca, cb, cc, cd, ce, cf] = candidate.transform;
      const candidateUxLength = Math.hypot(ca, cb) || 1;
      const candidateVyLength = Math.hypot(cc, cd) || 1;
      const candidateUx = ca / candidateUxLength;
      const candidateUy = cb / candidateUxLength;
      const candidateVx = cc / candidateVyLength;
      const candidateVy = cd / candidateVyLength;

      // Only compare runs with effectively the same text direction/rotation.
      const orientation = Math.abs(ux * candidateUx + uy * candidateUy);
      const verticalOrientation = Math.abs(vx * candidateVx + vy * candidateVy);
      if (orientation < 0.999 || verticalOrientation < 0.999) continue;

      const dx = ce - e;
      const dy = cf - f;
      const alongBaseline = Math.abs(dx * ux + dy * uy);
      const baselineDelta = dx * vx + dy * vy;
      const gap = Math.abs(baselineDelta);

      // A new line starts close to the same horizontal origin. Same-line words
      // have a large along-baseline delta and near-zero vertical delta.
      if (alongBaseline > Math.max(fontSizePdf * 4, 24)) continue;
      if (gap < fontSizePdf * 1.05 || gap > fontSizePdf * 2.2) continue;

      gaps.push(gap);
    }

    if (gaps.length) {
      gaps.sort((left, right) => left - right);
      const middle = Math.floor(gaps.length / 2);
      const median = gaps.length % 2
        ? gaps[middle]
        : (gaps[middle - 1] + gaps[middle]) / 2;
      return Math.max(fontSizePdf, median);
    }

    // If the run is isolated (e.g. a one-line heading), preserve its glyph
    // height rather than inventing a paragraph spacing value.
    return Math.max(fontSizePdf, Math.abs(item.height || fontSizePdf));
  }

  /**
   * Resolve the fill colour active at each text-show operator.
   *
   * Sampling the rendered canvas is intentionally avoided here: anti-aliased
   * glyph pixels, selection chrome and neighbouring UI pixels can turn a pure
   * PDF colour such as 0 g (black) into an unrelated median such as #101820.
   * The PDF operator list is the authoritative source for text colour.
   *
   * The returned array follows the text-show operator order, which matches the
   * order of PDF.js text items for normal PDF text streams. If a producer uses
   * an unsupported colour operator, the previous colour is retained.
   */
  private extractTextFillColors(
    operatorList: { fnArray: readonly number[]; argsArray: readonly unknown[] },
    pdfjs: typeof import('pdfjs-dist')
  ): string[] {
    const ops = pdfjs.OPS as unknown as Record<string, number>;
    const showOps = new Set(
      [
        ops['showText'],
        ops['showSpacedText'],
        ops['nextLineShowText'],
        ops['nextLineSetSpacingShowText']
      ].filter((value): value is number => typeof value === 'number')
    );

    const setFillRgb = ops['setFillRGBColor'];
    const setFillGray = ops['setFillGray'];
    const setFillCmyk = ops['setFillCMYKColor'];
    const setFillColor = ops['setFillColor'];
    const setFillColorN = ops['setFillColorN'];

    let current = '#000000';
    const colors: string[] = [];

    const clamp01 = (value: number): number =>
      Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

    const byte = (value: number): number =>
      Math.round(clamp01(value) * 255);

    const rgb = (r: number, g: number, b: number): string =>
      `#${[r, g, b].map(byteValue => byte(byteValue).toString(16).padStart(2, '0')).join('')}`;

    const gray = (value: number): string => rgb(value, value, value);

    const cmyk = (c: number, m: number, y: number, k: number): string => {
      const cc = clamp01(c);
      const mm = clamp01(m);
      const yy = clamp01(y);
      const kk = clamp01(k);
      return rgb(
        1 - Math.min(1, cc + kk),
        1 - Math.min(1, mm + kk),
        1 - Math.min(1, yy + kk),
      );
    };

    const numericArgs = (args: unknown): number[] => {
      if (!Array.isArray(args)) return [];
      return args.map(value => Number(value)).filter(Number.isFinite);
    };

    for (let index = 0; index < operatorList.fnArray.length; index++) {
      const fn = operatorList.fnArray[index];
      const args = operatorList.argsArray[index];
      const values = numericArgs(args);

      if (fn === setFillRgb && values.length >= 3) {
        current = rgb(values[0], values[1], values[2]);
      } else if (fn === setFillGray && values.length >= 1) {
        current = gray(values[0]);
      } else if (fn === setFillCmyk && values.length >= 4) {
        current = cmyk(values[0], values[1], values[2], values[3]);
      } else if ((fn === setFillColor || fn === setFillColorN) && values.length >= 1) {
        if (values.length >= 4) {
          current = cmyk(values[0], values[1], values[2], values[3]);
        } else if (values.length >= 3) {
          current = rgb(values[0], values[1], values[2]);
        } else {
          current = gray(values[0]);
        }
      }

      if (showOps.has(fn)) {
        colors.push(current);
      }
    }

    return colors;
  }

  /**
   * Phase 5C — reconstruct best-effort image bounds from PDF graphics-state
   * transforms. This is intentionally conservative: unsupported operator
   * patterns simply produce no candidate rather than a wrong clickable image.
   */
  private async extractImageBlocks(page: PDFPageProxy, pageWidth: number, pageHeight: number): Promise<PdfExistingImageBlock[]> {
    try {
      const [operatorList, pdfjs] = await Promise.all([page.getOperatorList(), import('pdfjs-dist')]);
      const ops = pdfjs.OPS as unknown as Record<string, number>;
      const paintOps = new Set([ops['paintImageXObject'], ops['paintJpegXObject'], ops['paintInlineImageXObject']].filter((v): v is number => typeof v === 'number'));
      const transformOp = ops['transform'];
      const saveOp = ops['save'];
      const restoreOp = ops['restore'];
      type Matrix = [number, number, number, number, number, number];
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      const stack: Matrix[] = [];
      const multiply = (m: Matrix, n: Matrix): Matrix => [m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]];
      const blocks: PdfExistingImageBlock[] = [];
      for (let i = 0; i < operatorList.fnArray.length; i++) {
        const fn = operatorList.fnArray[i];
        const args = operatorList.argsArray[i] as unknown[] | undefined;
        if (fn === saveOp) { stack.push([...ctm] as Matrix); continue; }
        if (fn === restoreOp) { ctm = stack.pop() ?? ctm; continue; }
        if (fn === transformOp && args && args.length >= 6) { ctm = multiply(ctm, [Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]), Number(args[4]), Number(args[5])]); continue; }
        if (!paintOps.has(fn)) continue;
        const sx = Math.hypot(ctm[0], ctm[1]);
        const sy = Math.hypot(ctm[2], ctm[3]);
        if (!(sx > 0 && sy > 0)) continue;
        const x = Math.min(1, Math.max(0, ctm[4] / pageWidth));
        const y = Math.min(1, Math.max(0, 1 - (ctm[5] + sy) / pageHeight));
        blocks.push({ id: `pdf-image-${page.pageNumber}-${blocks.length}`, pageNumber: page.pageNumber, x, y, width: Math.min(1, sx / pageWidth), height: Math.min(1, sy / pageHeight), sourceName: typeof args?.[0] === 'string' ? args[0] : null, rotation: Math.atan2(ctm[1], ctm[0]) * 180 / Math.PI, confidence: 'medium' });
      }
      return blocks;
    } catch { return []; }
  }

  /**
   * Return PDF.js's actual loaded font-face name for an extracted PDF font.
   *
   * PDF.js intentionally converts/loads embedded fonts under an internal
   * loadedName (for example g_d0_f12). That name is the font-family used by
   * the PDF.js renderer itself. Reusing it for the Studio overlay prevents
   * the browser from silently substituting Arial/Times/Courier while editing.
   */
  private resolveLoadedFont(
    page: PDFPageProxy,
    fontName: string
  ): {
    loadedName: string | null;
    familyName: string | null;
    weight: 400 | 700 | 900;
    italic: boolean;
    data: Uint8Array | null;
    mimetype: string | null;
  } | null {
    try {
      const commonObjs = page.commonObjs as unknown as {
        get?: (id: string) => unknown;
      };

      const font = commonObjs.get?.(fontName) as {
        loadedName?: unknown;
        name?: unknown;
        bold?: unknown;
        black?: unknown;
        italic?: unknown;
        fontWeight?: unknown;
        weight?: unknown;
        data?: unknown;
        mimetype?: unknown;
      } | undefined;

      if (!font) {
        return null;
      }

      const loadedName =
        typeof font.loadedName === 'string'
          ? font.loadedName.trim()
          : '';

      const familyName = this.normalizeEmbeddedFontFamily(
        typeof font.name === 'string' ? font.name : null
      );

      const fontIdentity = `${typeof font.name === 'string' ? font.name : ''} ${loadedName}`;
      const weight: 400 | 700 | 900 =
        font.black === true || /\b(black|heavy)\b/i.test(fontIdentity)
          ? 900
          : font.bold === true || /\b(bold|semibold|demibold)\b/i.test(fontIdentity)
            ? 700
            : this.normalizeFontWeight(
                font.fontWeight ??
                font.weight
              ) as 400 | 700 | 900;

      return {
        loadedName: loadedName || null,
        familyName,
        weight,
        italic:
          font.italic === true || /\b(italic|oblique)\b/i.test(fontIdentity),
        data: this.toUint8Array(font.data),
        mimetype:
          typeof font.mimetype === 'string'
            ? font.mimetype
            : null
      };
    } catch {
      return null;
    }
  }

  /**
   * Ensure the exact OpenType program that PDF.js uses for a source text run
   * is also available to the Studio HTML editor. PDF.js normally registers
   * this face for its own canvas renderer, but relying on that implementation
   * detail is fragile when a separate textarea/span is used for editing.
   *
   * This is the key source-font bridge: the editor is not asked to guess Arial
   * or Helvetica from the PDF metadata. It receives the same converted font
   * program PDF.js renders.
   */
  private ensureBrowserSourceFontFace(
    documentId: string,
    pageNumber: number,
    fontName: string,
    loadedName: string,
    data: Uint8Array | null,
    mimetype: string | null,
    weight: 400 | 700 | 900,
    italic: boolean,
  ): Promise<string | null> {
    if (typeof document === 'undefined') {
      return Promise.resolve(loadedName);
    }

    /*
     * IMPORTANT: do not use the PDF.js loadedName itself as the editor's
     * browser family. On Windows/macOS the same name (for example
     * "Calibri") may already resolve to the OS-installed font. That makes
     * document.fonts.check() return true and silently bypasses the embedded
     * PDF font program. The result looks close, but glyph widths, kerning and
     * outlines can still differ — exactly the failure mode we are fixing.
     *
     * When PDF.js gives us the converted OpenType bytes, always register them
     * under a private, collision-free alias and use that alias in the editor.
     * Only fall back to loadedName when there is genuinely no font program to
     * register.
     */
    const familyToken = `${documentId}:${fontName}:${loadedName}:${weight}:${italic ? 'i' : 'n'}`;
    const key = familyToken;
    const existing = this.sourceFontFaces.get(key);
    if (existing) return existing;

    const task = (async () => {
      try {
        const originalFamily = loadedName.trim();
        if (!originalFamily) return null;

        if (data && data.byteLength > 0 && typeof FontFace !== 'undefined') {
          const safeToken = familyToken
            .replace(/[^a-zA-Z0-9_-]+/g, '_')
            .slice(0, 180);
          const family = `SafePDFHubPdfFont_${safeToken}`;
          const buffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          );
          const face = new FontFace(
            family,
            buffer as ArrayBuffer,
            {
              style: italic ? 'italic' : 'normal',
              weight: String(weight),
              ...(mimetype ? { display: 'block' as const } : {}),
            },
          );

          // Load the actual PDF.js-converted font program before exposing it
          // to the editor. This prevents a transient fallback during the first
          // keystroke from changing the measured/replaced glyphs.
          await face.load();
          const fontSet = document.fonts as FontFaceSet & { add: (font: FontFace) => FontFaceSet };
          fontSet.add(face);
          await document.fonts.ready;

          if (document.fonts.check(`${italic ? 'italic ' : ''}${weight} 12px \"${family}\"`)) {
            return family;
          }

          // The FontFace loaded successfully even if check() is unavailable or
          // unusually strict in a browser implementation. The family remains
          // the exact registered PDF font, so it is still the best result.
          return family;
        }

        // No font bytes were exposed by PDF.js. In this rare fallback case use
        // its own loaded family rather than inventing a generic font.
        await document.fonts.ready;
        return originalFamily;
      } catch {
        // If direct FontFace registration fails for an unusual PDF font format,
        // keep PDF.js's own family as the fallback instead of replacing it with
        // Arial/Helvetica/etc. Export still uses the embedded source bytes.
        return loadedName || null;
      }
    })();

    this.sourceFontFaces.set(key, task);
    return task;
  }

  private toUint8Array(value: unknown): Uint8Array | null {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }
    return null;
  }

  private patchStatus(
    status: PdfDocumentContentAnalysis['status'],
    error: string | null
  ): void {
    const current = this.analysisState();
    if (current) this.analysisState.set({ ...current, status, error });
  }


  /**
   * Recover the human-readable family from PDF.js's actual FontInfo.name.
   * PDF.js may expose a generic TextStyle.fontFamily such as `sans-serif`,
   * while FontInfo.name still contains the embedded face name, e.g.
   * `Calibri-Bold`. This value is display metadata only; the live editor uses
   * sourceFontCssFamily for the exact loaded PDF font face.
   */
  private normalizeEmbeddedFontFamily(value: string | null): string | null {
    const clean = String(value ?? '')
      .replace(/^\/?[A-Z]{6}\+/, '')
      .replace(/^g_[a-z0-9_]+_f\d+$/i, '')
      .replace(/["']/g, '')
      .trim();

    if (!clean) return null;

    const family = clean
      .replace(/[-_, ]+(bold|black|heavy|semibold|demibold|medium|regular|roman|italic|oblique|light|thin)$/i, '')
      .trim();

    return family || clean;
  }

  private normalizeFontWeight(value: unknown): 400 | 700 | 900 {
    if (typeof value === 'number') {
      if (value >= 800) return 900;
      if (value >= 600) return 700;
      return 400;
    }

    const text = String(value ?? '');
    if (/black|heavy|900/i.test(text)) return 900;
    return /bold|[6-8]00/i.test(text) ? 700 : 400;
  }

  private isTextItem(value: unknown): value is {
    str: string;
    transform: readonly [number, number, number, number, number, number];
    width: number;
    height: number;
    fontName?: string;
  } {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return typeof item['str'] === 'string' && Array.isArray(item['transform']) && item['transform'].length === 6;
  }
}
