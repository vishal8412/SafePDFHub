import { AfterViewInit, ChangeDetectorRef, OnDestroy, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, Output, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SignatureAssetService, type TypedSignatureOptions } from '../../../core/signing/services/signature-asset.service';
import type { SigningAsset, SigningAssetKind } from '../../../core/signing/models/signing.models';

type BuilderMode = 'draw' | 'type' | 'upload' | 'scan';
type DrawTool = 'pen' | 'pencil' | 'brush' | 'eraser';
interface Point { x: number; y: number; }
interface Stroke { points: Point[]; tool: DrawTool; color: string; size: number; opacity: number; }

@Component({
  selector: 'app-signature-builder',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './signature-builder.component.html',
  styleUrl: './signature-builder.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SignatureBuilderComponent implements AfterViewInit, OnDestroy {
  @Input() kind: SigningAssetKind = 'signature';
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly created = new EventEmitter<SigningAsset>();
  @ViewChild('pad') pad?: ElementRef<HTMLCanvasElement>;
  @ViewChild('builder') builder?: ElementRef<HTMLElement>;

  private readonly assets = inject(SignatureAssetService);

  private readonly cdr = inject(ChangeDetectorRef);
  private destroyed = false;
  private importVersion = 0;
  private activePointer: number | null = null;
  importedAsset: SigningAsset | null = null;
  ngOnDestroy(): void { this.destroyed = true; ++this.importVersion; }
  get canUseSignature(): boolean {
    return this.mode === 'draw' ? this.strokes.some(stroke => stroke.tool !== 'eraser')
      : this.mode === 'type' ? !!this.typedValue.trim() : !!this.importedAsset;
  }

  mode: BuilderMode = 'draw';
  drawTool: DrawTool = 'pen';
  color = '#111827';
  brushSize = 4;
  opacity = 1;
  typedValue = '';
  typedFont = '"Segoe Script", "Brush Script MT", cursive';
  typedFontSize = 150;
  typedColor = '#111827';
  typedOpacity = 1;
  typedItalic = true;
  typedLetterSpacing = 0;
  error = '';
  creating = false;
  private drawing = false;
  private lastPoint: Point | null = null;
  private strokes: Stroke[] = [];
  private redoStrokes: Stroke[] = [];

  pointerPreviewVisible = false;
  pointerPreviewX = 0;
  pointerPreviewY = 0;
  pointerPreviewSize = 12;

  readonly colors = ['#111827', '#0f766e', '#2563eb', '#7c3aed', '#be185d', '#b45309', '#000000'];
  readonly drawTools = [
    { id: 'pen' as const, label: 'Pen', path: 'M12 3 4 8l-2 14 14-2 5-8-9-9Zm-2 9a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM3 21l8-8M16 4l4 4' },
    { id: 'pencil' as const, label: 'Pencil', path: 'm16 3 5 5-13 13-6 1 1-6L16 3ZM13 6l5 5M3 16l5 5M5 17 16 6' },
    { id: 'brush' as const, label: 'Brush', path: 'M14 12 21 3c1-1 2 0 1 1l-6 11-3-3ZM13 14c-6-2-3 7-10 6 4 4 12 1 12-3l-2-3Z' },
    { id: 'eraser' as const, label: 'Eraser', path: 'm14 3 7 7a2 2 0 0 1 0 3l-8 8H7l-5-5a2 2 0 0 1 0-3L12 3a2 2 0 0 1 2 0ZM7 9l9 9M13 21h9' },
  ];
  readonly typeStyles: readonly { label: string; font: string; category: string }[] = [
    { label: 'Elegant', font: '"Segoe Script", "Brush Script MT", cursive', category: 'Elegant' },
    { label: 'Formal', font: '"Times New Roman", Georgia, serif', category: 'Formal' },
    { label: 'Casual', font: '"Comic Sans MS", "Segoe Print", cursive', category: 'Casual' },
    { label: 'Brush', font: '"Brush Script MT", "Segoe Script", cursive', category: 'Brush' },
    { label: 'Modern', font: '"Trebuchet MS", Arial, sans-serif', category: 'Modern' },
    { label: 'Handwritten', font: '"Segoe Print", "Comic Sans MS", cursive', category: 'Handwritten' },
  ];

  ngAfterViewInit(): void {
    setTimeout(() => this.focusFirstControl(), 0);
  }

  onDialogKeyDown(event: KeyboardEvent): void {
    event.stopPropagation();
    if ((event.target as HTMLElement)?.getAttribute('role') === 'tab' && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();
      const modes: BuilderMode[]=['draw','type','upload','scan'];
      const index=event.key==='Home'?0:event.key==='End'?3:(modes.indexOf(this.mode)+(event.key==='ArrowRight'?1:3))%4;
      this.setMode(modes[index]);
      this.builder?.nativeElement.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
      return;
    }
    if (event.key !== 'Tab' || !this.builder) return;

    const root = this.builder.nativeElement;
    const focusable: HTMLElement[] = Array.from(root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element: HTMLElement) => element.offsetParent !== null);

    if (!focusable.length) {
      event.preventDefault();
      root.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusFirstControl(): void {
    const root = this.builder?.nativeElement;
    if (!root) return;
    const first = root.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    first?.focus();
  }

  setMode(mode: BuilderMode): void {
    this.mode = mode;
    this.error = '';
    if (mode === 'draw') setTimeout(() => this.redraw());
  }

  setDrawTool(tool: DrawTool): void {
    this.drawTool = tool;
    this.updatePointerPreviewSize();
  }

  get activeDrawTool() {
    return this.drawTools.find(tool => tool.id === this.drawTool) ?? this.drawTools[0];
  }
  setColor(color: string): void { this.color = color; }
  setTypeStyle(font: string): void { this.typedFont = font; }

  get canUndo(): boolean { return this.strokes.length > 0; }
  get canRedo(): boolean { return this.redoStrokes.length > 0; }

  undoStroke(): void {
    const stroke = this.strokes.pop();
    if (stroke) this.redoStrokes.push(stroke);
    this.redraw();
  }

  redoStroke(): void {
    const stroke = this.redoStrokes.pop();
    if (stroke) this.strokes.push(stroke);
    this.redraw();
  }

  clearPad(): void {
    this.strokes = [];
    this.redoStrokes = [];
    this.redraw();
  }

  onPointerDown(event: PointerEvent): void {
    const canvas = this.pad?.nativeElement;
    if (!canvas || event.button !== 0 || this.activePointer !== null) return;
    this.activePointer = event.pointerId;
    this.updatePointerPreview(event, canvas);
    const point = this.pointFromEvent(event, canvas);
    this.drawing = true;
    this.lastPoint = point;
    this.redoStrokes = [];
    canvas.setPointerCapture(event.pointerId);
    this.strokes.push({ points: [point], tool: this.drawTool, color: this.color, size: this.effectiveSize(), opacity: this.effectiveOpacity() });
    this.redraw();
  }

  onPointerMove(event: PointerEvent): void {
    const canvas = this.pad?.nativeElement;
    if (!canvas) return;
    this.updatePointerPreview(event, canvas);
    if (!this.drawing || !this.lastPoint || this.activePointer !== event.pointerId) return;
    const point = this.pointFromEvent(event, canvas);
    const stroke = this.strokes[this.strokes.length - 1];
    if (!stroke) return;
    const distance = Math.hypot(point.x - this.lastPoint.x, point.y - this.lastPoint.y);
    if (distance < 0.8) return;
    stroke.points.push(point);
    this.lastPoint = point;
    this.redraw();
  }

  onPointerUp(event?: PointerEvent): void {
    if (event && this.activePointer !== event.pointerId) return;
    this.activePointer = null;
    this.drawing = false;
    this.lastPoint = null;
  }

  onPointerLeave(): void {
    this.pointerPreviewVisible = false;
  }

  async useSignature(): Promise<void> {
    if (this.creating || !this.canUseSignature) return;
    this.error = '';
    this.creating = true;
    try {
      const kind = this.kind;
      const asset = this.mode === 'upload' || this.mode === 'scan' ? this.importedAsset! : this.mode === 'draw'
        ? await this.assets.createDrawnAsset(this.pad?.nativeElement as HTMLCanvasElement, kind)
        : await this.assets.createTypedAsset(this.typedValue, kind, this.typedOptions());
      if (!this.destroyed) this.created.emit(asset);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not create the signature.';
    } finally {
      this.creating = false;
      if (!this.destroyed) this.cdr.markForCheck();
    }
  }

  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file || this.creating) return;
    this.error = '';
    this.creating = true;
    const version = ++this.importVersion;
    try {
      const asset = await this.assets.createUploadedAsset(file, this.kind, { cleanupBackground: true });
      if (!this.destroyed && version === this.importVersion) this.importedAsset = asset;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not import the signature image.';
    } finally {
      this.creating = false;
      if (!this.destroyed) this.cdr.markForCheck();
    }
  }

  private typedOptions(): TypedSignatureOptions {
    return {
      fontFamily: this.typedFont,
      fontSize: this.typedFontSize,
      color: this.typedColor,
      opacity: this.typedOpacity,
      italic: this.typedItalic,
      letterSpacing: this.typedLetterSpacing,
    };
  }

  private effectiveSize(): number {
    const size = Number(this.brushSize) || 4;
    if (this.drawTool === 'brush') return Math.max(8, size * 2.2);
    if (this.drawTool === 'pencil') return Math.max(1.5, size * 0.65);
    if (this.drawTool === 'eraser') return Math.max(10, size * 2.5);
    return size;
  }

  private effectiveOpacity(): number {
    const opacity = Number(this.opacity) || 1;
    if (this.drawTool === 'pencil') return Math.min(opacity, 0.55);
    if (this.drawTool === 'eraser') return 1;
    return opacity;
  }


  private updatePointerPreview(event: PointerEvent, canvas: HTMLCanvasElement): void {
    // A physical mouse/stylus pointer can show a live tool cursor. Touch has no
    // stable hover position, so keep the canvas free of a floating indicator.
    if (event.pointerType === 'touch') {
      this.pointerPreviewVisible = false;
      return;
    }

    const rect = canvas.getBoundingClientRect();
    this.pointerPreviewX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    this.pointerPreviewY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    this.updatePointerPreviewSize(rect);
    this.pointerPreviewVisible = true;
  }

  private updatePointerPreviewSize(rect?: DOMRect): void {
    const canvas = this.pad?.nativeElement;
    if (!canvas) return;
    const bounds = rect ?? canvas.getBoundingClientRect();
    const scaleX = bounds.width / canvas.width;
    const effective = this.effectiveSize();
    this.pointerPreviewSize = Math.max(6, Math.min(72, effective * scaleX));
  }

  private pointFromEvent(event: PointerEvent, canvas: HTMLCanvasElement): Point {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
    };
  }

  private redraw(): void {
    const canvas = this.pad?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of this.strokes) this.drawStroke(ctx, stroke);
  }

  private drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const points = stroke.points;
    if (!points.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke.size;
    ctx.globalAlpha = stroke.opacity;
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, Math.max(1, stroke.size / 2), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        const previous = points[i - 1];
        const current = points[i];
        const midX = (previous.x + current.x) / 2;
        const midY = (previous.y + current.y) / 2;
        ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
