import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { PdfWatermarkRequest, PdfWatermarkResult } from '../../../../core/watermark/pdf-watermark.types';
import { resolveWatermarkPageSelection, watermarkDisplayCenterToCssTopLeft, watermarkDisplayPositionCenter, watermarkTiledCenters, watermarkTiledScale } from '../../../../core/watermark/pdf-watermark.service';
import { PdfWatermarkPreviewService, type WatermarkPreviewPage } from '../../../../core/watermark/pdf-watermark-preview.service';
import { PdfWatermarkMetricsService, type WatermarkTextMetrics } from '../../../../core/watermark/pdf-watermark-metrics.service';
import { WatermarkControlsComponent } from '../watermark-controls.component';
import { OperationResultComponent } from '../../../../shared/components/operation-result/operation-result.component';

@Component({
  selector: 'app-watermark-workspace',
  standalone: true,
  imports: [CommonModule, WatermarkControlsComponent, OperationResultComponent],
  templateUrl: './watermark-workspace.component.html',
  styleUrl: './watermark-workspace.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WatermarkWorkspaceComponent implements OnChanges, OnDestroy {
  @Input() file: File | null = null;
  @Input() fileName = '';
  @Input() pageCount = 0;
  @Input() fileSize = '';
  @Input() busy = false;
  @Input() progress = 0;
  @Input() errorMessage: string | null = null;
  @Input() result: PdfWatermarkResult | null = null;

  @Output() readonly replaceFile = new EventEmitter<void>();
  @Output() readonly applyWatermark = new EventEmitter<PdfWatermarkRequest>();
  @Output() readonly downloadResult = new EventEmitter<void>();
  @Output() readonly processAnother = new EventEmitter<void>();
  @Output() readonly editAgain = new EventEmitter<void>();

  private readonly previewService = inject(PdfWatermarkPreviewService);
  private readonly watermarkMetrics = inject(PdfWatermarkMetricsService);
  private readonly cd = inject(ChangeDetectorRef);

  @ViewChild('previewPageElement')
  private previewPageElement?: ElementRef<HTMLElement>;
  private pageSliderTimer: ReturnType<typeof setTimeout> | null = null;

  currentPage = 1;
  previewPage: WatermarkPreviewPage | null = null;
  previewLoading = false;
  previewError = '';
  previewRequest: PdfWatermarkRequest = {
    kind: 'text', text: 'CONFIDENTIAL', opacity: 0.28, rotation: -35,
    position: 'center', pageSelection: { mode: 'all' }, tiled: false,
    fontSize: 42, font: 'Helvetica', color: '#17324d', imageScalePercent: 28,
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['file'] && this.file) {
      this.currentPage = 1;
      void this.openPreview(this.file);
    }
  }

  async openPreview(file: File): Promise<void> {
    this.previewLoading = true;
    this.previewError = '';
    this.previewPage = null;
    this.cd.markForCheck();
    try {
      const count = await this.previewService.open(file);
      this.currentPage = Math.min(Math.max(1, this.currentPage), count);
      this.pageCount = count;
      await this.renderPreviewPage();
    } catch (error: unknown) {
      this.previewError = error instanceof Error ? error.message : 'Unable to render PDF preview.';
    } finally {
      this.previewLoading = false;
      this.cd.markForCheck();
    }
  }

  async goToPage(page: number): Promise<void> {
    if (this.busy || this.previewLoading || !this.pageCount) return;
    const next = Math.min(this.pageCount, Math.max(1, Math.round(page)));
    if (next === this.currentPage && this.previewPage) return;
    this.currentPage = next;
    await this.renderPreviewPage();
  }

  onPageSliderInput(page: number): void {
    if (this.busy || !this.pageCount) return;
    this.currentPage = Math.min(this.pageCount, Math.max(1, Math.round(page)));
    if (this.pageSliderTimer) clearTimeout(this.pageSliderTimer);
    this.pageSliderTimer = setTimeout(() => {
      this.pageSliderTimer = null;
      void this.renderPreviewPage();
    }, 90);
    this.cd.markForCheck();
  }

  async previousPage(): Promise<void> { await this.goToPage(this.currentPage - 1); }
  async nextPage(): Promise<void> { await this.goToPage(this.currentPage + 1); }

  onPreviewRetry(): void {
    if (this.file) void this.openPreview(this.file);
  }

  onReplace(): void {
    if (!this.busy) this.replaceFile.emit();
  }

  onConfigurationChange(request: PdfWatermarkRequest): void {
    this.previewRequest = request;
    void this.refreshPreviewTextMetrics(request);
    if (request.imageFile !== this.previewImageSource) {
      this.previewImageSource = request.imageFile ?? null;
      this.previewImageAspectRatio = 1;
      if (request.imageFile) {
        void this.readPreviewImageRatio(request.imageFile);
      }
    }
    if (this.previewImageUrl.startsWith('blob:')) URL.revokeObjectURL(this.previewImageUrl);
    this.previewImageUrl = request.imageFile ? URL.createObjectURL(request.imageFile) : '';
    this.cd.markForCheck();
  }

  private async readPreviewImageRatio(file: File): Promise<void> {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width > 0 && bitmap.height > 0 && this.previewImageSource === file) {
          this.previewImageAspectRatio = bitmap.width / bitmap.height;
        }
      } finally {
        bitmap.close();
      }
    } catch {
      this.previewImageAspectRatio = 1;
    }
    this.cd.markForCheck();
  }

  isCurrentPageSelected(): boolean {
    if (!this.previewRequest.pageSelection || this.previewRequest.pageSelection.mode === 'all') return true;
    try {
      return resolveWatermarkPageSelection(this.previewRequest.pageSelection, this.pageCount).includes(this.currentPage);
    } catch {
      // The controls will surface the invalid range. Do not show a misleading
      // watermark preview while the selection is invalid.
      return false;
    }
  }

  previewTransform(): string {
    // Positioning is now resolved entirely with pixel coordinates in
    // previewAnchorStyle()/previewTileCenters(). The overlay itself must only
    // rotate around its own center. Keeping percentage translation out of the
    // transform chain eliminates CSS transform-order ambiguity and guarantees
    // that the requested watermark center remains the requested center for
    // every rotation and every position preset.
    return `rotate(${this.previewRequest.rotation}deg)`;
  }

  private previewPageGeometry(): { width: number; height: number; scale: number } {
    const page = this.previewPage;
    const element = this.previewPageElement?.nativeElement;
    if (page && element && element.clientWidth > 0) {
      // All watermark geometry is calculated in the same PDF display-point
      // coordinate system used by the exporter, then scaled into CSS pixels.
      // This is the key fix for page-to-page drift.
      return {
        width: page.width,
        height: page.height,
        scale: element.clientWidth / page.width,
      };
    }
    if (page && page.width > 0) {
      return { width: page.width, height: page.height, scale: page.renderScale };
    }
    return { width: 612, height: 792, scale: 1 };
  }



  previewAnchorStyle(): { left: string; top: string } {
    const geometry = this.previewPageGeometry();
    const content = this.previewWatermarkContentSize(geometry.width, geometry.height);
    const center = watermarkDisplayPositionCenter(
      this.previewRequest.position,
      geometry.width,
      geometry.height,
      content.width,
      content.height,
      this.previewRequest.rotation,
      24,
    );

    const topLeft = watermarkDisplayCenterToCssTopLeft(
      center,
      geometry.width,
      geometry.height,
      content.width,
      content.height,
      geometry.scale,
    );

    // CSS left/top are the unrotated element's top-left corner. Rotation is
    // applied only around the element center. This preserves the requested
    // visual center exactly for every position preset and rotation.
    return {
      left: `${topLeft.left}px`,
      top: `${topLeft.top}px`,
    };
  }

  previewTileCenters(): readonly { left: number; top: number }[] {
    const geometry = this.previewPageGeometry();
    const content = this.previewWatermarkContentSize(geometry.width, geometry.height);

    const repeatScale = watermarkTiledScale(
      geometry.width, geometry.height, content.width, content.height, this.previewRequest.rotation,
    );
    return watermarkTiledCenters(
      geometry.width,
      geometry.height,
      content.width * repeatScale,
      content.height * repeatScale,
      this.previewRequest.kind,
      1,
      this.previewRequest.rotation,
    ).map(center => {
      const displayCenter = { x: center.x, y: geometry.height - center.y };
      const topLeft = watermarkDisplayCenterToCssTopLeft(
        displayCenter,
        geometry.width,
        geometry.height,
        content.width * repeatScale,
        content.height * repeatScale,
        geometry.scale,
      );
      return { left: topLeft.left, top: topLeft.top };
    });
  }

  private previewWatermarkContentSize(pageWidth: number, pageHeight: number): { width: number; height: number } {
    if (this.previewRequest.kind === 'image') {
      const width = pageWidth * (Math.max(5, Math.min(80, this.previewRequest.imageScalePercent)) / 100);
      const height = width / Math.max(0.05, this.previewImageAspectRatio);
      return { width, height };
    }

    const fontSize = Math.max(8, Math.min(200, this.previewRequest.fontSize));
    const text = this.previewRequest.text || 'WATERMARK';

    // Prefer the exact pdf-lib standard-font metrics used by export. This is
    // intentionally asynchronous and generation-guarded; until the metrics
    // are available, the canvas estimate is only a temporary visual fallback.
    if (this.previewTextMetrics && this.previewTextMetrics.text === text &&
        this.previewTextMetrics.font === this.previewRequest.font &&
        this.previewTextMetrics.fontSize === fontSize) {
      return {
        width: this.previewTextMetrics.width,
        height: this.previewTextMetrics.height,
      };
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const previewScale = this.previewPageGeometry().scale;
    let width = Math.max(fontSize * 2, fontSize * 0.58 * text.length);
    if (context) {
      // The preview page is already scaled from PDF points into CSS pixels.
      // Keep the fallback metric in that same coordinate system; do not apply
      // a second 96/72 conversion.
      const cssFontSize = fontSize * previewScale;
      context.font = `${cssFontSize}px ${this.previewFontFamily()}`;
      width = Math.max(fontSize * 2, context.measureText(text).width / Math.max(0.01, previewScale));
    }
    return { width, height: fontSize * 1.05 };
  }


  previewTextCenters(): readonly { x: number; y: number }[] {
    const geometry = this.previewPageGeometry();
    const content = this.previewWatermarkContentSize(geometry.width, geometry.height);

    if (!this.previewRequest.tiled) {
      return [watermarkDisplayPositionCenter(
        this.previewRequest.position,
        geometry.width,
        geometry.height,
        content.width,
        content.height,
        this.previewRequest.rotation,
        24,
      )];
    }

    const repeatScale = watermarkTiledScale(
      geometry.width, geometry.height, content.width, content.height, this.previewRequest.rotation,
    );
    return watermarkTiledCenters(
      geometry.width,
      geometry.height,
      content.width * repeatScale,
      content.height * repeatScale,
      'text',
      1,
      this.previewRequest.rotation,
    ).map(center => ({
      x: center.x,
      // Repeat geometry is shared PDF-space geometry; convert to SVG
      // top-origin coordinates exactly once.
      y: geometry.height - center.y,
    }));
  }

  previewTextBaselineOffset(): number {
    const metrics = this.previewTextMetrics;
    const base = metrics
      ? (metrics.ascenderHeight - metrics.descenderHeight) / 2
      : Math.max(0, this.previewRequest.fontSize * 0.28);
    const geometry = this.previewPageGeometry();
    const content = this.previewWatermarkContentSize(geometry.width, geometry.height);
    const repeatScale = this.previewRequest.tiled
      ? watermarkTiledScale(geometry.width, geometry.height, content.width, content.height, this.previewRequest.rotation)
      : 1;
    return base * repeatScale;
  }

  previewTextFontSize(): number {
    const base = Math.max(8, Math.min(200, this.previewRequest.fontSize));
    if (!this.previewRequest.tiled) return base;
    const geometry = this.previewPageGeometry();
    const content = this.previewWatermarkContentSize(geometry.width, geometry.height);
    return base * watermarkTiledScale(geometry.width, geometry.height, content.width, content.height, this.previewRequest.rotation);
  }

  previewTextTransform(center: { x: number; y: number }): string {
    return `rotate(${this.previewRequest.rotation} ${center.x} ${center.y})`;
  }

  previewWatermarkBoxStyle(): { width: string; height: string } {
    const geometry = this.previewPageGeometry();
    const content = this.previewWatermarkContentSize(geometry.width, geometry.height);
    return {
      width: `${Math.max(1, content.width * geometry.scale)}px`,
      height: `${Math.max(1, content.height * geometry.scale)}px`,
    };
  }

  private async refreshPreviewTextMetrics(request: PdfWatermarkRequest): Promise<void> {
    if (request.kind !== 'text') {
      this.previewTextMetrics = null;
      this.cd.markForCheck();
      return;
    }

    const generation = ++this.previewMetricsGeneration;
    try {
      const metrics = await this.watermarkMetrics.measure(
        request.font,
        request.text || 'WATERMARK',
        request.fontSize,
      );
      if (generation !== this.previewMetricsGeneration || this.previewRequest !== request) return;
      this.previewTextMetrics = metrics;
      this.cd.markForCheck();
    } catch {
      // Canvas fallback remains active if exact PDF metrics cannot be loaded.
    }
  }

  previewFontSize(): number {
    const geometry = this.previewPageGeometry();
    const points = Math.max(8, Math.min(200, this.previewRequest.fontSize));
    if (!this.previewRequest.tiled) return points * geometry.scale;
    const content = this.previewWatermarkContentSize(geometry.width, geometry.height);
    return points * watermarkTiledScale(geometry.width, geometry.height, content.width, content.height, this.previewRequest.rotation) * geometry.scale;
  }

  previewFontFamily(): string {
    switch (this.previewRequest.font) {
      case 'Times-Roman': return 'Times New Roman, Times, serif';
      case 'Courier': return 'Courier New, Courier, monospace';
      default: return 'Helvetica, Arial, sans-serif';
    }
  }

  previewImageWidth(): string {
    const geometry = this.previewPageGeometry();
    const baseWidth = geometry.width * Math.max(5, Math.min(80, this.previewRequest.imageScalePercent)) / 100;
    const content = this.previewWatermarkContentSize(geometry.width, geometry.height);
    const repeatScale = this.previewRequest.tiled
      ? watermarkTiledScale(geometry.width, geometry.height, content.width, content.height, this.previewRequest.rotation)
      : 1;
    return `${baseWidth * repeatScale * geometry.scale}px`;
  }

  previewImageUrl = '';
  private previewImageSource: File | null = null;
  private previewImageAspectRatio = 1;
  private previewTextMetrics: WatermarkTextMetrics | null = null;
  private previewMetricsGeneration = 0;

  private async renderPreviewPage(): Promise<void> {
    if (!this.pageCount) return;
    this.previewLoading = true;
    this.previewError = '';
    this.cd.markForCheck();
    try {
      this.previewPage = await this.previewService.renderPage(this.currentPage);
    } catch (error: unknown) {
      if (error instanceof Error && /superseded|cancel/i.test(error.message)) return;
      this.previewError = error instanceof Error ? error.message : 'Unable to render this page.';
      this.previewPage = null;
    } finally {
      this.previewLoading = false;
      this.cd.markForCheck();
    }
  }

  ngOnDestroy(): void {
    if (this.pageSliderTimer) clearTimeout(this.pageSliderTimer);
    if (this.previewImageUrl.startsWith('blob:')) URL.revokeObjectURL(this.previewImageUrl);
    this.previewImageSource = null;
    void this.previewService.destroy();
  }
}
