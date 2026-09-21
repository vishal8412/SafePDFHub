import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SignatureBuilderComponent } from '../../../signing/signature-builder/signature-builder.component';
import { SignPdfResultComponent } from '../sign-pdf-result/sign-pdf-result.component';
import {
  SigningPdfRendererService,
  type RenderedSigningPage,
  type SigningPdfSession,
} from '../../../../core/signing/services/signing-pdf-renderer.service';
import { SigningPdfExportService } from '../../../../core/signing/services/signing-pdf-export.service';
import { SignatureAssetService } from '../../../../core/signing/services/signature-asset.service';
import { SigningStateService } from '../../../../core/signing/services/signing-state.service';
import type {
  SigningAsset,
  SigningField,
  SigningFieldKind,
} from '../../../../core/signing/models/signing.models';
import { LoaderService } from '../../../../shared/services/loader.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { saveAs } from 'file-saver';

type FieldInteractionMode = 'move' | 'resize';
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';
type BulkMode = 'apply' | 'remove';

interface FieldInteraction {
  readonly id: string;
  readonly mode: FieldInteractionMode;
  readonly handle?: ResizeHandle;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startBounds: SigningField['bounds'];
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly historyBefore: readonly SigningField[];
}

@Component({
  selector: 'app-sign-pdf-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule, SignatureBuilderComponent, SignPdfResultComponent],
  templateUrl: './sign-pdf-workspace.component.html',
  styleUrl: './sign-pdf-workspace.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignPdfWorkspaceComponent implements OnDestroy, OnChanges {
  @Input() file: File | null = null;
  @Output() readonly replaceFile = new EventEmitter<void>();

  readonly state = inject(SigningStateService);
  private readonly renderer = inject(SigningPdfRendererService);
  private readonly exporter = inject(SigningPdfExportService);
  private readonly assets = inject(SignatureAssetService);
  private readonly loader = inject(LoaderService);
  private readonly toast = inject(ToastService);
  private readonly cd = inject(ChangeDetectorRef);

  currentPage: RenderedSigningPage | null = null;
  currentPageNumber = 1;
  pageCount = 0;
  selectedKind: SigningFieldKind = 'signature';
  interactionMode: 'place' | 'select' = 'place';
  selectedFieldId: string | null = null;
  manuallySelectedAssetId: string | null = null;

  dialog = false;
  error = '';
  loading = false;
  exporting = false;
  resultFile: File | null = null;
  resultDurationMs = 0;
  bulkDialog = false;
  bulkMode: BulkMode = 'apply';
  bulkScope: 'current' | 'all' | 'range' | 'specific' = 'current';
  bulkFrom = 1;
  bulkTo = 1;
  bulkPages = '';
  bulkPosition: 'same' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' = 'same';
  draggingAssetId: string | null = null;

  readonly toolItems: readonly { kind: SigningFieldKind; label: string; icon: string }[] = [
    { kind: 'signature', label: 'Signature', icon: '✍' },
    { kind: 'initials', label: 'Initials', icon: 'AB' },
    { kind: 'text', label: 'Text', icon: 'T' },
    { kind: 'date', label: 'Date', icon: '▣' },
    { kind: 'checkbox', label: 'Checkbox', icon: '☑' },
  ];

  readonly signatureAssets = this.state.assets;
  readonly textFonts = [
    { label: 'Inter', value: 'Inter, Arial, sans-serif' },
    { label: 'Elegant', value: '"Segoe Script", "Brush Script MT", cursive' },
    { label: 'Brush', value: '"Brush Script MT", "Segoe Script", cursive' },
    { label: 'Handwritten', value: '"Segoe Print", "Comic Sans MS", cursive' },
    { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
    { label: 'Formal', value: '"Times New Roman", Georgia, serif' },
  ] as const;
  readonly colors = ['#121923', '#0f766e', '#2563eb', '#7c3aed', '#be185d', '#b45309', '#000000'] as const;

  private session: SigningPdfSession | null = null;
  sourceFile: File | null = null;
  private fieldInteraction: FieldInteraction | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    const fileChange = changes['file'];
    if (!fileChange || fileChange.currentValue === this.sourceFile) return;
    this.sourceFile = fileChange.currentValue as File | null;
    void this.loadFile(this.sourceFile);
  }

  private async loadFile(file: File | null): Promise<void> {
    await this.destroySession();
    this.currentPage = null;
    this.pageCount = 0;
    this.currentPageNumber = 1;
    this.selectedFieldId = null;
    this.manuallySelectedAssetId = null;
    this.resultFile = null;
    this.state.clearFields();
    this.error = '';

    if (!file) {
      this.cd.markForCheck();
      return;
    }

    this.loading = true;
    this.cd.markForCheck();
    try {
      this.session = await this.renderer.open(file);
      this.pageCount = this.session.pageCount;
      if (this.pageCount < 1) throw new Error('This PDF does not contain any pages.');
      await this.renderCurrentPage();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not open this PDF.';
      this.currentPage = null;
      await this.destroySession();
    } finally {
      this.loading = false;
      this.cd.markForCheck();
    }
  }

  async goToPage(pageNumber: number): Promise<void> {
    if (!this.session || this.loading || !Number.isFinite(pageNumber)) return;
    const next = Math.max(1, Math.min(this.pageCount, Math.floor(pageNumber)));
    if (next === this.currentPageNumber && this.currentPage) return;
    this.currentPageNumber = next;
    this.selectedFieldId = null;
    await this.renderCurrentPage();
  }

  async previousPage(): Promise<void> { await this.goToPage(this.currentPageNumber - 1); }
  async nextPage(): Promise<void> { await this.goToPage(this.currentPageNumber + 1); }

  private async renderCurrentPage(): Promise<void> {
    if (!this.session) return;
    this.loading = true;
    this.error = '';
    this.cd.markForCheck();
    try {
      this.currentPage = await this.session.renderPage(this.currentPageNumber, 1.35);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not render this PDF page.';
      this.currentPage = null;
    } finally {
      this.loading = false;
      this.cd.markForCheck();
    }
  }

  chooseKind(kind: SigningFieldKind): void {
    this.interactionMode = 'place';
    this.selectedKind = kind;
    this.selectedFieldId = null;
    this.manuallySelectedAssetId = null;

    if (kind === 'signature' || kind === 'initials') {
      const active = this.state.activeAsset();
      if (!active || active.kind !== kind) {
        const matching = this.state.assets().find(asset => asset.kind === kind);
        if (matching) this.assets.setActive(matching);
        else this.openCreateDialog();
      }
    } else {
      this.state.setActiveKind(kind);
    }
    this.cd.markForCheck();
  }

  selectAsset(asset: SigningAsset): void {
    this.assets.setActive(asset);
    this.selectedKind = asset.kind;
    this.interactionMode = 'place';
    this.selectedFieldId = null;
    this.manuallySelectedAssetId = asset.id;
    this.cd.markForCheck();
  }

  openCreateDialog(): void {
    this.error = '';
    this.dialog = true;
    this.cd.markForCheck();
  }

  closeDialog(): void { this.dialog = false; this.cd.markForCheck(); }

  onAssetCreated(): void {
    this.dialog = false;
    this.interactionMode = 'place';
    this.manuallySelectedAssetId = null;
    this.cd.markForCheck();
  }

  deleteAsset(asset: SigningAsset, event: Event): void {
    event.stopPropagation();
    this.state.removeAsset(asset.id);
    if (this.manuallySelectedAssetId === asset.id) this.manuallySelectedAssetId = null;
    this.cd.markForCheck();
  }

  onAssetDragStart(asset: SigningAsset, event: DragEvent): void {
    this.draggingAssetId = asset.id;
    event.dataTransfer?.setData('text/plain', asset.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onAssetDrop(targetIndex: number): void {
    if (!this.draggingAssetId) return;
    this.state.moveAsset(this.draggingAssetId, targetIndex);
    this.draggingAssetId = null;
    this.cd.markForCheck();
  }

  openBulkDialog(mode: BulkMode = 'apply'): void {
    const field = this.selectedField;
    if (!field) return;
    this.bulkMode = mode;
    this.bulkScope = 'current';
    this.bulkFrom = field.pageNumber;
    this.bulkTo = field.pageNumber;
    this.bulkPages = '';
    this.bulkPosition = 'same';
    this.bulkDialog = true;
    this.cd.markForCheck();
  }

  closeBulkDialog(): void { this.bulkDialog = false; }

  applyToPages(): void {
    const source = this.selectedField;
    if (!source || !this.pageCount) return;
    const pages = this.resolveBulkPages();
    if (!pages.length) {
      this.toast.show('Choose at least one page.', 'error');
      return;
    }

    const before = this.state.checkpoint();
    const groupId = source.bulkGroupId ?? this.id();

    for (const pageNumber of pages) {
      const existing = this.state.fields().find(field =>
        field.bulkGroupId === groupId && field.pageNumber === pageNumber && field.kind === source.kind
      );
      const bounds = this.positionedBounds(source.bounds, this.bulkPosition);
      if (existing) {
        this.state.updateField(existing.id, { ...source, id: existing.id, pageNumber, bulkGroupId: groupId, bounds });
      } else if (pageNumber === source.pageNumber && source.bulkGroupId !== groupId) {
        this.state.updateField(source.id, { bulkGroupId: groupId, bounds });
      } else {
        this.state.addField({ ...source, id: this.id(), pageNumber, bulkGroupId: groupId, bounds });
      }
    }

    this.state.commitCheckpoint(before);
    this.bulkDialog = false;
    this.cd.markForCheck();
  }

  removeAppliedPages(): void {
    const source = this.selectedField;
    if (!source?.bulkGroupId) return;
    const pages = new Set(this.resolveBulkPages());
    const before = this.state.checkpoint();
    for (const field of this.state.fields()) {
      if (field.bulkGroupId === source.bulkGroupId && pages.has(field.pageNumber)) {
        this.state.removeField(field.id);
      }
    }
    this.state.commitCheckpoint(before);
    this.selectedFieldId = null;
    this.bulkDialog = false;
    this.cd.markForCheck();
  }

  private resolveBulkPages(): number[] {
    if (this.bulkScope === 'current') return [this.selectedField?.pageNumber ?? this.currentPageNumber];
    if (this.bulkScope === 'all') return Array.from({ length: this.pageCount }, (_, i) => i + 1);
    if (this.bulkScope === 'range') {
      const from = Math.max(1, Math.min(this.pageCount, Math.floor(this.bulkFrom)));
      const to = Math.max(from, Math.min(this.pageCount, Math.floor(this.bulkTo)));
      return Array.from({ length: to - from + 1 }, (_, i) => from + i);
    }
    const result = new Set<number>();
    for (const part of this.bulkPages.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const from = Math.max(1, Math.min(this.pageCount, +range[1]));
        const to = Math.max(from, Math.min(this.pageCount, +range[2]));
        for (let page = from; page <= to; page++) result.add(page);
      } else if (/^\d+$/.test(trimmed)) {
        const page = +trimmed;
        if (page >= 1 && page <= this.pageCount) result.add(page);
      }
    }
    return [...result].sort((a, b) => a - b);
  }

  private positionedBounds(bounds: SigningField['bounds'], position: typeof this.bulkPosition): SigningField['bounds'] {
    if (position === 'same') return { ...bounds };
    const margin = 0.06;
    let x = bounds.x;
    let y = bounds.y;
    if (position.includes('left')) x = margin;
    if (position.includes('right')) x = 1 - margin - bounds.width;
    if (position.includes('top')) y = margin;
    if (position.includes('bottom')) y = 1 - margin - bounds.height;
    if (position === 'center') { x = (1 - bounds.width) / 2; y = (1 - bounds.height) / 2; }
    return { ...bounds, x: this.clamp(x, 0, 1 - bounds.width), y: this.clamp(y, 0, 1 - bounds.height) };
  }

  placeField(event: PointerEvent): void {
    if (!this.currentPage || event.button !== 0 || this.fieldInteraction) return;
    const target = event.target as HTMLElement | null;

    if (this.interactionMode === 'select') {
      if (!target?.closest('.sign-field')) this.selectedFieldId = null;
      this.cd.markForCheck();
      return;
    }

    if (target?.closest('.sign-field')) return;
    const kind = this.selectedKind;
    const activeAsset = this.state.activeAsset();
    if ((kind === 'signature' || kind === 'initials') && (!activeAsset || activeAsset.kind !== kind)) {
      this.openCreateDialog();
      return;
    }

    const pageElement = event.currentTarget as HTMLElement;
    const rect = pageElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const bounds = this.defaultBounds(kind, x, y, activeAsset);
    const before = this.state.checkpoint();

    const field: SigningField = {
      id: this.id(),
      pageNumber: this.currentPage.pageNumber,
      kind,
      bounds,
      value: kind === 'date' ? new Date().toLocaleDateString('en-GB') : kind === 'text' ? 'Text' : undefined,
      asset: kind === 'signature' || kind === 'initials' ? activeAsset ?? undefined : undefined,
      fontFamily: kind === 'date' ? '"Segoe Script", "Brush Script MT", "Segoe Print", cursive' : 'Inter, Arial, sans-serif',
      fontSize: 16,
      fontStyle: kind === 'date' ? 'italic' : 'normal',
      color: '#121923',
      checked: kind === 'checkbox' ? true : undefined,
      opacity: 1,
    };

    this.state.addField(field);
    this.state.commitCheckpoint(before);
    this.selectedFieldId = field.id;
    this.cd.markForCheck();
  }

  private defaultBounds(kind: SigningFieldKind, x: number, y: number, asset: SigningAsset | null): SigningField['bounds'] {
    let width = 0.22;
    let height = 0.055;
    if (kind === 'checkbox') {
      width = 0.035; height = 0.035;
    } else if (kind === 'text' || kind === 'date') {
      width = kind === 'date' ? 0.20 : 0.22; height = 0.052;
    } else {
      const ratio = asset && asset.naturalWidth > 0 ? asset.naturalHeight / asset.naturalWidth : 0.28;
      width = kind === 'initials' ? 0.15 : 0.23;
      height = Math.max(0.045, Math.min(0.14, width * ratio));
    }
    return { x: this.clamp(x - width / 2, 0, 1 - width), y: this.clamp(y - height / 2, 0, 1 - height), width, height };
  }

  selectField(event: PointerEvent, field: SigningField): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectedFieldId = field.id;
    this.interactionMode = 'select';
    this.cd.markForCheck();
  }

  beginFieldMove(event: PointerEvent, field: SigningField): void {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    this.selectedFieldId = field.id;
    this.interactionMode = 'select';
    this.beginInteraction(event, 'move', field);
  }

  beginFieldResize(event: PointerEvent, field: SigningField, handle: ResizeHandle): void {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    this.selectedFieldId = field.id;
    this.interactionMode = 'select';
    this.beginInteraction(event, 'resize', field, handle);
  }

  private beginInteraction(event: PointerEvent, mode: FieldInteractionMode, field: SigningField, handle?: ResizeHandle): void {
    const page = (event.currentTarget as HTMLElement).closest('.sign-page');
    const rect = page?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    this.fieldInteraction = {
      id: field.id, mode, handle, pointerId: event.pointerId,
      startClientX: event.clientX, startClientY: event.clientY,
      startBounds: field.bounds, pageWidth: rect.width, pageHeight: rect.height,
      historyBefore: this.state.checkpoint(),
    };
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* progressive */ }
  }

  onFieldPointerMove(event: PointerEvent): void {
    const interaction = this.fieldInteraction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const dx = (event.clientX - interaction.startClientX) / interaction.pageWidth;
    const dy = (event.clientY - interaction.startClientY) / interaction.pageHeight;
    const next = interaction.mode === 'move'
      ? this.moveBounds(interaction.startBounds, dx, dy)
      : this.resizeBounds(interaction.startBounds, dx, dy, interaction.handle, interaction.pageWidth, interaction.pageHeight);
    this.state.updateField(interaction.id, { bounds: next });
    this.cd.markForCheck();
  }

  onFieldPointerUp(event: PointerEvent): void {
    const interaction = this.fieldInteraction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    this.fieldInteraction = null;
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId); } catch { /* progressive */ }
    this.state.commitCheckpoint(interaction.historyBefore);
    this.cd.markForCheck();
  }

  private moveBounds(bounds: SigningField['bounds'], dx: number, dy: number): SigningField['bounds'] {
    return { ...bounds, x: this.clamp(bounds.x + dx, 0, 1 - bounds.width), y: this.clamp(bounds.y + dy, 0, 1 - bounds.height) };
  }

  private resizeBounds(bounds: SigningField['bounds'], dx: number, dy: number, handle: ResizeHandle | undefined, pageWidth: number, pageHeight: number): SigningField['bounds'] {
    if (!handle) return bounds;
    const minWidth = Math.max(0.035, 20 / pageWidth);
    const minHeight = Math.max(0.028, 18 / pageHeight);
    let { x, y, width, height } = bounds;
    if (handle.includes('w')) {
      const nextX = this.clamp(bounds.x + dx, 0, bounds.x + bounds.width - minWidth);
      x = nextX; width = bounds.x + bounds.width - nextX;
    } else if (handle.includes('e')) width = this.clamp(bounds.width + dx, minWidth, 1 - bounds.x);
    if (handle.includes('n')) {
      const nextY = this.clamp(bounds.y + dy, 0, bounds.y + bounds.height - minHeight);
      y = nextY; height = bounds.y + bounds.height - nextY;
    } else if (handle.includes('s')) height = this.clamp(bounds.height + dy, minHeight, 1 - bounds.y);

    const field = this.selectedField;
    if ((field?.kind === 'signature' || field?.kind === 'initials') && field.asset) {
      const aspect = (field.asset.naturalWidth / Math.max(1, field.asset.naturalHeight)) * (pageHeight / pageWidth);
      if (Number.isFinite(aspect) && aspect > 0) {
        const targetWidth = Math.max(minWidth, height * aspect);
        const targetHeight = Math.max(minHeight, width / aspect);
        if (Math.abs(dx) >= Math.abs(dy)) {
          width = Math.min(targetWidth, 1 - x);
          height = Math.min(Math.max(minHeight, width / aspect), 1 - y);
        } else {
          height = Math.min(targetHeight, 1 - y);
          width = Math.min(Math.max(minWidth, height * aspect), 1 - x);
        }
      }
    }
    return { x: this.clamp(x, 0, 1 - width), y: this.clamp(y, 0, 1 - height), width: Math.min(width, 1), height: Math.min(height, 1) };
  }

  updateSelectedText(value: string): void { this.updateFieldPatch({ value }); }
  updateSelectedFontSize(value: string): void { this.updateFieldPatch({ fontSize: Math.max(8, Math.min(96, Number(value))) }); }
  updateSelectedColor(value: string): void { this.updateFieldPatch({ color: value }); }
  updateSelectedOpacity(value: string): void { this.updateFieldPatch({ opacity: Math.max(0.05, Math.min(1, Number(value) / 100)) }); }
  opacityPercent(value: number | undefined): number { return Math.round((value ?? 1) * 100); }
  updateSelectedFontFamily(value: string): void { this.updateFieldPatch({ fontFamily: value }); }
  updateSelectedFontStyle(style: 'normal' | 'italic'): void { this.updateFieldPatch({ fontStyle: style }); }

  private updateFieldPatch(patch: Partial<SigningField>): void {
    if (!this.selectedFieldId) return;
    const before = this.state.checkpoint();
    this.state.updateField(this.selectedFieldId, patch);
    this.state.commitCheckpoint(before);
    this.cd.markForCheck();
  }

  toggleSelectedCheckbox(): void {
    const field = this.selectedField;
    if (!field) return;
    this.updateFieldPatch({ checked: !(field.checked ?? true) });
  }

  removeSelected(): void {
    if (!this.selectedFieldId) return;
    const before = this.state.checkpoint();
    this.state.removeField(this.selectedFieldId);
    this.state.commitCheckpoint(before);
    this.selectedFieldId = null;
    this.cd.markForCheck();
  }

  removeField(event: PointerEvent, field: SigningField): void {
    event.preventDefault(); event.stopPropagation();
    const before = this.state.checkpoint();
    this.state.removeField(field.id);
    this.state.commitCheckpoint(before);
    if (this.selectedFieldId === field.id) this.selectedFieldId = null;
    this.cd.markForCheck();
  }

  get selectedField(): SigningField | null {
    return this.state.fields().find(field => field.id === this.selectedFieldId) ?? null;
  }

  fieldStyle(field: SigningField): Record<string, string> {
    return {
      left: `${field.bounds.x * 100}%`, top: `${field.bounds.y * 100}%`,
      width: `${field.bounds.width * 100}%`, height: `${field.bounds.height * 100}%`,
      opacity: String(field.opacity ?? 1),
    };
  }

  async undo(): Promise<void> {
    if (!this.state.undo()) return;
    this.selectedFieldId = null;
    this.cd.markForCheck();
  }

  async redo(): Promise<void> {
    if (!this.state.redo()) return;
    this.selectedFieldId = null;
    this.cd.markForCheck();
  }

  downloadResult(): void {
    if (!this.resultFile) return;
    saveAs(this.resultFile, this.resultFile.name);
    this.toast.show('Signed PDF downloaded successfully.', 'success');
  }

  async export(): Promise<void> {
    if (!this.sourceFile || !this.state.fields().length || this.exporting) return;
    this.exporting = true;
    this.error = '';
    this.loader.show('Preparing your signed PDF…');
    this.loader.setProgress?.(8);
    this.cd.markForCheck();
    const started = performance.now();
    try {
      this.loader.setText('Flattening signing fields locally…');
      this.loader.setProgress?.(35);
      const base = this.sourceFile.name.replace(/\.pdf$/i, '') || 'document';
      const blob = await this.exporter.export(this.sourceFile, this.state.fields());
      this.loader.setProgress?.(92);
      this.resultFile = new File([blob], `${base}_signed.pdf`, { type: 'application/pdf' });
      this.resultDurationMs = performance.now() - started;
      this.loader.setText('Signed PDF ready ✓');
      this.toast.show('Your signed PDF is ready.', 'success');
      this.selectedFieldId = null;
      this.interactionMode = 'select';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not export the signed PDF.';
      this.toast.show(this.error, 'error');
      this.loader.setText('Signing could not be completed');
    } finally {
      this.exporting = false;
      setTimeout(() => this.loader.hide(), 250);
      this.cd.markForCheck();
    }
  }

  editAgain(): void {
    this.resultFile = null;
    this.cd.markForCheck();
  }

  processAnother(): void {
    this.resultFile = null;
    this.state.clearFields();
    this.selectedFieldId = null;
    this.replaceFile.emit();
    this.cd.markForCheck();
  }

  private async destroySession(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) {
      try { await session.destroy(); } catch { /* cleanup */ }
    }
  }

  private clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
  private id(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `field-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  @HostListener('document:keydown', ['$event'])
  onKeyboard(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName.toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
    const mod = event.ctrlKey || event.metaKey;

    if (mod && !typing && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) void this.redo(); else void this.undo();
      return;
    }
    if (mod && !typing && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      void this.redo();
      return;
    }
    if (event.key === 'Escape') {
      if (this.dialog) this.closeDialog();
      else if (this.bulkDialog) this.closeBulkDialog();
      else { this.selectedFieldId = null; this.interactionMode = 'select'; this.cd.markForCheck(); }
      return;
    }
    if (typing) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedFieldId) {
      event.preventDefault();
      this.removeSelected();
    }
  }

  ngOnDestroy(): void { void this.destroySession(); }
}
