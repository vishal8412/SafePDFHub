import { Component, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SplitMode } from '../../../../core/split/split.types';
import { FormsModule } from '@angular/forms';

export interface SplitRequest {
  mode:
  | 'range'
  | 'every-page'
  | 'every-n'
  | 'extract';

  ranges?: string;
  everyN?: number;
  pages?: number[];
}

@Component({
  selector: 'app-split-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './split-workspace.component.html',
  styleUrls: ['./split-workspace.component.scss']
})

export class SplitWorkspaceComponent {

  @Input() fileName = '';
  @Input() pageCount = 0;
  @Input() fileSize = '';
  @Input() resultFiles = 0;
  @Input() resultMode = '';
  @Input() resultDuration = '';
  @Input() showResult = false;
  @Input() generatedFiles: File[] = [];

  mode: SplitMode = 'range';
  pageRanges = '';
  everyN = 2;
  selectedPages = '';
  // showAllFiles = false;
  currentPage = 1;
  pageSize = 10;
  private _searchTerm = '';

  @Output() changePdf = new EventEmitter<void>();
  @Output() split = new EventEmitter<SplitRequest>();
  @Output() downloadZip = new EventEmitter<void>();
  @Output() continueTool = new EventEmitter<string>();

  onReplace() {
    this.changePdf.emit();
    requestAnimationFrame(() => {
      window.scrollTo({top: 0,behavior: 'smooth'});
   });
  }

  get estimatedFiles(): number {
    switch (this.mode) {
      case 'range': return this.pageRanges ? this.pageRanges.split(',').length : 1;
      case 'every-page': return this.pageCount;
      case 'every-n': return Math.ceil(this.pageCount / this.everyN);
      case 'extract': return this.selectedPages ? 1 : 1;
      default: return 1;
    }
  }

  get recommendedMode(): string {
    if (this.pageCount <= 20)
      return 'Extract';

    if (this.pageCount <= 100)
      return 'Range';

    return 'Every N';
  }

  get avgPagesPerFile(): number {
    if (!this.estimatedFiles)
      return 0;

    return Math.ceil(this.pageCount / this.estimatedFiles);
  }

  get recommendationText(): string {
    switch (this.recommendedMode) {
      case 'Extract':
        return 'Small document. Extract specific pages quickly.';
      case 'Range':
        return 'Medium document. Range split gives better control.';
      case 'Every N':
        return 'Large document detected. Splitting every N pages is recommended.';
      default:
        return '';
    }
  }

  get actionLabel(): string {
    switch (this.mode) {
      case 'extract':
        return '🎯 Extract Pages';
      case 'every-page':
        return '📄 Split Pages';
      default:
        return '✂️ Split PDF';
    }
  }

  get generatedPreview(): string[] {
    switch (this.mode) {
      case 'range':
        if (!this.pageRanges)
          return [];
        return this.pageRanges.split(',').map((range, index) => `PDF ${index + 1} → Pages ${range.trim()}`);

      case 'every-page':
        return Array.from({ length: Math.min(this.pageCount, 5) }, (_, i) => `PDF ${i + 1} → Page ${i + 1}`);

      case 'every-n':
        const result: string[] = [];
        let pdfIndex = 1;
        for (let start = 1; start <= this.pageCount; start += this.everyN) {
          const end = Math.min(start + this.everyN - 1, this.pageCount);
          result.push(`PDF ${pdfIndex++} → Pages ${start}-${end}`);
          if (result.length >= 5)
            break;
        }
        return result;

      case 'extract':
        if (!this.selectedPages)
          return [];
        return [`Extracted Pages → ${this.selectedPages}`];

      default:
        return [];
    }

  }

  get smartSuggestions(): string[] {
    if (this.pageCount < 50)
      return [];

    return [
      '1-25,26-50',
      '1-50,51-100',
      '1-100,101-200'
    ];
  }

  get estimatedOutputSize(): string {
    if (!this.estimatedFiles)
      return '0 MB';

    const size = parseFloat(this.fileSize);
    if (isNaN(size))
      return '-';

    return (size / this.estimatedFiles).toFixed(2) + ' MB avg';
  }

  get estimatedTime(): string {
    if (this.pageCount < 50)
      return '< 1 sec';

    if (this.pageCount < 200)
      return '1-3 sec';

    if (this.pageCount < 500)
      return '3-8 sec';

    return '10+ sec';
  }

