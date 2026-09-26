import { FormsModule } from '@angular/forms';

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';

import { StudioFacade } from '../../facade/studio.facade';
import { StudioObjectService } from '../../services/studio-object.service';
import { WatermarkControlsComponent } from '../../../tools/watermark/watermark-controls.component';
import { StudioWatermarkStateService } from '../../state/studio-watermark-state.service';
import type { PdfWatermarkRequest } from '../../../../core/watermark/pdf-watermark.types';
import type {
  StudioObject,
  StudioObjectBounds,
  StudioTextAlign,
  StudioTextFontStyle,
  StudioTextFontWeight,
  StudioTextFontFamily
} from '../../models/studio-selection.model';

type PropertiesTab = 'document' | 'page' | 'selection';

type PdfImageFidelityValidation = {
  score: number;
  status: 'Validated' | 'Review recommended' | 'High risk';
  metrics: {
    seamDiscontinuity: number;
    textureMismatch: number;
    gradientMismatch: number;
    seamCoverage: number;
  };
  findings: { level: 'pass' | 'warn' | 'error'; message: string }[];
};

@Component({
  selector: 'app-studio-right-sidebar',
  standalone: true,
  imports: [FormsModule, WatermarkControlsComponent],
  templateUrl: './studio-right-sidebar.html',
  styleUrl: './studio-right-sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudioRightSidebar {

  readonly facade = inject(StudioFacade);
  private readonly objectService = inject(StudioObjectService);
  readonly watermark = inject(StudioWatermarkStateService);

  readonly activeTab = signal<PropertiesTab>('document');

  readonly document = this.facade.document;
  readonly hasDocument = this.facade.hasDocument;
  readonly currentPage = this.facade.currentPage;
  readonly pageCount = this.facade.pageCount;
  readonly pages = this.facade.pages;
  readonly selection = this.facade.selection;
  readonly contentAnalysisState = this.facade.contentAnalysisState;

  /** Guards against stale asynchronous image reads replacing a newly selected object. */
  private imageReplacementVersion = 0;
  private fidelityValidationVersion = 0;

  /** Phase 5C.7 — pixel/content-aware validation of reconstruction continuity. */
  readonly selectedPdfImageFidelityValidation = signal<PdfImageFidelityValidation | null>(null);

  /**
   * Normalized text-style view used by the template. This keeps the inspector
   * compatible with older objects that were created before fontFamily existed.
   */
  /** Human-readable source typography for an existing PDF text run. */
  pdfSourceFontSizePt(object: StudioObject | null): string {
    const size = object?.pdfText?.fontSizePdf;
    return typeof size === 'number' && Number.isFinite(size) && size > 0
      ? size.toFixed(2)
      : '—';
  }

  pdfSourceFontWeightLabel(object: StudioObject | null): string {
    const weight = object?.pdfText?.sourceFontWeight ?? 400;
    return weight === 900 ? 'Black (900)' : weight === 700 ? 'Bold (700)' : 'Regular (400)';
  }

  pdfSourceFontStyleLabel(object: StudioObject | null): string {
    return object?.pdfText?.sourceFontStyle === 'italic' ? 'Italic' : 'Normal';
  }

  pdfSourceLineHeight(object: StudioObject | null): string {
    const source = object?.pdfText;
    const fontSizePdf = source?.fontSizePdf;
    const lineHeightPdf = source?.lineHeightPdf;

    if (
      typeof fontSizePdf !== 'number' ||
      !Number.isFinite(fontSizePdf) ||
      fontSizePdf <= 0 ||
      typeof lineHeightPdf !== 'number' ||
      !Number.isFinite(lineHeightPdf) ||
      lineHeightPdf <= 0
    ) {
      return '1.00';
    }

    return (lineHeightPdf / fontSizePdf).toFixed(2);
  }

  readonly selectedTextStyle = computed(() => {
    const object = this.selectedObject();
    if (object?.type !== 'text') {
      return null;
    }

    const pdfText = object.pdfText;
    const sourceSize = pdfText?.fontSizePdf;
    const sourceLineHeight =
      typeof pdfText?.fontSizePdf === 'number' &&
      pdfText.fontSizePdf > 0 &&
      typeof pdfText.lineHeightPdf === 'number' &&
      pdfText.lineHeightPdf > 0
        ? pdfText.lineHeightPdf / pdfText.fontSizePdf
        : null;

    return {
      fontFamily: object.pdfText?.sourceFontFamily ?? object.textStyle?.fontFamily ?? 'Helvetica',
      fontSize: object.pdfText?.detectedFontSize ?? object.textStyle?.fontSize ?? 0,
      sourceFontSizePt: typeof sourceSize === 'number' && Number.isFinite(sourceSize) ? sourceSize : null,
      fontWeight: object.pdfText?.sourceFontWeight ?? object.textStyle?.fontWeight ?? 400,
      fontStyle: object.pdfText?.sourceFontStyle ?? object.textStyle?.fontStyle ?? 'normal',
      textAlign: object.textStyle?.textAlign ?? 'left',
      lineHeight: sourceLineHeight && Number.isFinite(sourceLineHeight) ? sourceLineHeight : (object.textStyle?.lineHeight ?? 1.2),
      letterSpacing: object.textStyle?.letterSpacing ?? 0,
      color: object.textStyle?.color ?? '#101820'
    };
  });

  readonly selectedObject = computed<StudioObject | null>(() => {
    const selection = this.selection();
    if (!selection) {
      return null;
    }

    this.objectService.changes();

    return this.objectService.get(selection.objectId) ?? null;
  });

  /**
   * Narrow the generic StudioObject union before the template reads the
   * signature-specific payload. Angular template type checking does not
   * retain the narrowing from a sibling @if expression across separate
   * selectedObject() calls, so exposing the narrowed view here keeps the
   * inspector type-safe and avoids $any casts in the template.
   */
  readonly selectedSignatureObject = computed(() => {
    const object = this.selectedObject();
    return object?.type === 'signature' ? object : null;
  });

  /**
   * Template-safe signature inspector values. Keeping these as dedicated
   * computed signals avoids Angular's strict-template diagnostics around
   * optional chaining followed by non-nullable properties.
   */
  readonly selectedSignatureKind = computed<'signature' | 'initials' | 'text' | 'date' | 'checkbox' | null>(() =>
    this.selectedSignatureObject()?.signing.kind ?? null
  );

  readonly selectedSignatureAssetSource = computed<'drawn' | 'typed' | 'uploaded' | null>(() => {
    const object = this.selectedSignatureObject();
    return this.resolveSigningAsset(object)?.source ?? null;
  });

  readonly selectedSignatureAssetWidth = computed<number>(() => {
    const object = this.selectedSignatureObject();
    return this.resolveSigningAsset(object)?.naturalWidth ?? 0;
  });

  readonly selectedSignatureAssetHeight = computed<number>(() => {
    const object = this.selectedSignatureObject();
    return this.resolveSigningAsset(object)?.naturalHeight ?? 0;
  });

  readonly selectedSignatureOpacity = computed<number>(() =>
    this.selectedSignatureObject()?.signing.opacity ?? 1
  );

  readonly signingFontOptions = [
    { label: 'Inter', value: 'Inter, Arial, sans-serif' },
    { label: 'Elegant', value: "'Segoe Script', 'Brush Script MT', cursive" },
    { label: 'Brush', value: "'Brush Script MT', 'Segoe Script', cursive" },
    { label: 'Handwritten', value: "'Segoe Print', 'Comic Sans MS', cursive" },
    { label: 'Serif', value: "Georgia, 'Times New Roman', serif" },
  ] as const;

  readonly selectedSigningValue = computed<string>(() => this.selectedSignatureObject()?.signing.value ?? '');
  readonly selectedSigningFontFamily = computed<string>(() => {
    const value = this.selectedSignatureObject()?.signing.fontFamily;
    if (!value) return this.signingFontOptions[0].value;
    // Normalize legacy/default values that predate the current option list.
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.includes('Segoe Script') && normalized.includes('Segoe Print')) {
      return this.signingFontOptions[1].value;
    }
    return this.signingFontOptions.some(option => option.value === value) ? value : this.signingFontOptions[0].value;
  });
  readonly selectedSigningFontSize = computed<number>(() => this.selectedSignatureObject()?.signing.fontSize ?? 16);
  readonly selectedSigningFontStyle = computed<'normal' | 'italic'>(() => this.selectedSignatureObject()?.signing.fontStyle ?? 'normal');
  readonly selectedSigningColor = computed<string>(() => this.selectedSignatureObject()?.signing.color ?? '#121923');
  readonly selectedSigningChecked = computed<boolean>(() => this.selectedSignatureObject()?.signing.checked ?? true);

  resolveSigningAsset(object: StudioObject | null): import('../../../../core/signing/models/signing.models').SigningAsset | null {
    if (object?.type !== 'signature') return null;
    return object.signing.asset ?? null;
  }
  readonly signingColors = ['#121923', '#0f766e', '#2563eb', '#7c3aed', '#be185d', '#b45309', '#000000'] as const;

  readonly signingPagesDialogOpen = signal(false);
  signingPagesText = '';
  signingBulkScope: 'current' | 'all' | 'range' | 'specific' = 'current';
  signingBulkFrom = 1;
  signingBulkTo = 1;
  signingBulkPosition: 'same' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' = 'same';

  private readonly fidelityValidationEffect = effect(() => {
    const object = this.selectedObject();
    const source = object?.type === 'image' ? object.pdfImage : null;
    const key = object && source
      ? [object.id, object.image?.dataUrl ?? '', source.backgroundMode ?? 'auto', source.pixelReconstructionDataUrl ?? '', source.layeredReconstructionDataUrl ?? '', source.seamBlendDataUrl ?? '', source.seamBlendWidth ?? 0].join('|')
      : '';
    if (!key || !object || object.type !== 'image' || !object.pdfImage || !object.image) {
      this.selectedPdfImageFidelityValidation.set(null);
      return;
    }
    const version = ++this.fidelityValidationVersion;
    void this.validatePdfImageReconstruction(object.id, version);
  });


  readonly currentPageContentAnalysis = computed(() =>
    this.contentAnalysisState()?.pages[this.currentPage()] ?? null
  );

  readonly currentPageTextBlockCount = computed(() =>
    this.currentPageContentAnalysis()?.textBlocks.length ?? 0
  );

  readonly currentPageImagePaintCount = computed(() =>
    this.currentPageContentAnalysis()?.imagePaintCount ?? 0
  );

  readonly currentLogicalPage = computed(() => {
    const page = this.currentPage();
    return this.pages()[page - 1] ?? null;
  });

  /**
   * Keep nullable page-model access out of the template. The inspector can
   * briefly render while document state is transitioning, so the Page tab
   * always exposes safe display values instead of relying on unsafe `!`.
   */
  readonly currentPageRotation = computed(() =>
    this.currentLogicalPage()?.rotation ?? 0
  );

  readonly currentPageSource = computed(() =>
    this.currentLogicalPage()?.kind === 'blank'
      ? 'Studio blank page'
      : 'Original PDF'
  );

  /**
   * Phase 5C.3 — pre-export fidelity audit for the selected existing PDF image.
   * This is intentionally deterministic and local: it checks replacement
   * readiness, source-detection confidence, aspect stress and likely
   * downsampling pressure before the PDF is exported.
   */
  readonly selectedPdfImageAudit = computed(() => {
    const object = this.selectedObject();
    if (object?.type !== 'image' || !object.pdfImage) {
      return null;
    }

    const issues: { level: 'pass' | 'warn' | 'error'; message: string }[] = [];
    const replacement = object.image;
    const fitMode = object.pdfImage.fitMode ?? 'fit';

    if (!object.pdfImage.replaced || !replacement) {
      issues.push({ level: 'error', message: 'No replacement image is currently committed.' });
      return { score: 0, status: 'Not ready', issues };
    }

    if (object.pdfImage.confidence === 'low') {
      issues.push({ level: 'warn', message: 'Source detection confidence is low; verify the selected region before export.' });
    } else if (object.pdfImage.confidence === 'medium') {
      issues.push({ level: 'warn', message: 'Source detection confidence is medium; inspect the exported result at 100% zoom.' });
    } else {
      issues.push({ level: 'pass', message: 'High-confidence source region detected.' });
    }

    const targetRatio = Math.max(0.0001, object.bounds.width / object.bounds.height);
    const sourceRatio = Math.max(0.0001, replacement.aspectRatio);
    const ratioDelta = Math.abs(Math.log(sourceRatio / targetRatio));

    if (fitMode === 'stretch' && ratioDelta > 0.08) {
      issues.push({ level: 'warn', message: 'Stretch mode will visibly distort this replacement because its aspect ratio differs from the source region.' });
    } else if (fitMode === 'fill' && ratioDelta > 0.08) {
      issues.push({ level: 'warn', message: 'Fill mode will crop part of the replacement to protect the surrounding PDF content.' });
    } else if (fitMode === 'fit' && ratioDelta > 0.08) {
      issues.push({ level: 'warn', message: 'Fit mode will preserve the replacement aspect ratio but may leave uncovered margins inside the source region.' });
    } else {
      issues.push({ level: 'pass', message: 'Replacement aspect ratio is closely matched to the source region.' });
    }

    const longSide = Math.max(replacement.naturalWidth, replacement.naturalHeight);
    if (longSide < 900) {
      issues.push({ level: 'warn', message: 'Replacement resolution is relatively low. Check for softness after export and at print zoom.' });
    } else if (longSide >= 1800) {
      issues.push({ level: 'pass', message: 'Replacement resolution is suitable for a high-detail export in most document layouts.' });
    } else {
      issues.push({ level: 'pass', message: 'Replacement resolution is adequate for typical document viewing.' });
    }

    if (fitMode === 'fit') {
      const mode = object.pdfImage.backgroundMode ?? 'auto';
      if (mode === 'white' && ratioDelta > 0.08) {
        issues.push({ level: 'warn', message: 'White reconstruction will expose artificial margins when the replacement does not fully fill the original image box.' });
      } else if (mode === 'layered') {
        const confidence = object.pdfImage.seamBlendConfidence ?? 'low';
        const ready = !!object.pdfImage.layeredReconstructionDataUrl && !!object.pdfImage.seamBlendDataUrl;
        issues.push({
          level: ready && confidence !== 'low' ? 'pass' : 'warn',
          message: !ready
            ? 'Multi-layer reconstruction is selected but its base or seam layer is missing; regenerate before export.'
            : confidence === 'low'
              ? 'Multi-layer reconstruction is ready, but complex texture continuity should be inspected at 100% zoom.'
              : 'Source-aware base reconstruction and directional seam blending are ready for export.'
        });
      } else if (mode === 'pixel') {
        const confidence = object.pdfImage.pixelReconstructionConfidence ?? 'low';
        const hasRaster = !!object.pdfImage.pixelReconstructionDataUrl;
        issues.push({
          level: !hasRaster || confidence === 'low' ? 'warn' : 'pass',
          message: !hasRaster
            ? 'Pixel reconstruction is selected but no reconstruction raster is available; edge-aware colour fallback will be used.'
            : confidence === 'low'
              ? 'Pixel-level reconstruction is approximate; inspect seams around photographic or irregular borders.'
              : 'Pixel-level edge reconstruction is ready for fit-mode margins and preserves edge variation beyond a single solid colour.'
        });
      } else if (mode === 'auto') {
        const confidence = object.pdfImage.backgroundConfidence ?? 'low';
        issues.push({ level: confidence === 'low' ? 'warn' : 'pass', message: confidence === 'low' ? 'Edge reconstruction is approximate; review textured or photographic borders.' : 'Edge-aware background reconstruction is available for fit-mode margins.' });
      } else {
        issues.push({ level: 'pass', message: 'A custom background reconstruction colour will be used behind fit-mode margins.' });
      }
    }

    const errors = issues.filter(issue => issue.level === 'error').length;
    const warnings = issues.filter(issue => issue.level === 'warn').length;
    const score = Math.max(0, Math.min(100, 100 - errors * 60 - warnings * 15));

    return {
      score,
      status: errors ? 'Blocked' : warnings ? 'Review recommended' : 'Export ready',
      issues
    };
  });


  readonly selectionLabel = computed(() => {
    const object = this.selectedObject();
    if (!object) {
      return 'Nothing selected';
    }

    return ({
      text: 'Text',
      image: 'Image',
      shape: 'Shape',
      draw: 'Drawing',
      highlight: 'Highlight',
      comment: 'Comment',
      link: 'Link',
      signature: 'Signature'
    } as Record<string, string>)[object.type] ?? 'Selection';
  });

  updateWatermark(request: PdfWatermarkRequest): void {
    this.watermark.updateDraft(request);
  }

  applyWatermark(request: PdfWatermarkRequest): void {
    // Add/Update is a normal Studio mutation and therefore enters the shared
    // Undo/Redo timeline through the Facade.
    this.facade.commitWatermark(request);
  }

  removeWatermark(): void {
    if (this.watermark.busy() || !this.watermark.committed()) return;

    // Removal is also a committed Studio mutation, not an inspector-only
    // state change. The Facade records it in the same history timeline.
    this.facade.removeWatermark();
  }

  closeWatermark(): void {
    this.watermark.close();
  }

  constructor() {
    /**
     * The inspector follows the user's primary editing intent: when an object
     * is selected on the canvas, immediately reveal the Selection tab.
     * Clearing a selection deliberately keeps the current tab unchanged.
     */
    effect(() => {
      if (this.selection()) {
        this.activeTab.set('selection');
      }
    });
  }

  setTab(tab: PropertiesTab): void {
    this.activeTab.set(tab);
  }

  formatFileSize(bytes: number | undefined): string {
    if (!bytes || bytes < 1) {
      return '—';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }

    const decimals = unit === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(decimals)} ${units[unit]}`;
  }


  updateLinkKind(value: 'url' | 'page'): void {
    const object = this.selectedObject();
    if (object?.type === 'link') this.facade.updateLink(object.id, { kind: value });
  }

  updateLinkUrl(value: string): void {
    const object = this.selectedObject();
    if (object?.type === 'link') this.facade.updateLink(object.id, { url: value });
  }

  updateLinkTargetPage(value: string): void {
    const object = this.selectedObject();
    const page = Number(value);
    if (object?.type === 'link' && Number.isFinite(page)) {
      this.facade.updateLink(object.id, { targetPage: Math.max(1, Math.min(this.pageCount(), Math.floor(page))) });
    }
  }

  updatePdfImageFitMode(value: 'fit' | 'fill' | 'stretch'): void {
    const object = this.selectedObject();
    if (object?.type === 'image' && object.pdfImage) {
      this.facade.updatePdfImageFitMode(object.id, value);
    }
  }

  restoreOriginalPdfImage(): void {
    const object = this.selectedObject();
    if (object?.type === 'image' && object.pdfImage) {
      this.facade.restoreOriginalPdfImage(object.id);
    }
  }

  updatePdfImageBackgroundMode(value: 'auto' | 'solid' | 'white' | 'pixel' | 'layered'): void {
    const object = this.selectedObject();
    if (object?.type === 'image' && object.pdfImage) {
      this.facade.updatePdfImageBackground(object.id, { backgroundMode: value });
    }
  }

  updatePdfImageBackgroundColor(value: string): void {
    const object = this.selectedObject();
    if (object?.type === 'image' && object.pdfImage) {
      this.facade.updatePdfImageBackground(object.id, { backgroundColor: value, backgroundMode: 'solid' });
    }
  }

  async regeneratePdfImagePixelReconstruction(): Promise<void> {
    const object = this.selectedObject();
    if (object?.type !== 'image' || !object.pdfImage || !object.image) return;
    const reconstruction = await this.buildPixelReconstruction(
      object.image.dataUrl,
      Math.max(0.0001, object.bounds.width / object.bounds.height)
    );
    if (!reconstruction) return;
    const current = this.selectedObject();
    if (current?.id !== object.id || current.type !== 'image' || !current.pdfImage) return;
    this.facade.updatePdfImageBackground(object.id, {
      backgroundMode: 'pixel',
      pixelReconstructionDataUrl: reconstruction.dataUrl,
      pixelReconstructionConfidence: reconstruction.confidence
    });
  }


  async regeneratePdfImageLayeredReconstruction(): Promise<void> {
    const object = this.selectedObject();
    if (object?.type !== 'image' || !object.pdfImage || !object.image) return;
    const reconstruction = await this.buildLayeredReconstruction(
      object.image.dataUrl,
      Math.max(0.0001, object.bounds.width / object.bounds.height),
      object.pdfImage.seamBlendWidth ?? 8
    );
    if (!reconstruction) return;
    const current = this.selectedObject();
    if (current?.id !== object.id || current.type !== 'image' || !current.pdfImage) return;
    this.facade.updatePdfImageBackground(object.id, {
      backgroundMode: 'layered',
      layeredReconstructionDataUrl: reconstruction.baseDataUrl,
      seamBlendDataUrl: reconstruction.seamDataUrl,
      seamBlendWidth: reconstruction.seamWidth,
      seamBlendConfidence: reconstruction.confidence
    });
  }

  updatePdfImageSeamBlendWidth(value: number): void {
    const object = this.selectedObject();
    if (object?.type !== 'image' || !object.pdfImage) return;
    const seamBlendWidth = Math.max(2, Math.min(24, Math.round(value || 8)));
    this.facade.updatePdfImageBackground(object.id, { seamBlendWidth });
    void this.regeneratePdfImageLayeredReconstruction();
  }

  async refreshPdfImageFidelityValidation(): Promise<void> {
    const object = this.selectedObject();
    if (object?.type !== 'image' || !object.pdfImage || !object.image) return;
    const version = ++this.fidelityValidationVersion;
    await this.validatePdfImageReconstruction(object.id, version);
  }

  private async validatePdfImageReconstruction(objectId: string, version: number): Promise<void> {
    const object = this.selectedObject();
    if (object?.id !== objectId || object.type !== 'image' || !object.pdfImage || !object.image) return;
    const mode = object.pdfImage.backgroundMode ?? 'auto';
    const findings: PdfImageFidelityValidation['findings'] = [];
    let seamDiscontinuity = 0;
    let textureMismatch = 0;
    let gradientMismatch = 0;
    let seamCoverage = 0;

    const replacement = await this.readValidationImage(object.image.dataUrl);
    if (!replacement || version !== this.fidelityValidationVersion) return;

    const rasterUrl = mode === 'layered'
      ? object.pdfImage.layeredReconstructionDataUrl
      : mode === 'pixel'
        ? object.pdfImage.pixelReconstructionDataUrl
        : null;
    const reconstruction = rasterUrl ? await this.readValidationImage(rasterUrl) : null;
    const seam = mode === 'layered' && object.pdfImage.seamBlendDataUrl
      ? await this.readValidationImage(object.pdfImage.seamBlendDataUrl)
      : null;
    if (version !== this.fidelityValidationVersion) return;

    const edgeStats = this.measureEdgeStats(replacement);
    if (reconstruction) {
      const reconstructionStats = this.measureEdgeStats(reconstruction);
      seamDiscontinuity = Math.min(100, Math.abs(edgeStats.mean - reconstructionStats.mean) / 2.55);
      textureMismatch = Math.min(100, Math.abs(edgeStats.variation - reconstructionStats.variation) / 2.55);
      gradientMismatch = Math.min(100, Math.abs(edgeStats.gradient - reconstructionStats.gradient) / 2.55);
    } else if (object.pdfImage?.fitMode === 'fit') {
      seamDiscontinuity = 45;
      textureMismatch = 45;
      gradientMismatch = 45;
    }

    if (seam) seamCoverage = this.measureSeamCoverage(seam);
    else if (mode === 'layered') seamCoverage = 0;
    else seamCoverage = reconstruction ? 100 : 65;

    if (mode === 'layered' && !reconstruction) {
      findings.push({ level: 'error', message: 'Content-aware validation could not find the multi-layer base reconstruction.' });
    }
    if (mode === 'layered' && !seam) {
      findings.push({ level: 'error', message: 'Content-aware validation could not find the transparent seam layer.' });
    }
    if (seamDiscontinuity <= 12) findings.push({ level: 'pass', message: 'Low edge-colour discontinuity detected across the reconstruction boundary.' });
    else if (seamDiscontinuity <= 28) findings.push({ level: 'warn', message: 'Moderate seam discontinuity detected; inspect the export at 100% zoom.' });
    else findings.push({ level: 'error', message: 'High colour discontinuity detected; the replacement edge may look visibly pasted in.' });

    if (textureMismatch <= 15) findings.push({ level: 'pass', message: 'Edge texture energy is consistent with the reconstruction layer.' });
    else if (textureMismatch <= 32) findings.push({ level: 'warn', message: 'Texture continuity is approximate around the reconstructed margin.' });
    else findings.push({ level: 'error', message: 'Strong texture discontinuity detected; complex source texture may require manual review.' });

    if (gradientMismatch <= 14) findings.push({ level: 'pass', message: 'Directional gradient continuity is within the preferred validation range.' });
    else if (gradientMismatch <= 30) findings.push({ level: 'warn', message: 'Gradient transition is measurable; inspect borders and shadows before export.' });
    else findings.push({ level: 'error', message: 'Gradient mismatch is high and may create a visible transition around the replacement.' });

    if (mode === 'layered') {
      if (seamCoverage >= 92) findings.push({ level: 'pass', message: 'Transparent seam layer covers the expected transition region.' });
      else if (seamCoverage >= 55) findings.push({ level: 'warn', message: 'Seam layer coverage is partial; consider increasing seam blend width and regenerating.' });
      else findings.push({ level: 'error', message: 'Seam layer coverage is insufficient for reliable transition blending.' });
    }

    const errors = findings.filter(item => item.level === 'error').length;
    const warnings = findings.filter(item => item.level === 'warn').length;
    const score = Math.max(0, Math.min(100, Math.round(100 - errors * 28 - warnings * 10 - seamDiscontinuity * .08 - textureMismatch * .05 - gradientMismatch * .05 + Math.min(8, seamCoverage * .08))));
    const status: PdfImageFidelityValidation['status'] = errors ? 'High risk' : warnings ? 'Review recommended' : 'Validated';
    if (version === this.fidelityValidationVersion) {
      this.selectedPdfImageFidelityValidation.set({ score, status, metrics: { seamDiscontinuity, textureMismatch, gradientMismatch, seamCoverage }, findings });
    }
  }

  private readValidationImage(dataUrl: string): Promise<ImageData | null> {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const max = 256;
          const scale = Math.min(1, max / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
          const width = Math.max(32, Math.round((image.naturalWidth || max) * scale));
          const height = Math.max(32, Math.round((image.naturalHeight || max) * scale));
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) { resolve(null); return; }
          context.drawImage(image, 0, 0, width, height);
          resolve(context.getImageData(0, 0, width, height));
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }

  private measureEdgeStats(image: ImageData): { mean: number; variation: number; gradient: number } {
    const { data, width, height } = image;
    const samples: number[] = [];
    let sum = 0, sumSq = 0, gradient = 0, count = 0;
    const lum = (i: number) => data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (x > 2 && x < width - 3 && y > 2 && y < height - 3) continue;
      const i = (y * width + x) * 4;
      if (data[i + 3] < 32) continue;
      const v = lum(i); sum += v; sumSq += v * v; count++;
      if (x + 1 < width) gradient += Math.abs(v - lum((y * width + Math.min(width - 1, x + 1)) * 4));
      if (y + 1 < height) gradient += Math.abs(v - lum((Math.min(height - 1, y + 1) * width + x) * 4));
      samples.push(v);
    }
    const mean = sum / Math.max(1, count);
    return { mean, variation: Math.sqrt(Math.max(0, sumSq / Math.max(1, count) - mean * mean)), gradient: gradient / Math.max(1, samples.length * 2) };
  }

  private measureSeamCoverage(image: ImageData): number {
    let covered = 0, total = 0;
    for (let i = 3; i < image.data.length; i += 4) { total++; if (image.data[i] > 8) covered++; }
    return total ? (covered / total) * 100 : 0;
  }

  useRecommendedPdfImageFit(): void {
    const object = this.selectedObject();
    if (object?.type !== 'image' || !object.pdfImage || !object.image) {
      return;
    }

    const targetRatio = Math.max(0.0001, object.bounds.width / object.bounds.height);
    const sourceRatio = Math.max(0.0001, object.image.aspectRatio);
    const ratioDelta = Math.abs(Math.log(sourceRatio / targetRatio));

    this.updatePdfImageFitMode(
      ratioDelta <= 0.08 ? 'fit' : 'fill'
    );
  }


  updatePdfTextReplacementColor(kind: 'backgroundColor' | 'textColor', value: string): void {
    const object = this.selectedObject();
    if (object?.type === 'text' && object.pdfText) {
      this.facade.updatePdfTextAppearance(object.id, { [kind]: value });
    }
  }

  updatePdfTextFidelity(patch: { coverPadding?: number; fitMode?: 'original' | 'auto' }): void {
    const object = this.selectedObject();
    if (object?.type === 'text' && object.pdfText) {
      this.facade.updatePdfTextAppearance(object.id, patch);
    }
  }

  restoreOriginalPdfText(): void {
    const object = this.selectedObject();
    if (object?.type === 'text' && object.pdfText) {
      this.facade.restoreOriginalPdfText(object.id);
    }
  }

  updateTextContent(value: string): void {
    const object = this.selectedObject();
    if (object?.type === 'text') {
      this.facade.updateTextObject(object.id, value);
    }
  }

  updateTextStyle(
    patch: {
      fontSize?: number;
      fontWeight?: StudioTextFontWeight;
      fontStyle?: StudioTextFontStyle;
      textAlign?: StudioTextAlign;
      fontFamily?: StudioTextFontFamily;
      lineHeight?: number;
      letterSpacing?: number;
      color?: string;
    }
  ): void {
    const object = this.selectedObject();
    if (object?.type === 'text') {
      this.facade.updateTextStyle(object.id, patch);
    }
  }

  updateBoundsValue(
    key: keyof StudioObjectBounds,
    rawValue: string
  ): void {
    const object = this.selectedObject();
    if (!object) {
      return;
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return;
    }

    const normalized = Math.min(100, Math.max(0, value)) / 100;

    const bounds: StudioObjectBounds = {
      ...object.bounds,
      [key]: normalized
    };

    this.facade.updateObjectBounds(object.id, bounds);
  }

  updateSignatureOpacity(value: string): void {
    const object = this.selectedSignatureObject();
    if (!object) return;
    const opacity = Math.max(0.05, Math.min(1, Number(value) / 100));
    this.facade.updateSignatureStyle(object.id, { opacity });
  }

  openSigningPagesDialog(mode: 'apply' | 'remove' = 'apply'): void {
    const object = this.selectedSignatureObject();
    if (!object) return;
    this.signingPagesText = String(object.pageNumber);
    this.signingBulkScope = 'current';
    this.signingBulkFrom = object.pageNumber;
    this.signingBulkTo = object.pageNumber;
    this.signingBulkPosition = 'same';
    this.signingPagesDialogOpen.set(true);
    this.signingBulkMode = mode;
  }

  signingBulkMode: 'apply' | 'remove' = 'apply';

  closeSigningPagesDialog(): void {
    this.signingPagesDialogOpen.set(false);
  }

  async applySigningPages(): Promise<void> {
    const object = this.selectedSignatureObject();
    if (!object) return;
    const pages = this.resolveSigningPages(object.pageNumber);
    if (!pages.length) return;
    const applied = await this.facade.applySigningObjectToPages(object.id, pages, this.signingBulkPosition);
    if (applied) this.signingPagesDialogOpen.set(false);
  }

  removeSigningPages(): void {
    const object = this.selectedSignatureObject();
    if (!object?.signing.bulkGroupId) return;
    const pages = this.resolveSigningPages(object.pageNumber);
    if (!pages.length) return;
    this.facade.removeSigningObjectFromPages(object.id, pages);
    this.signingPagesDialogOpen.set(false);
  }

  private resolveSigningPages(currentPage: number): number[] {
    const max = this.facade.pages().length;
    if (max < 1) return [];

    if (this.signingBulkScope === 'current') {
      return [Math.max(1, Math.min(max, currentPage))];
    }

    if (this.signingBulkScope === 'all') {
      return Array.from({ length: max }, (_, index) => index + 1);
    }

    if (this.signingBulkScope === 'range') {
      const from = Math.max(1, Math.min(max, Math.floor(Number(this.signingBulkFrom) || 1)));
      const to = Math.max(from, Math.min(max, Math.floor(Number(this.signingBulkTo) || from)));
      return Array.from({ length: to - from + 1 }, (_, index) => from + index);
    }

    return this.parseSigningPages(this.signingPagesText);
  }

  private parseSigningPages(value: string): number[] {
    const max = this.facade.pages().length;
    const result = new Set<number>();
    for (const part of value.split(',')) {
      const trimmed = part.trim();
      const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const from = Math.max(1, Math.min(max, Number(range[1])));
        const to = Math.max(from, Math.min(max, Number(range[2])));
        for (let page = from; page <= to; page += 1) result.add(page);
      } else if (/^\d+$/.test(trimmed)) {
        const page = Number(trimmed);
        if (page >= 1 && page <= max) result.add(page);
      }
    }
    return [...result].sort((a, b) => a - b);
  }

  updateSigningValue(value: string): void {
    const object = this.selectedSignatureObject();
    if (!object) return;
    this.facade.updateSigningFieldStyle(object.id, { value }, 'Edit signing text');
  }

  updateSigningFontFamily(value: string): void {
    const object = this.selectedSignatureObject();
    if (!object) return;
    this.facade.updateSigningFieldStyle(object.id, { fontFamily: value }, 'Change signing font');
  }

  updateSigningFontSize(value: string): void {
    const object = this.selectedSignatureObject();
    const fontSize = Number(value);
    if (!object || !Number.isFinite(fontSize)) return;
    this.facade.updateSigningFieldStyle(object.id, { fontSize: Math.max(8, Math.min(96, fontSize)) }, 'Change signing size');
  }

  updateSigningFontStyle(style: 'normal' | 'italic'): void {
    const object = this.selectedSignatureObject();
    if (!object) return;
    this.facade.updateSigningFieldStyle(object.id, { fontStyle: style }, 'Change signing style');
  }

  updateSigningColor(value: string): void {
    const object = this.selectedSignatureObject();
    if (!object) return;
    this.facade.updateSigningFieldStyle(object.id, { color: value }, 'Change signing color');
  }

  updateSigningChecked(checked: boolean): void {
    const object = this.selectedSignatureObject();
    if (!object) return;
    this.facade.updateSigningFieldStyle(object.id, { checked }, 'Change checkbox');
  }

  updateShapeColor(kind: 'stroke' | 'fill', value: string): void {
    const object = this.selectedObject();
    if (object?.type !== 'shape') {
      return;
    }

    this.facade.updateShapeStyle(
      object.id,
      kind === 'stroke'
        ? { strokeColor: value }
        : { fillColor: value }
    );
  }

  updateShapeStrokeWidth(value: string): void {
    const object = this.selectedObject();
    const width = Number(value);

    if (object?.type === 'shape' && Number.isFinite(width)) {
      this.facade.updateShapeStyle(object.id, {
        strokeWidth: this.uiWidthToNormalized(width, 0.03)
      });
    }
  }

  updateShapeOpacity(value: string): void {
    const object = this.selectedObject();
    const opacity = Number(value);

    if (object?.type === 'shape' && Number.isFinite(opacity)) {
      this.facade.updateShapeStyle(object.id, {
        opacity: Math.max(0.05, Math.min(1, opacity / 100))
      });
    }
  }

  updateShapeFillEnabled(enabled: boolean): void {
    const object = this.selectedObject();

    if (object?.type !== 'shape') {
      return;
    }

    this.facade.updateShapeStyle(object.id, {
      fillColor: enabled
        ? (object.shape?.style.fillColor ?? '#00d4b3')
        : null
    });
  }

  updateDrawingColor(value: string): void {
    const object = this.selectedObject();

    if (
      object &&
      (object.type === 'draw' || object.type === 'highlight')
    ) {
      this.facade.updateDrawingStyle(
        object.id,
        { strokeColor: value }
      );
    }
  }

  updateDrawingWidth(value: string): void {
    const object = this.selectedObject();
    const width = Number(value);

    if (
      object &&
      (object.type === 'draw' || object.type === 'highlight') &&
      Number.isFinite(width)
    ) {
      this.facade.updateDrawingStyle(object.id, {
        strokeWidth: this.uiWidthToNormalized(width, 0.05)
      });
    }
  }

  updateDrawingOpacity(value: string): void {
    const object = this.selectedObject();
    const opacity = Number(value);

    if (
      object &&
      (object.type === 'draw' || object.type === 'highlight') &&
      Number.isFinite(opacity)
    ) {
      this.facade.updateDrawingStyle(object.id, {
        opacity: Math.max(0.05, Math.min(1, opacity / 100))
      });
    }
  }


  updateCommentContent(value: string): void {
    const object = this.selectedObject();

    if (object?.type === 'comment') {
      this.facade.updateComment(object.id, value);
    }
  }

  setSelectedCommentResolved(resolved: boolean): void {
    const object = this.selectedObject();

    if (object?.type === 'comment') {
      this.facade.setCommentResolved(object.id, resolved);
    }
  }

  async onImageReplacementSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Reset the native input immediately so the same file can be chosen again.
    input.value = '';

    if (!file) {
      return;
    }

    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      return;
    }

    // Keep replacement images bounded so an accidental very large data URL does
    // not make the in-browser document model unnecessarily heavy.
    if (file.size > 25 * 1024 * 1024) {
      return;
    }

    const object = this.selectedObject();
    if (object?.type !== 'image') {
      return;
    }

    const objectId = object.id;
    const version = ++this.imageReplacementVersion;

    const dataUrl = await this.readFileAsDataUrl(file);
    if (!dataUrl || version !== this.imageReplacementVersion) {
      return;
    }

    const dimensions = await this.readImageDimensions(dataUrl);
    if (!dimensions || version !== this.imageReplacementVersion) {
      return;
    }

    const current = this.objectService.get(objectId);
    if (current?.type !== 'image') {
      return;
    }

    const edgeBackground = await this.sampleImageEdgeBackground(dataUrl);
    if (version !== this.imageReplacementVersion) return;
    const pixelReconstruction = current.pdfImage
      ? await this.buildPixelReconstruction(dataUrl, Math.max(0.0001, current.bounds.width / current.bounds.height))
      : null;
    const layeredReconstruction = current.pdfImage
      ? await this.buildLayeredReconstruction(dataUrl, Math.max(0.0001, current.bounds.width / current.bounds.height), current.pdfImage.seamBlendWidth ?? 8)
      : null;
    if (version !== this.imageReplacementVersion) return;

    this.facade.replaceImageData(objectId, {
      dataUrl,
      mimeType: file.type,
      naturalWidth: dimensions.width,
      naturalHeight: dimensions.height,
      aspectRatio: dimensions.width / dimensions.height
    });

    if (edgeBackground || pixelReconstruction) {
      this.facade.updatePdfImageBackground(objectId, {
        ...(edgeBackground ? { backgroundColor: edgeBackground.color, backgroundConfidence: edgeBackground.confidence } : {}),
        ...(layeredReconstruction ? {
          backgroundMode: 'layered' as const,
          layeredReconstructionDataUrl: layeredReconstruction.baseDataUrl,
          seamBlendDataUrl: layeredReconstruction.seamDataUrl,
          seamBlendWidth: layeredReconstruction.seamWidth,
          seamBlendConfidence: layeredReconstruction.confidence,
          ...(pixelReconstruction ? {
            pixelReconstructionDataUrl: pixelReconstruction.dataUrl,
            pixelReconstructionConfidence: pixelReconstruction.confidence
          } : {})
        } : pixelReconstruction ? {
          backgroundMode: 'pixel' as const,
          pixelReconstructionDataUrl: pixelReconstruction.dataUrl,
          pixelReconstructionConfidence: pixelReconstruction.confidence
        } : { backgroundMode: 'auto' as const })
      });
    }
  }

  /** Phase 5C.5 — build a source-aware raster by extending the nearest edge pixel
   * into uncovered fit-mode margins. Unlike a single solid colour, gradients and
   * textured borders keep their variation along each source edge. */
  private buildPixelReconstruction(
    dataUrl: string,
    targetRatio: number
  ): Promise<{ dataUrl: string; confidence: 'high' | 'medium' | 'low' } | null> {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const maxSide = 512;
          const targetWidth = targetRatio >= 1 ? maxSide : Math.max(96, Math.round(maxSide * targetRatio));
          const targetHeight = targetRatio >= 1 ? Math.max(96, Math.round(maxSide / targetRatio)) : maxSide;
          const sourceCanvas = document.createElement('canvas');
          sourceCanvas.width = 128; sourceCanvas.height = 128;
          const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
          if (!sourceContext) { resolve(null); return; }
          sourceContext.drawImage(image, 0, 0, 128, 128);
          const source = sourceContext.getImageData(0, 0, 128, 128);

          const canvas = document.createElement('canvas');
          canvas.width = targetWidth; canvas.height = targetHeight;
          const context = canvas.getContext('2d');
          if (!context) { resolve(null); return; }
          const output = context.createImageData(targetWidth, targetHeight);
          const sourceRatio = Math.max(0.0001, image.naturalWidth / image.naturalHeight);
          const boxRatio = Math.max(0.0001, targetWidth / targetHeight);
          const fitByWidth = sourceRatio > boxRatio;
          const fittedWidth = fitByWidth ? targetWidth : Math.round(targetHeight * sourceRatio);
          const fittedHeight = fitByWidth ? Math.round(targetWidth / sourceRatio) : targetHeight;
          const offsetX = Math.floor((targetWidth - fittedWidth) / 2);
          const offsetY = Math.floor((targetHeight - fittedHeight) / 2);

          let variation = 0, samples = 0;
          const sample = (sx: number, sy: number) => {
            const x = Math.max(0, Math.min(127, sx));
            const y = Math.max(0, Math.min(127, sy));
            return (y * 128 + x) * 4;
          };
          for (let y = 0; y < targetHeight; y++) {
            for (let x = 0; x < targetWidth; x++) {
              const nx = (x - offsetX) / Math.max(1, fittedWidth - 1);
              const ny = (y - offsetY) / Math.max(1, fittedHeight - 1);
              // Clamp to the source edge: pixels outside the fitted replacement
              // inherit the nearest real edge pixel, preserving edge gradients.
              const sx = Math.round(Math.max(0, Math.min(1, nx)) * 127);
              const sy = Math.round(Math.max(0, Math.min(1, ny)) * 127);
              const si = sample(sx, sy);
              const oi = (y * targetWidth + x) * 4;
              output.data[oi] = source.data[si];
              output.data[oi + 1] = source.data[si + 1];
              output.data[oi + 2] = source.data[si + 2];
              output.data[oi + 3] = source.data[si + 3] || 255;
              if (x === 0 || y === 0 || x === targetWidth - 1 || y === targetHeight - 1) {
                variation += Math.abs(source.data[si] - 128) + Math.abs(source.data[si + 1] - 128) + Math.abs(source.data[si + 2] - 128);
                samples++;
              }
            }
          }
          context.putImageData(output, 0, 0);
          const edgeVariation = variation / Math.max(1, samples * 3);
          resolve({
            dataUrl: canvas.toDataURL('image/png'),
            confidence: edgeVariation > 42 ? 'medium' : edgeVariation > 18 ? 'high' : 'high'
          });
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }

  /** Phase 5C.6 — build a two-layer reconstruction: an opaque directional
   * edge-extension base plus a transparent seam overlay that is composited after
   * the replacement image. This reduces hard boundaries without touching content
   * outside the detected source bounds. */
  private buildLayeredReconstruction(
    dataUrl: string,
    targetRatio: number,
    requestedSeamWidth: number
  ): Promise<{ baseDataUrl: string; seamDataUrl: string; seamWidth: number; confidence: 'high' | 'medium' | 'low' } | null> {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const sourceSize = 192;
          const maxSide = 512;
          const targetWidth = targetRatio >= 1 ? maxSide : Math.max(128, Math.round(maxSide * targetRatio));
          const targetHeight = targetRatio >= 1 ? Math.max(128, Math.round(maxSide / targetRatio)) : maxSide;
          const seamWidth = Math.max(2, Math.min(24, Math.round(requestedSeamWidth)));
          const sourceCanvas = document.createElement('canvas');
          sourceCanvas.width = sourceSize; sourceCanvas.height = sourceSize;
          const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
          if (!sourceContext) { resolve(null); return; }
          sourceContext.drawImage(image, 0, 0, sourceSize, sourceSize);
          const source = sourceContext.getImageData(0, 0, sourceSize, sourceSize);
          const baseCanvas = document.createElement('canvas');
          const seamCanvas = document.createElement('canvas');
          baseCanvas.width = seamCanvas.width = targetWidth;
          baseCanvas.height = seamCanvas.height = targetHeight;
          const baseContext = baseCanvas.getContext('2d');
          const seamContext = seamCanvas.getContext('2d');
          if (!baseContext || !seamContext) { resolve(null); return; }
          const base = baseContext.createImageData(targetWidth, targetHeight);
          const seam = seamContext.createImageData(targetWidth, targetHeight);
          const sourceRatio = Math.max(0.0001, image.naturalWidth / image.naturalHeight);
          const boxRatio = Math.max(0.0001, targetWidth / targetHeight);
          const fitByWidth = sourceRatio > boxRatio;
          const fittedWidth = fitByWidth ? targetWidth : Math.round(targetHeight * sourceRatio);
          const fittedHeight = fitByWidth ? Math.round(targetWidth / sourceRatio) : targetHeight;
          const offsetX = Math.floor((targetWidth - fittedWidth) / 2);
          const offsetY = Math.floor((targetHeight - fittedHeight) / 2);
          let contrast = 0, samples = 0;
          const px = (x: number, y: number) => (Math.max(0, Math.min(sourceSize - 1, y)) * sourceSize + Math.max(0, Math.min(sourceSize - 1, x))) * 4;
          const smooth = (x: number, y: number, axis: 'x' | 'y') => {
            let r=0,g=0,b=0,a=0,n=0;
            for (let d=-2; d<=2; d++) {
              const i = axis === 'x' ? px(x+d,y) : px(x,y+d);
              r += source.data[i]; g += source.data[i+1]; b += source.data[i+2]; a += source.data[i+3]; n++;
            }
            return [r/n,g/n,b/n,a/n];
          };
          for (let y=0; y<targetHeight; y++) for (let x=0; x<targetWidth; x++) {
            const nx = (x-offsetX) / Math.max(1, fittedWidth-1);
            const ny = (y-offsetY) / Math.max(1, fittedHeight-1);
            const insideX = nx >= 0 && nx <= 1, insideY = ny >= 0 && ny <= 1;
            const sx = Math.round(Math.max(0, Math.min(1,nx))*(sourceSize-1));
            const sy = Math.round(Math.max(0, Math.min(1,ny))*(sourceSize-1));
            const axis: 'x'|'y' = (nx < 0 || nx > 1) ? 'y' : 'x';
            const c = smooth(sx, sy, axis);
            const oi=(y*targetWidth+x)*4;
            base.data[oi]=c[0]; base.data[oi+1]=c[1]; base.data[oi+2]=c[2]; base.data[oi+3]=255;
            if (insideX && insideY && (offsetX>0 || offsetY>0)) {
              const left = x-offsetX, right = offsetX+fittedWidth-1-x, top = y-offsetY, bottom = offsetY+fittedHeight-1-y;
              const distances = [offsetX>0 ? left : Infinity, offsetX>0 ? right : Infinity, offsetY>0 ? top : Infinity, offsetY>0 ? bottom : Infinity];
              const d = Math.min(...distances);
              if (d >= 0 && d < seamWidth) {
                const alpha = Math.round(170 * (1 - d / seamWidth));
                seam.data[oi]=c[0]; seam.data[oi+1]=c[1]; seam.data[oi+2]=c[2]; seam.data[oi+3]=alpha;
              }
            }
            if (x===0 || y===0 || x===targetWidth-1 || y===targetHeight-1) {
              contrast += Math.abs(c[0]-128)+Math.abs(c[1]-128)+Math.abs(c[2]-128); samples++;
            }
          }
          baseContext.putImageData(base,0,0); seamContext.putImageData(seam,0,0);
          const edgeContrast = contrast / Math.max(1,samples*3);
          resolve({
            baseDataUrl: baseCanvas.toDataURL('image/png'),
            seamDataUrl: seamCanvas.toDataURL('image/png'),
            seamWidth,
            confidence: edgeContrast > 52 ? 'medium' : 'high'
          });
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }

  private sampleImageEdgeBackground(dataUrl: string): Promise<{ color: string; confidence: 'high' | 'medium' | 'low' } | null> {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const size = 64;
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) { resolve(null); return; }
          context.drawImage(image, 0, 0, size, size);
          const data = context.getImageData(0, 0, size, size).data;
          let r = 0, g = 0, b = 0, count = 0, variation = 0;
          const samples: number[][] = [];
          for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            if (x > 2 && x < size - 3 && y > 2 && y < size - 3) continue;
            const i = (y * size + x) * 4;
            if (data[i + 3] < 32) continue;
            samples.push([data[i], data[i + 1], data[i + 2]]);
            r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
          }
          if (!count) { resolve(null); return; }
          r /= count; g /= count; b /= count;
          for (const sample of samples) variation += Math.abs(sample[0]-r)+Math.abs(sample[1]-g)+Math.abs(sample[2]-b);
          variation /= Math.max(1, samples.length * 3);
          const hex = '#' + [r,g,b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
          resolve({ color: hex, confidence: variation < 18 ? 'high' : variation < 42 ? 'medium' : 'low' });
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }

  private readFileAsDataUrl(file: File): Promise<string | null> {
    return new Promise(resolve => {
      const reader = new FileReader();

      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : null);

      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  private readImageDimensions(
    dataUrl: string
  ): Promise<{ width: number; height: number } | null> {
    return new Promise(resolve => {
      const image = new Image();

      image.onload = () => {
        const width = image.naturalWidth;
        const height = image.naturalHeight;

        resolve(
          width > 0 && height > 0
            ? { width, height }
            : null
        );
      };

      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }

  duplicateSelectedObject(): void {
    this.facade.duplicateSelectedObject();
  }

  deleteSelectedObject(): void {
    this.facade.deleteSelectedObject();
  }

  clearSelection(): void {
    this.facade.clearSelection();
  }

  styleWidthToUi(value: number | undefined, maxNormalized: number, maxUi = 48): number {
    const normalized = Math.max(0.001, Math.min(maxNormalized, value ?? 0.002));
    const ratio = (normalized - 0.001) / (maxNormalized - 0.001);
    return Math.max(1, Math.min(maxUi, Math.round(1 + ratio * (maxUi - 1))));
  }

  private uiWidthToNormalized(value: number, maxNormalized: number, maxUi = 48): number {
    const ui = Math.max(1, Math.min(maxUi, value));
    const ratio = (ui - 1) / (maxUi - 1);
    return 0.001 + ratio * (maxNormalized - 0.001);
  }

  percent(value: number): string {
    return String(Math.round(value * 1000) / 10);
  }
}
