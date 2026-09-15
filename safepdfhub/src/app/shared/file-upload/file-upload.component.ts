import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LocalProcessingCapabilityService } from '../../core/capacity/local-processing-capability.service';
import { PdfValidationService } from '../../core/capacity/pdf-validation.service';

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-upload.component.html',
  styleUrls: ['./file-upload.component.scss']
})
export class FileUploadComponent {

  @Input() allowMultiple = true;
  @Output() filesSelected = new EventEmitter<File[]>();

  files: File[] = [];
  isDragging = false;

  constructor(
    readonly capabilityService: LocalProcessingCapabilityService,
    private readonly pdfValidation: PdfValidationService
  ) {}

  get maxFileMB(): number {
    return Math.round(this.capabilityService.budget.maxFileBytes / (1024 * 1024));
  }

  get maxTotalMB(): number {
    return Math.round(this.capabilityService.budget.maxTotalBytes / (1024 * 1024));
  }

  onFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const selected = Array.from(input.files || []);
    this.handleFiles(selected);
    input.value = '';
  }

  allowDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging = true;
  }

  onLeave() {
    this.isDragging = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging = false;
    const dropped = Array.from(event.dataTransfer?.files || []);
    this.handleFiles(dropped);
  }

  handleFiles(newFiles: File[]) {
    const accepted: File[] = [];

    for (const file of newFiles) {
      const result = this.pdfValidation.validateSelection(
        file,
        [...this.files, ...accepted],
        this.allowMultiple
      );

      if (!result.valid) {
        if (result.message) alert(`❌ ${result.message}`);
        continue;
      }

      accepted.push(file);
    }

    if (!accepted.length) return;

    this.files = [...this.files, ...accepted];
    this.filesSelected.emit(this.files);
  }

  removeFile(index: number) {
    this.files = this.files.filter((_, i) => i !== index);
    this.filesSelected.emit(this.files);
  }

  clearAll() {
    this.files = [];
    this.filesSelected.emit(this.files);
  }
}
