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


  /**
   * The thumbnail canvas is conditionally created by the template.
   *
   * A setter is used instead of relying only on ngAfterViewInit because
   * a page can transition from blank -> PDF-backed after the component
   * has already been initialized.
   */
  private canvasRef?:
    ElementRef<HTMLCanvasElement>;


  @ViewChild('canvas')
  set thumbnailCanvas(
    value:
      | ElementRef<HTMLCanvasElement>
      | undefined
  ) {

    this.canvasRef =
      value;


    /**
     * The canvas can be created after a blank -> normal page transition.
     *
     * In that case ngOnChanges may have run before the new canvas existed,
     * so rendering must be retried when Angular provides the canvas.
     */
    if (
      value &&
      this.viewReady &&
      !this.blank
    ) {

      this.renderIfPossible();
    }
  }


  private viewReady = false;


  /**
   * Invalidates stale asynchronous thumbnail renders.
   */
  private renderToken = 0;


  loading = false;

  loaded = false;

  failed = false;


  ngAfterViewInit(): void {

    this.viewReady =
      true;


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

      /**
       * Invalidate all older asynchronous renders before changing
       * thumbnail state.
       */
      this.renderToken++;


      /**
       * A thumbnail canvas belongs to this component.
       *
       * When the logical page changes, explicitly release the old
       * renderer task before starting a new render or transitioning
       * into a blank/invalid state.
       */
      this.releaseThumbnailCanvas();


      this.loading =
        false;

      this.loaded =
        false;

      this.failed =
        false;


      if (
        this.viewReady
      ) {

        this.renderIfPossible();
      }
    }
  }


  ngOnDestroy(): void {

    /**
     * Prevent late async render completion from updating this component.
     */
    this.renderToken++;


    /**
     * Explicitly cancel renderer ownership for this canvas.
     */
    this.releaseThumbnailCanvas();
  }


  onSelect(): void {

    this.pageSelected.emit(
      this.displayPageNumber
    );
  }


  /**
   * Releases the currently owned thumbnail canvas.
   *
   * This is intentionally local component lifecycle cleanup.
   */
  private releaseThumbnailCanvas(): void {

    const canvas =
      this.canvasRef?.nativeElement;


    if (
      !canvas
    ) {
      return;
    }


    this.thumbnailService.clear(
      canvas
    );
  }


  private renderIfPossible(): void {

    /**
     * Blank Studio pages do not have a PDF source page to render.
     *
     * The existing canvas render was already cancelled during the
     * input transition, so no renderer work remains for this page.
     */
    if (
      this.blank
    ) {

      this.loading =
        false;

      this.loaded =
        true;

      this.failed =
        false;

      return;
    }


    const pdf =
      this.pdf;


    const canvas =
      this.canvasRef?.nativeElement;


    const sourcePageNumber =
      this.sourcePageNumber;


    /**
     * A canvas can temporarily be unavailable during a blank -> normal
     * transition because Angular creates it conditionally.
     *
     * The ViewChild setter will call renderIfPossible() again once the
     * canvas becomes available.
     */
    if (
      !canvas
    ) {

      this.loading =
        false;

      this.loaded =
        false;

      this.failed =
        false;

      return;
    }


    if (
      !pdf ||
      !sourcePageNumber ||
      sourcePageNumber < 1 ||
      sourcePageNumber > pdf.numPages
    ) {

      /**
       * Explicitly release any existing render ownership before entering
       * the invalid thumbnail state.
       */
      this.releaseThumbnailCanvas();


      this.loading =
        false;

      this.loaded =
        false;

      this.failed =
        true;

      return;
    }


    /**
     * Every render receives a unique token.
     *
     * A late completion from an older render cannot overwrite the
     * current component state.
     */
    const token =
      ++this.renderToken;


    this.loading =
      true;

    this.loaded =
      false;

    this.failed =
      false;


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


      /**
       * Ignore stale asynchronous completions.
       */
      if (
        token !== this.renderToken
      ) {
        return;
      }


      this.loading =
        false;

      this.loaded =
        true;

      this.failed =
        false;

    } catch {

      /**
       * Ignore failures from stale/cancelled renders.
       */
      if (
        token !== this.renderToken
      ) {
        return;
      }


      this.loading =
        false;

      this.loaded =
        false;

      this.failed =
        true;
    }
  }
}