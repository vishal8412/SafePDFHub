import {
  Component,
  Input,
  Output,
  EventEmitter
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { OperationResultComponent } from '../../../../shared/components/operation-result/operation-result.component';

@Component({
  selector: 'app-compress-workspace',
  standalone: true,
  imports: [CommonModule, OperationResultComponent],
  templateUrl:
    './compress-workspace.component.html',
  styleUrls: [
    './compress-workspace.component.scss'
  ]
})
export class CompressWorkspaceComponent {

  @Input() files: File[] = [];
  @Input() previews: string[] = [];
  @Input() pageCounts: number[] = [];
  @Input() estimatedReduction = 0;
  @Input() estimatedFinalSize = 0;
  @Input() analyzedPdfType: 'text' | 'scanned' | null = null;
  @Input() pdfInsights: any = null;
  @Input() compressionLevel: 'light' | 'recommended' | 'strong' = 'recommended';
  @Input() loading = false;
  @Input() compressing = false;
  @Input() progress = 0;
  @Input() resultFile: File | null = null;
  @Input() originalFileName = '';
  @Input() durationMs = 0;

  @Output() compressionLevelChange = new EventEmitter<'light' | 'recommended' | 'strong'>();
  @Output() compress = new EventEmitter<void>();
  @Output() replaceFile = new EventEmitter<void>();
  @Output() smartTool = new EventEmitter<'split-pdf' | 'protect-pdf'>();
  @Output() downloadResult = new EventEmitter<void>();
  @Output() processAnother = new EventEmitter<void>();
  @Output() editAgain = new EventEmitter<void>();

  formatFileSize(bytes: number): string {
    const mb = bytes / 1024 / 1024;
    if (mb < 1) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return mb.toFixed(1) + ' MB';
  }

  selectLevel(
    level:
      'light'
      | 'recommended'
      | 'strong'
  ) {

    this.compressionLevelChange.emit(level);
  }

  startCompress() {
    if (this.loading) {
      return;
    }
    this.compress.emit();
  }

  triggerReplace() {
    this.replaceFile.emit();
  }

  openSmartTool(slug: 'split-pdf' | 'protect-pdf'): void {
    this.smartTool.emit(slug);
  }

}