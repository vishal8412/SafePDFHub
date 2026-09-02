import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';

import type {
  PDFDocumentProxy
} from 'pdfjs-dist';

import {
  ThumbnailService
} from '../../services/thumbnail.service';


@Component({
  selector:
    'app-studio-page-thumbnail',
  standalone: true,
  templateUrl:
    './studio-page-thumbnail.html',
  styleUrl:
    './studio-page-thumbnail.scss',
  changeDetection:
    ChangeDetectionStrategy.OnPush
})
export class StudioPageThumbnail
  implements
    AfterViewInit,
    OnChanges,
    OnDestroy {

  private readonly thumbnailService =
    inject(ThumbnailService);


  @Input({
    required: true
  })
  pageNumber!: number;


  @Input()
  selected = false;


  @Input()
  pdf: PDFDocumentProxy | null = null;


  @Output()
  readonly pageSelected =
    new EventEmitter<number>();


  @ViewChild('canvas', {
    static: true
  })
  private readonly canvasRef?:
    ElementRef<HTMLCanvasElement>;


  private viewReady = false;

  private renderToken = 0;

  loading = false;

  loaded = false;

  failed = false;


  ngAfterViewInit(): void {

    this.viewReady = true;

    this.renderIfPossible();

  }


  ngOnChanges(
    changes: SimpleChanges
  ): void {

    if (
      changes['pdf'] ||
      changes['pageNumber']
    ) {

      this.renderToken++;

      this.loaded = false;
      this.failed = false;

      if (
        this.viewReady
      ) {
        this.renderIfPossible();
      }
    }
  }


  ngOnDestroy(): void {

    const canvas =
      this.canvasRef?.nativeElement;

    if (!canvas) {
      return;
    }

    this.renderToken++;

    this.thumbnailService.clear(
      canvas
    );
  }


  onSelect(): void {

    this.pageSelected.emit(
      this.pageNumber
    );
  }


  private renderIfPossible(): void {

    const pdf = this.pdf;

    const canvas =
      this.canvasRef?.nativeElement;

    if (
      !pdf ||
      !canvas
    ) {
      return;
    }


    const token =
      ++this.renderToken;


    this.loading = true;
    this.failed = false;


    void this.render(
      pdf,
      canvas,
      token
    );
  }


  private async render(
    pdf: PDFDocumentProxy,
    canvas: HTMLCanvasElement,
    token: number
  ): Promise<void> {

    try {

      await this.thumbnailService
        .renderThumbnail(
          pdf,
          this.pageNumber,
          canvas
        );


      if (
        token !== this.renderToken
      ) {
        return;
      }


      this.loading = false;
      this.loaded = true;
      this.failed = false;

    } catch {

      if (
        token !== this.renderToken
      ) {
        return;
      }


      this.loading = false;
      this.loaded = false;
      this.failed = true;
    }
  }
}