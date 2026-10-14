import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  inject,
  ChangeDetectorRef,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { OperationResultComponent } from "../../../shared/components/operation-result/operation-result.component";
import { LoaderService } from "../../../shared/services/loader.service";
import {
  WordDirectPdfService,
  WordPdfResult,
} from "../../../core/word-to-pdf/word-direct-pdf.service";
@Component({
  selector: "app-word-to-pdf-workspace",
  standalone: true,
  imports: [CommonModule, OperationResultComponent],
  templateUrl: "./word-to-pdf-workspace.component.html",
  styleUrls: [
    "../word/word-workspace.component.scss",
    "./word-to-pdf-workspace.component.scss",
  ],
})
export class WordToPdfWorkspaceComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) file!: File;
  @Output() replaceFile = new EventEmitter<void>();
  private engine = inject(WordDirectPdfService);
  private loader = inject(LoaderService);
  private cd = inject(ChangeDetectorRef);
  private controller?: AbortController;
  private release?: () => void;
  private generation = 0;
  busy = false;
  error = "";
  status = "";
  result: WordPdfResult | null = null;
  get size() {
    return `${(this.file.size / 1_000_000).toFixed(2)} MB`;
  }
  ngOnChanges() {
    this.reset();
  }
  private reset() {
    this.generation++;
    this.controller?.abort();
    this.release?.();
    this.release = undefined;
    this.result = null;
    this.busy = false;
    this.error = "";
    this.status = "";
  }
  cancel() {
    this.reset();
    this.status = "Conversion cancelled. Your Word file is unchanged.";
    this.cd.markForCheck();
  }
  async convert() {
    if (this.busy) return;
    this.reset();
    const id = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.busy = true;
    this.loader.show("Converting Word to PDF…", { determinate: true });
    this.loader.setIndeterminate();
    const unregister = this.loader.registerCancellationHandler(() =>
      this.cancel(),
    );
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      unregister();
      this.loader.hide();
    };
    this.release = release;
    try {
      const result = await this.engine.convert(
        this.file,
        controller.signal,
        (message) => {
          if (id === this.generation) {
            this.status = message;
            this.loader.setText(message);
            this.cd.markForCheck();
          }
        },
      );
      if (id === this.generation) this.result = result;
    } catch (e) {
      if (id === this.generation)
        this.error =
          e instanceof Error ? e.message : "Unable to convert this document.";
    } finally {
      release();
      if (id === this.generation) {
        this.busy = false;
        this.cd.markForCheck();
      }
    }
  }
  download() {
    if (!this.result) return;
    const url = URL.createObjectURL(this.result.file);
    const link = document.createElement("a");
    link.href = url;
    link.download = this.result.file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  ngOnDestroy() {
    this.reset();
  }
}
