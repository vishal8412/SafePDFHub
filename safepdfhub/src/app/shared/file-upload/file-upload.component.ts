import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-upload.component.html',
  styleUrls: ['./file-upload.component.scss']
})
export class FileUploadComponent {

  @Output() filesSelected = new EventEmitter<File[]>();

  MAX_FILE_MB = 50;
  MAX_TOTAL_MB = 200;

  files: File[] = [];
  isDragging = false;

  // =============================
  // SELECT FILE (STRICT TYPING)
  // =============================
  onFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const selected = Array.from(input.files || []);
    this.handleFiles(selected);
    input.value = '';
  }

  // =============================
  // DRAG & DROP
  // =============================
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

  // =============================
  // VALIDATION + ADD FILES
  // =============================
  handleFiles(newFiles: File[]) {
    let validFiles: File[] = [];
    let next = [...this.files];

    for (const file of newFiles) {

      // ✅ only PDF
      if (file.type !== 'application/pdf') {
        alert(`❌ ${file.name} is not a PDF`);
        continue;
      }

      // ✅ prevent duplicate
      const alreadyExists = next.some(f =>
        f.name === file.name && f.size === file.size
      );
      if (alreadyExists) continue;

      const sizeMB = file.size / (1024 * 1024);

      // ✅ per file limit
      if (sizeMB > this.MAX_FILE_MB) {
        alert(`❌ ${file.name} exceeds ${this.MAX_FILE_MB} MB`);
        continue;
      }

      next.push(file);
      validFiles.push(file);
    }

    // ✅ total size limit
    const totalSize =
      next.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024);

    if (totalSize > this.MAX_TOTAL_MB) {
      alert(`❌ Total size exceeds ${this.MAX_TOTAL_MB} MB`);
      return;
    }

    // ✅ update state
    this.files = next;

    // ✅ emit only if something added
    if (validFiles.length > 0) {
      this.filesSelected.emit(this.files);
    }
  }

  // =============================
  // REMOVE FILE
  // =============================
  removeFile(index: number) {
    this.files = this.files.filter((_, i) => i !== index);
    this.filesSelected.emit(this.files);
  }

  // =============================
  // CLEAR ALL (VERY IMPORTANT)
  // =============================
  clearAll() {
    this.files = [];
    this.filesSelected.emit(this.files);
  }
}