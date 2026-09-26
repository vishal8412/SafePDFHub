import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { WatermarkControlsComponent } from '../../tools/watermark/watermark-controls.component';
import type { PdfWatermarkRequest } from '../../../core/watermark/pdf-watermark.types';

@Component({
  selector: 'app-studio-watermark-dialog',
  standalone: true,
  imports: [WatermarkControlsComponent],
  templateUrl: './studio-watermark-dialog.component.html',
  styleUrl: './studio-watermark-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudioWatermarkDialogComponent {
  @Input() pageCount = 0;
  @Input() fileName = '';
  @Input() busy = false;
  @Input() errorMessage: string | null = null;

  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly applied = new EventEmitter<PdfWatermarkRequest>();
}
