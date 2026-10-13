import type { StudioTextObject } from "../models/studio-selection.model";

export interface PageNumberOptions {
  from: number;
  to: number;
  start: number;
  size: number;
  margin: number;
  position:
    | "top-left"
    | "top-center"
    | "top-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";
  format: "number" | "page" | "total";
  color: string;
}
export function validatePageNumbers(o: PageNumberOptions, count: number): void {
  if (
    ![o.from, o.to, o.start].every(Number.isSafeInteger) ||
    o.from < 1 ||
    o.to < o.from ||
    o.to > count ||
    o.start < 0 ||
    o.start + o.to - o.from > 999999
  )
    throw new Error(
      "Enter a valid page range and a starting number from 0 to 999999.",
    );
  if (
    !Number.isFinite(o.size) ||
    o.size < 8 ||
    o.size > 36 ||
    !Number.isFinite(o.margin) ||
    o.margin < 8 ||
    o.margin > 72
  )
    throw new Error("Use a font size of 8–36 pt and a margin of 8–72 pt.");
  if (
    !/^(top|bottom)-(left|center|right)$/.test(o.position) ||
    !["number", "page", "total"].includes(o.format) ||
    !/^#[0-9a-f]{6}$/i.test(o.color)
  )
    throw new Error("Choose a valid position, format and color.");
}
export function pageNumberText(o: PageNumberOptions, page: number): string {
  const n = o.start + page - o.from;
  return o.format === "page"
    ? `Page ${n}`
    : o.format === "total"
      ? `${n} / ${o.start + o.to - o.from}`
      : String(n);
}
export function pageNumberObject(
  o: PageNumberOptions,
  page: number,
  width: number,
  height: number,
  id: string,
): StudioTextObject {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0))
    throw new Error(`Cannot determine the size of page ${page}.`);
  const text = pageNumberText(o, page);
  const boxHeight = o.size * 1.6;
  if (
    width - 2 * o.margin < text.length * o.size * 0.6 ||
    height < 2 * o.margin + boxHeight
  )
    throw new Error(
      `Page ${page} is too small for these settings. Reduce the font size or margin.`,
    );
  return {
    id,
    type: "text",
    pageNumber: page,
    generatedPageNumber: true,
    text,
    bounds: {
      x: o.margin / width,
      y: o.position.startsWith("top")
        ? o.margin / height
        : 1 - (o.margin + boxHeight) / height,
      width: 1 - (2 * o.margin) / width,
      height: boxHeight / height,
    },
    textStyle: {
      fontSize: o.size / height,
      fontFamily: "Helvetica",
      fontWeight: 400,
      fontStyle: "normal",
      textAlign: o.position.endsWith("left")
        ? "left"
        : o.position.endsWith("right")
          ? "right"
          : "center",
      color: o.color,
      lineHeight: 1.2,
      letterSpacing: 0,
    },
  };
}

/** Bounded PDF.js metadata reads; cache follows the source PDF's lifetime. */
export class PageNumberBuilder {
  private readonly dimensions = new WeakMap<
    object,
    Map<number, Promise<{ width: number; height: number }>>
  >();
  async build(
    pdf: {
      getPage(
        n: number,
      ): Promise<{
        userUnit: number;
        rotate: number;
        getViewport(o: { scale: number; rotation: number }): {
          width: number;
          height: number;
        };
      }>;
    },
    pages: readonly import("../models/studio-page.model").StudioPage[],
    options: PageNumberOptions,
    signal?: AbortSignal,
    progress: (done: number, total: number) => void = () => {},
  ): Promise<StudioTextObject[]> {
    validatePageNumbers(options, pages.length);
    let cache = this.dimensions.get(pdf);
    if (!cache) {
      cache = new Map();
      this.dimensions.set(pdf, cache);
    }
    const output: StudioTextObject[] = [];
    const total = options.to - options.from + 1;
    const check = () => {
      if (signal?.aborted)
        throw new DOMException("Page numbering cancelled.", "AbortError");
    };
    progress(0, total);
    // Sixteen concurrent metadata requests avoid both serial worker round trips
    // and allocating tens of thousands of unresolved promises.
    for (let offset = 0; offset < total; offset += 16) {
      check();
      const batch = await Promise.all(
        Array.from({ length: Math.min(16, total - offset) }, async (_, i) => {
          const pageNumber = options.from + offset + i,
            page = pages[pageNumber - 1];
          let size: { width: number; height: number };
          if (page.kind === "blank")
            size = {
              width: page.blankWidth ?? 595.28,
              height: page.blankHeight ?? 841.89,
            };
          else {
            const source = page.sourcePageNumber;
            if (source === null)
              throw new Error(`Cannot read PDF page ${pageNumber}.`);
            let pending = cache!.get(source);
            if (!pending) {
              pending = pdf
                .getPage(source)
                .then((p) =>
                  p.getViewport({
                    scale: 1 / (p.userUnit || 1),
                    rotation: p.rotate,
                  }),
                );
              cache!.set(source, pending);
              pending.catch(() => cache!.delete(source));
            }
            size = await pending;
          }
          check();
          const rotated = page.rotation === 90 || page.rotation === 270;
          return pageNumberObject(
            options,
            pageNumber,
            rotated ? size.height : size.width,
            rotated ? size.width : size.height,
            `page-number-${page.id}`,
          );
        }),
      );
      output.push(...batch);
      progress(output.length, total);
      // Yield periodically, including cached reapply, so Cancel and paint work.
      if (offset % 256 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    check();
    return output;
  }
}
