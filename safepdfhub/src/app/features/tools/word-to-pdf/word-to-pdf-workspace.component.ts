import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  inject,
  ChangeDetectorRef,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { OperationResultComponent } from '../../../shared/components/operation-result/operation-result.component';
import { LoaderService } from '../../../shared/services/loader.service';
import { WordToPdfService, WordPreview } from '../../../core/word-to-pdf/word-to-pdf.service';
import { WordExportCheckService, WordExportCheck } from '../../../core/word-to-pdf/word-export-check.service';
@Component({
  selector: 'app-word-to-pdf-workspace',
  standalone: true,
  imports: [CommonModule, OperationResultComponent],
  templateUrl: './word-to-pdf-workspace.component.html',
  styleUrls: ['../word/word-workspace.component.scss', './word-to-pdf-workspace.component.scss'],
})
export class WordToPdfWorkspaceComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) file!: File;
  @Output() replaceFile = new EventEmitter<void>();
  @ViewChild('previewHost', { static: true }) host!: ElementRef<HTMLDivElement>;
  private engine = inject(WordToPdfService);
  private exportChecker = inject(WordExportCheckService);
  private checkController?: AbortController;
  exportCheck: WordExportCheck | null = null;
  checkingExport = false;
  exportError = '';
  private loader = inject(LoaderService);
  private cd = inject(ChangeDetectorRef);
  private controller?: AbortController;
  private release?: () => void;
  private generation = 0;
  private frame?: HTMLIFrameElement;
  busy = false;
  error = '';
  result: WordPreview | null = null;
  printOpened = false;
  reviewed = false;
  get size() {
    return `${(this.file.size / 1_000_000).toFixed(2)} MB`;
  }
  ngOnChanges() {
    this.reset();
  }
  private reset() {
    this.generation++;
    this.checkController?.abort();
    this.exportCheck = null;
    this.checkingExport = false;
    this.exportError = '';
    this.controller?.abort();
    this.release?.();
    this.result?.dispose();
    this.frame?.remove();
    this.frame = undefined;
    this.result = null;
    this.busy = false;
    this.error = '';
    this.reviewed = false;
    this.printOpened = false;
  }
  async convert() {
    if (this.busy) return;
    this.reset();
    const id = this.generation;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const frame = document.createElement('iframe');
    frame.title = 'Local Word document preview';
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.style.cssText = 'width:100%;height:760px;border:0;background:white';
    this.host.nativeElement.append(frame);
    this.frame = frame;
    this.busy = true;
    this.loader.show('Checking your Word document…', { determinate: true });
    this.loader.setIndeterminate();
    const unregister = this.loader.registerCancellationHandler(() => {
      this.generation++;
      this.controller?.abort();
      this.frame?.remove();
      this.busy = false;
      this.error = 'Preview cancelled. You can try again.';
      release();
      this.cd.markForCheck();
    });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      unregister();
      this.loader.hide();
    };
    this.release = release;
    try {
      const result = await this.engine.preview(this.file, frame, signal, (message) => {
        if (id === this.generation) this.loader.setText(message);
      });
      if (id === this.generation) this.result = result;
      else result.dispose();
    } catch (e) {
      if (id === this.generation)
        this.error =
          (e as Error).name === 'AbortError'
            ? 'Preview cancelled. You can try again.'
            : (e as Error).message || 'Unable to preview this document.';
    } finally {
      release();
      if (id === this.generation) {
        this.busy = false;
        this.cd.markForCheck();
      }
    }
  }
  print() {
    if (!this.result || !this.reviewed || !this.frame?.contentWindow) return;
    try {
      this.frame.contentWindow.focus();
      this.frame.contentWindow.print();
      this.printOpened = true;
    } catch {
      this.error =
        'Printing is unavailable in this browser. Try a desktop browser with Save as PDF support.';
    }
  }
  async checkExport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.result || this.checkingExport) return;
    const id = this.generation;
    const controller = new AbortController();
    this.checkController = controller;
    this.checkingExport = true;
    this.exportCheck = null;
    this.exportError = '';
    this.loader.show('Checking saved PDF…', { determinate: true });
    const unregister = this.loader.registerCancellationHandler(() => controller.abort());
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      unregister();
      this.loader.hide();
    };
    this.release = release;
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const checked = await this.exportChecker.check(file, this.result, controller.signal, (page, total) => {
        if (id === this.generation) this.loader.setPage(page, total);
      });
      if (id === this.generation) this.exportCheck = checked;
    } catch {
      if (id === this.generation) this.exportError = controller.signal.aborted
        ? 'Check cancelled or timed out. Your files have not been changed.'
        : 'The PDF could not be checked. Choose an unencrypted PDF saved from this document.';
    } finally {
      clearTimeout(timeout);
      release();
      if (id === this.generation) {
        this.checkingExport = false;
        this.cd.markForCheck();
      }
    }
  }
  ngOnDestroy() {
    this.reset();
  }
}
