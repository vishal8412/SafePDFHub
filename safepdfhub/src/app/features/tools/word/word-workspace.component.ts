import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import { LoaderService } from '../../../shared/services/loader.service';
import { OcrMode, OcrLanguage } from '../../../core/word/word-ocr';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { OperationResultComponent } from '../../../shared/components/operation-result/operation-result.component';
import { PdfToWordService, WordMode, WordResult } from '../../../core/word/pdf-to-word.service';
@Component({
  selector: 'app-word-workspace',
  standalone: true,
  imports: [CommonModule, RouterLink, OperationResultComponent],
  templateUrl: './word-workspace.component.html',
  styleUrl: './word-workspace.component.scss',
})
export class WordWorkspaceComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) file!: File;
  @Output() replaceFile = new EventEmitter<void>();
  private readonly engine = inject(PdfToWordService);
  private readonly loader = inject(LoaderService);
  private releaseLoader?: () => void;
  ocrMode: OcrMode = 'auto';
  ocrLanguage: OcrLanguage = '';
  private readonly cd = inject(ChangeDetectorRef);
  private abort: AbortController | null = null;
  private request = 0;
  mode: WordMode = 'editable';
  busy = false;
  percent = 0;
  message = '';
  error = '';
  result: WordResult | null = null;
  get limits() {
    return this.engine.limits;
  }
  get size() {
    const b = this.file.size;
    return b < 1000
      ? `${b} bytes`
      : b < 1_000_000
        ? `${(b / 1000).toFixed(2)} KB`
        : `${(b / 1_000_000).toFixed(2)} MB`;
  }
  get resultDescription() {
    return this.result
      ? `Converted ${this.result.pages} source ${this.result.pages === 1 ? 'page' : 'pages'} to DOCX. ${this.result.mode === 'appearance' ? 'Pages are images; their text is not editable.' : `${this.result.imagePages.length ? this.result.imagePages.length + ' source pages are images, not editable text. ' : ''}Review spacing, fonts, tables, and reading order in Word.`}`
      : '';
  }
  get imageNotice() {
    const pages = this.result?.imagePages ?? [];
    return `${pages.length} ${pages.length === 1 ? 'page was' : 'pages were'} preserved as images to keep the source content intact because OCR was disabled, recognition was uncertain, or tables/layout needed a visual fallback. Text on these pages is not editable. Pages: ${pages.slice(0, 20).join(', ')}${pages.length > 20 ? '…' : ''}.`;
  }
  ngOnChanges() {
    this.request++;
    this.abort?.abort();
    this.releaseLoader?.();
    this.busy = false;
    this.result = null;
    this.error = '';
    this.percent = 0;
  }
  async convert() {
    if (this.busy) return;
    const request = ++this.request;
    this.abort = new AbortController();
    this.busy = true;
    this.error = '';
    this.result = null;
    this.percent = 0;
    this.message = 'Reading your PDF…';
    this.loader.show(this.message, { determinate: true });
    const unregister = this.loader.registerCancellationHandler(() => this.cancel());
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      unregister();
      this.loader.hide();
    };
    this.releaseLoader = release;
    try {
      const result = await this.engine.convert(
        this.file,
        this.mode,
        this.abort.signal,
        (p) => {
          if (request !== this.request) return;
          this.percent = p.percent;
          this.message = p.message;
          this.loader.setText(p.message);
          this.loader.setProgress(p.percent);
          this.loader.setPage(p.page, p.totalPages);
          this.cd.markForCheck();
        },
        { mode: this.ocrMode, language: this.ocrLanguage },
      );
      if (request === this.request) this.result = result;
    } catch (e) {
      if (request === this.request)
        this.error =
          (e as Error)?.name === 'AbortError'
            ? 'Conversion cancelled. You can try again.'
            : (e as Error)?.message || 'Unable to convert this PDF. Try another file.';
    } finally {
      release();
      if (request === this.request) {
        this.busy = false;
        this.abort = null;
        this.cd.markForCheck();
      }
    }
  }
  cancel() {
    this.abort?.abort();
    this.message = 'Cancelling conversion…';
    this.loader.setText(this.message);
  }
  download() {
    if (!this.result) return;
    const url = URL.createObjectURL(this.result.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.result.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 300_000);
  }
  editAgain() {
    this.result = null;
    this.error = '';
  }
  ngOnDestroy() {
    this.request++;
    this.abort?.abort();
    this.releaseLoader?.();
  }
}
