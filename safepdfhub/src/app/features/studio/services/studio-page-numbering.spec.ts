import {
  PageNumberBuilder,
  pageNumberObject,
  pageNumberText,
  validatePageNumbers,
  type PageNumberOptions,
} from "./studio-page-numbering";
import { TestBed } from "@angular/core/testing";
import { PLATFORM_ID } from "@angular/core";
import {
  PDFDocument,
  degrees,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { StudioPdfExportService } from "./studio-pdf-export.service";
import { QpdfWasmPrototypeService } from "../../../core/qpdf/qpdf-wasm-prototype.service";
import { SigningPdfTextService } from "../../../core/signing/services/signing-pdf-text.service";

const options: PageNumberOptions = {
  from: 2,
  to: 3,
  start: 1,
  size: 12,
  margin: 24,
  position: "bottom-center",
  format: "page",
  color: "#101820",
};
describe("Studio page numbering", () => {
  it("skips the cover and starts at the requested number", () => {
    validatePageNumbers(options, 3);
    expect(pageNumberText(options, 2)).toBe("Page 1");
    expect(pageNumberText({ ...options, format: "total" }, 3)).toBe("2 / 2");
    expect(pageNumberText({ ...options, start: 10, format: "total" }, 3)).toBe(
      "11 / 11",
    );
  });
  it("rejects invalid ranges, nonfinite settings and tiny pages", () => {
    for (const patch of [
      { from: 0 },
      { to: 4 },
      { from: 3, to: 2 },
      { start: 1.5 },
      { size: NaN },
      { margin: Infinity },
    ])
      expect(() => validatePageNumbers({ ...options, ...patch }, 3)).toThrow();
    expect(() => pageNumberObject(options, 2, 40, 40, "x")).toThrow();
  });
  it("keeps margins and font size constant across page orientations", () => {
    for (const [w, h] of [
      [600, 800],
      [800, 600],
    ]) {
      const object = pageNumberObject(options, 2, w, h, "x");
      expect(object.bounds.x * w).toBeCloseTo(24);
      expect((1 - object.bounds.y - object.bounds.height) * h).toBeCloseTo(24);
      expect(object.textStyle.fontSize * h).toBeCloseTo(12);
    }
  });
  it("writes actual page-number text into exported PDF streams on rotated pages", async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: "browser" },
        { provide: QpdfWasmPrototypeService, useValue: {} },
        { provide: SigningPdfTextService, useValue: {} },
      ],
    });
    const service = TestBed.inject(StudioPdfExportService);
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    doc.addPage([600, 800]).setRotation(degrees(90));
    doc.addPage([600, 800]);
    const bytes = await doc.save();
    const result = await service.exportTextObjects(
      { arrayBuffer: async () => bytes.slice().buffer } as File,
      [
        pageNumberObject({ ...options, color: "#ff0000" }, 2, 800, 600, "a"),
        pageNumberObject({ ...options, color: "#2563eb" }, 3, 600, 800, "b"),
      ],
    );
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(result);
    });
    const exported = await PDFDocument.load(buffer);
    const streams = exported.getPages().map((page) => {
      const contents = page.node.Contents();
      const list =
        contents instanceof PDFArray
          ? contents.asArray()
          : contents
            ? [contents]
            : [];
      return list
        .map((ref) => {
          const stream = exported.context.lookup(ref);
          return stream instanceof PDFRawStream
            ? new TextDecoder().decode(decodePDFRawStream(stream).decode())
            : "";
        })
        .join("");
    });
    expect(streams[0]).not.toContain("506167652031");
    expect(streams[1]).toContain("506167652031");
    expect(streams[1]).toContain("1 0 0 rg");
    expect(streams[2]).toContain("0.145098");
    expect(streams[2]).toContain("506167652032");
    expect(exported.getPage(1).getRotation().angle).toBe(90);
  });
});

import { vi } from "vitest";
import { StudioObjectService } from "./studio-object.service";
import type { StudioPage } from "../models/studio-page.model";
const pages = (count: number): StudioPage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    kind: "source",
    sourcePageNumber: i + 1,
    rotation: 0,
  }));
describe("Page numbering batch reliability", () => {
  it("bounds metadata concurrency and reuses it across reapply and page rotation", async () => {
    let active = 0,
      peak = 0;
    const getPage = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return {
        userUnit: 2,
        rotate: 0,
        getViewport: ({ scale }: { scale: number }) => ({
          width: 1200 * scale,
          height: 1600 * scale,
        }),
      };
    });
    const pdf = { getPage },
      builder = new PageNumberBuilder(),
      manifest = pages(65);
    const result = await builder.build(pdf, manifest, {
      ...options,
      from: 1,
      to: 65,
    });
    expect(getPage).toHaveBeenCalledTimes(65);
    expect(peak).toBeLessThanOrEqual(16);
    expect(peak).toBeGreaterThan(1);
    expect(result[0].textStyle.fontSize).toBeCloseTo(12 / 800);
    manifest[0] = { ...manifest[0], rotation: 90 };
    const again = await builder.build(pdf, manifest, {
      ...options,
      from: 1,
      to: 65,
      color: "#ff0000",
    });
    expect(getPage).toHaveBeenCalledTimes(65);
    expect(again[0].textStyle.fontSize).toBeCloseTo(12 / 600);
    expect(again[0].textStyle.color).toBe("#ff0000");
  });
  it("cancels before a complete result and does not keep failed metadata", async () => {
    const controller = new AbortController(),
      builder = new PageNumberBuilder();
    const pdf = {
      getPage: vi.fn(async () => ({
        userUnit: 1,
        rotate: 0,
        getViewport: () => ({ width: 600, height: 800 }),
      })),
    };
    await expect(
      builder.build(
        pdf,
        pages(100),
        { ...options, from: 1, to: 100 },
        controller.signal,
        (done) => {
          if (done >= 16) controller.abort();
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(pdf.getPage).toHaveBeenCalledTimes(16);
    const flaky = {
      getPage: vi
        .fn()
        .mockRejectedValueOnce(new Error("Read failed"))
        .mockResolvedValue({
          userUnit: 1,
          rotate: 0,
          getViewport: () => ({ width: 600, height: 800 }),
        }),
    };
    await expect(
      builder.build(flaky, pages(1), { ...options, from: 1, to: 1 }),
    ).rejects.toThrow("Read failed");
    expect(
      await builder.build(flaky, pages(1), { ...options, from: 1, to: 1 }),
    ).toHaveLength(1);
  });
  it("replaces a numbered range atomically without deleting other text", () => {
    const service = new StudioObjectService();
    const regular = {
      ...pageNumberObject(options, 2, 600, 800, "regular"),
      generatedPageNumber: undefined,
      text: "Keep me",
    };
    service.add(regular);
    service.replacePageNumbers([pageNumberObject(options, 2, 600, 800, "old")]);
    const revision = service.changes();
    service.replacePageNumbers([
      pageNumberObject({ ...options, color: "#ff0000" }, 3, 600, 800, "new"),
    ]);
    expect(service.changes()).toBe(revision + 1);
    expect(service.snapshot().map((o) => o.id)).toEqual(["regular", "new"]);
    expect(service.get("new")?.textStyle?.color).toBe("#ff0000");
  });
});
