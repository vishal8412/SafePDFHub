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


  /**
   * Logical Studio page position shown to the user.
   *
   * This is intentionally separate from sourcePageNumber because
   * duplicate / move / blank-page operations can change logical
   * positions without changing the original PDF source page.
   */
  @Input({
    required: true
  })
  displayPageNumber!: number;


  /**
   * Original PDF page used for thumbnail rendering.
   *
   * Null means this is a Studio-created blank page.
   */
  @Input()
  sourcePageNumber: number | null = null;


  @Input()
  rotation: 0 | 90 | 180 | 270 = 0;


  @Input()
  blank = false;


  @Input()
  selected = false;


  @Input()
  pdf: PDFDocumentProxy | null = null;


  @Output()
  readonly pageSelected =
    new EventEmitter<number>();


  @ViewChild('canvas')
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
      changes['sourcePageNumber'] ||
      changes['displayPageNumber'] ||
      changes['blank'] ||
      changes['rotation']
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

    this.renderToken++;

    const canvas =
      this.canvasRef?.nativeElement;

    if (
      canvas
    ) {
      this.thumbnailService.clear(
        canvas
      );
    }
  }


  onSelect(): void {

    this.pageSelected.emit(
      this.displayPageNumber
    );
  }


  private renderIfPossible(): void {

    /**
     * Blank Studio pages do not have a PDF source page to render.
     * Do not attempt to render source page 0.
     */
    if (
      this.blank
    ) {
      this.loading = false;
      this.loaded = true;
      this.failed = false;
      return;
    }


    const pdf =
      this.pdf;

    const canvas =
      this.canvasRef?.nativeElement;

    const sourcePageNumber =
      this.sourcePageNumber;


    if (
      !pdf ||
      !canvas ||
      !sourcePageNumber ||
      sourcePageNumber < 1 ||
      sourcePageNumber > pdf.numPages
    ) {
      this.loading = false;
      this.loaded = false;
      this.failed = true;
      return;
    }


    const token =
      ++this.renderToken;


    this.loading = true;
    this.loaded = false;
    this.failed = false;


    void this.render(
      pdf,
      sourcePageNumber,
      canvas,
      token
    );
  }


  private async render(
    pdf: PDFDocumentProxy,
    sourcePageNumber: number,
    canvas: HTMLCanvasElement,
    token: number
  ): Promise<void> {

    try {

      await this.thumbnailService
        .renderThumbnail(
          pdf,
          sourcePageNumber,
          canvas,
          168,
          this.rotation
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