  get memoryUsage(): string {
    if (this.pageCount < 50)
      return 'Low';

    if (this.pageCount < 200)
      return 'Medium';

    return 'High';
  }

  get rangeValidation(): string {
    if (this.mode !== 'range')
      return '';

    if (!this.pageRanges.trim())
      return 'Enter page ranges';

    const ranges = this.pageRanges.split(',');
    const usedPages = new Set<number>();

    for (const range of ranges) {
      const trimmed = range.trim();
      if (!trimmed)
        return 'Empty range detected';

      if (!/^\d+(-\d+)?$/.test(trimmed))
        return 'Invalid range format';

      const [startStr, endStr] = trimmed.split('-');
      const start = +startStr;
      const end = endStr ? +endStr : start;

      if (start < 1)
        return 'Page numbers start from 1';

      if (start > end)
        return `${trimmed} is invalid`;

      if (end > this.pageCount)
        return `Page ${end} exceeds document pages`;

      for (let p = start; p <= end; p++) {
        if (usedPages.has(p))
          return `Page ${p} used twice`;

        usedPages.add(p);
      }
    }

    return '';
  }

  get everyNValidation(): string {
    if (this.mode !== 'every-n')
      return '';

    if (!this.everyN)
      return 'Enter pages per file';

    if (this.everyN < 1)
      return 'Minimum value is 1';

    if (this.everyN > this.pageCount)
      return 'Cannot exceed total pages';

    return '';
  }

  get extractValidation(): string {
    if (this.mode !== 'extract')
      return '';

    if (!this.selectedPages.trim())
      return 'Enter pages';

    const pages = this.selectedPages.split(',');
    const used = new Set<number>();

    for (const item of pages) {
      const page = Number(item.trim());
      if (isNaN(page))
        return 'Only numbers allowed';

      if (page < 1)
        return 'Page numbers start from 1';

      if (page > this.pageCount)
        return `Page ${page} exceeds PDF`;

      if (used.has(page))
        return `Page ${page} selected twice`;

      used.add(page);
    }

    return '';
  }

  get canSplit(): boolean {
    switch (this.mode) {
      case 'range': return !this.rangeValidation;
      case 'every-n': return !this.everyNValidation;
      case 'extract': return !this.extractValidation;
      default: return true;
    }
  }

  get warningMessage(): string {
    if (this.mode === 'every-page' && this.pageCount > 50) {
      return `This will create ${this.pageCount} PDF files.`;
    }
    if (this.estimatedFiles > 100) {
      return `Large output detected (${this.estimatedFiles} files).`;
    }
    return '';
  }

  get showIndividualFiles() {
    return this.generatedFiles.length <= 50;
  }

  get paginatedFiles(): File[] {
   const start = (this.currentPage - 1) * this.pageSize;
   return this.filteredFiles.slice(start,start + this.pageSize);
  }

  get totalPages(): number {
   return Math.ceil(this.filteredFiles.length / this.pageSize);
  }

  get searchTerm(): string {
    return this._searchTerm;
  }

  set searchTerm(value: string) {
    this._searchTerm = value;
    this.currentPage = 1;
  }

  get filteredFiles(): File[] {
   if (!this.searchTerm.trim()) {
     return this.generatedFiles;
   }
   return this.generatedFiles.filter(file => file.name.toLowerCase().includes(this.searchTerm.toLowerCase()));
  }

  applyRecommendedMode(): void {
    switch (this.recommendedMode) {
      case 'Range':
        this.mode = 'range';
        break;
      case 'Every N':
        this.mode = 'every-n';
        this.everyN = 25;
        break;
      case 'Extract':
        this.mode = 'extract';
        break;
    }
  }

  onSplit(): void {
    if (!this.canSplit)
      return;

    this.split.emit({
      mode: this.mode,
      ranges: this.pageRanges,
      everyN: this.everyN,
      pages: this.selectedPages.split(',').map(x => Number(x.trim()))
    });

  }

  downloadFile(file: File): void {
   const url = URL.createObjectURL(file);
   const a = document.createElement('a');
   a.href = url;
   a.download = file.name;
   a.click();
   setTimeout(() => {
     URL.revokeObjectURL(url);
   }, 3000);
  }

  downloadAllAgain() {
    this.downloadZip.emit();
  }

  trackByFileName(index: number,file: File) {
    return file.name;
  }

  continueWork(tool:string) {
   this.continueTool.emit(tool);
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

}