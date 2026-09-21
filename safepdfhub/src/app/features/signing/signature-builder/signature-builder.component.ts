import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, Output, ViewChild, inject } from '@angular/core';
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
export class SignatureBuilderComponent {
  @Input() kind: SigningAssetKind = 'signature';
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly created = new EventEmitter<SigningAsset>();
  @ViewChild('pad') pad?: ElementRef<HTMLCanvasElement>;

  private readonly assets = inject(SignatureAssetService);

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
  readonly drawTools: readonly { id: DrawTool; label: string; icon: string }[] = [
    { id: 'pen', label: 'Pen', icon: '✒' },
    { id: 'pencil', label: 'Pencil', icon: '✏' },
    { id: 'brush', label: 'Brush', icon: '🖌' },
    { id: 'eraser', label: 'Eraser', icon: '▱' },
  ];
  readonly typeStyles: readonly { label: string; font: string; category: string }[] = [
    { label: 'Elegant', font: '"Segoe Script", "Brush Script MT", cursive', category: 'Elegant' },
    { label: 'Formal', font: '"Times New Roman", Georgia, serif', category: 'Formal' },
    { label: 'Casual', font: '"Comic Sans MS", "Segoe Print", cursive', category: 'Casual' },
    { label: 'Brush', font: '"Brush Script MT", "Segoe Script", cursive', category: 'Brush' },
    { label: 'Modern', font: '"Trebuchet MS", Arial, sans-serif', category: 'Modern' },
    { label: 'Handwritten', font: '"Segoe Print", "Comic Sans MS", cursive', category: 'Handwritten' },
  ];

  setMode(mode: BuilderMode): void {
    this.mode = mode;
    this.error = '';
    if (mode === 'draw') setTimeout(() => this.redraw());
  }

  setDrawTool(tool: DrawTool): void {
    this.drawTool = tool;
    this.updatePointerPreviewSize();
  }

  get activeDrawTool(): { id: DrawTool; label: string; icon: string } {
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
    if (!canvas) return;
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
    if (!this.drawing || !this.lastPoint) return;
    const point = this.pointFromEvent(event, canvas);
    const stroke = this.strokes[this.strokes.length - 1];
    if (!stroke) return;
    const distance = Math.hypot(point.x - this.lastPoint.x, point.y - this.lastPoint.y);
    if (distance < 0.8) return;
    stroke.points.push(point);
    this.lastPoint = point;
    this.redraw();
  }

  onPointerUp(): void {
    this.drawing = false;
    this.lastPoint = null;
  }

  onPointerLeave(): void {
    this.pointerPreviewVisible = false;
  }

  async useSignature(): Promise<void> {
    if (this.mode === 'upload' || this.mode === 'scan') return;
    this.error = '';
    this.creating = true;
    try {
      const kind = this.kind;
      const asset = this.mode === 'draw'
        ? await this.assets.createDrawnAsset(this.pad?.nativeElement as HTMLCanvasElement, kind)
        : await this.assets.createTypedAsset(this.typedValue, kind, this.typedOptions());
      this.created.emit(asset);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not create the signature.';
    } finally {
      this.creating = false;
    }
  }

  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    this.error = '';
    this.creating = true;
    try {
      const asset = await this.assets.createUploadedAsset(file, this.kind, { cleanupBackground: true });
      this.created.emit(asset);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not import the signature image.';
    } finally {
      this.creating = false;
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
