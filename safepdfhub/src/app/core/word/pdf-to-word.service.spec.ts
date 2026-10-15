import JSZip from "jszip";
import { TestBed } from "@angular/core/testing";
import { PdfToWordService } from "./pdf-to-word.service";
import { PdfJsLoaderService } from "../pdf/pdfjs-loader.service";
import { LocalProcessingCapabilityService } from "../capacity/local-processing-capability.service";
describe("PDF to Word safety", () => {
  let capability: any,
    loader: { load: ReturnType<typeof vi.fn> },
    service: PdfToWordService;
  beforeEach(() => {
    capability = {
      current: {
        formFactor: "desktop",
        tier: "high",
        memoryGiB: 8,
        budget: { maxFileBytes: 100_000_000 },
      },
    };
    loader = { load: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        PdfToWordService,
        { provide: PdfJsLoaderService, useValue: loader },
        { provide: LocalProcessingCapabilityService, useValue: capability },
      ],
    });
    service = TestBed.inject(PdfToWordService);
  });
  it("accepts 200 MB on desktop and phones while reducing render memory", () => {
    expect(service.limits.bytes).toBe(200_000_000);
    const desktopPixels = service.limits.ocrPixels;
    capability.current.formFactor = "mobile";
    expect(service.limits.bytes).toBe(200_000_000);
    expect(service.limits.ocrPixels).toBeLessThan(desktopPixels);
    expect(service.limits).not.toHaveProperty("pages");
  });
  it("rejects empty and oversized files before parsing", async () => {
    for (const size of [0, 200_000_001])
      await expect(
        service.convert(
          { size } as File,
          "editable",
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toThrow("non-empty PDF");
    expect(loader.load).not.toHaveBeenCalled();
  });
  it("rejects a renamed non-PDF before loading the engine", async () => {
    const file = {
      size: 4,
      slice: () => ({
        arrayBuffer: async () => new TextEncoder().encode("text").buffer,
      }),
    } as unknown as File;
    await expect(
      service.convert(file, "editable", new AbortController().signal, () => {}),
    ).rejects.toThrow("valid PDF header");
    expect(loader.load).not.toHaveBeenCalled();
  });
  it("does not start a cancelled request", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      service.convert({ size: 10 } as File, "editable", abort.signal, () => {}),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(loader.load).not.toHaveBeenCalled();
  });
  it("explains password protection and releases the PDF task", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7");
    const file = {
      size: bytes.length,
      slice: () => ({ arrayBuffer: async () => bytes.buffer }),
      arrayBuffer: async () => bytes.buffer,
    } as unknown as File;
    const destroy = vi.fn(async () => {});
    loader.load.mockResolvedValue({
      PDFDataRangeTransport: class {
        abort() {}
      },
      getDocument: () => ({
        promise: Promise.reject(
          Object.assign(new Error("Password needed"), {
            name: "PasswordException",
          }),
        ),
        destroy,
      }),
    });
    await expect(
      service.convert(file, "editable", new AbortController().signal, () => {}),
    ).rejects.toThrow("Unlock");
    expect(destroy).toHaveBeenCalledOnce();
  });
  it("exports positioned text and a text-free artwork layer through the conversion service", async () => {
    const read = (blob: Blob) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as ArrayBuffer);
        r.onerror = reject;
        r.readAsArrayBuffer(blob);
      });
    if (!Blob.prototype.arrayBuffer)
      Blob.prototype.arrayBuffer = function () {
        return read(this);
      };
    const rawContext = {
      fillText: vi.fn(),
      strokeText: vi.fn(),
      fillRect: vi.fn(),
      measureText: () => ({ width: 60 }),
      font: "",
    };
    const make = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation(((
      name: string,
      ...args: any[]
    ) =>
      name === "canvas"
        ? {
            width: 1,
            height: 1,
            getContext: () => rawContext,
            toBlob: (cb: any) => cb(new Blob([new Uint8Array([1, 2, 3])])),
          }
        : make(name, ...args)) as any);
    const page = {
      commonObjs: { has: () => true, get: () => ({ name: "Helvetica" }) },
      cleanup: vi.fn(),
      getViewport: ({ scale }: any) => ({
        width: 612 * scale,
        height: 792 * scale,
        transform: [scale, 0, 0, -scale, 0, 792 * scale],
      }),
      getTextContent: async () => ({
        styles: { f: { fontFamily: "sans-serif" } },
        items: [
          {
            str: "Right column",
            width: 70,
            transform: [12, 0, 0, 12, 250, 700],
            fontName: "f",
            dir: "ltr",
          },
        ],
      }),
      getOperatorList: async () => ({
        fnArray: [1, 2],
        argsArray: [["#224466"], [[{ unicode: "Right column" }]]],
      }),
      render: ({ canvasContext }: any) => {
        canvasContext.fillText("Right column", 0, 0);
        canvasContext.fillRect(0, 0, 10, 10);
        return { promise: Promise.resolve(), cancel: vi.fn() };
      },
    };
    const destroy = vi.fn(async () => {});
    loader.load.mockResolvedValue({
      OPS: { setFillRGBColor: 1, showText: 2 },
      PermissionFlag: { COPY: 16 },
      Util: {
        transform: (_a: any, b: any) => [b[0], 0, 0, -b[3], b[4], 792 - b[5]],
      },
      PDFDataRangeTransport: class {
        abort() {}
      },
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPermissions: async () => null,
          getPage: async () => page,
        }),
        destroy,
      }),
    });
    try {
      const result = await service.convert(
        new File(["%PDF-1.7"], "layout.pdf"),
        "editable",
        new AbortController().signal,
        () => {},
        { mode: "off", language: "eng" } as any,
      );
      const zip = await JSZip.loadAsync(await read(result.file));
      const xml = await zip.file("word/document.xml")!.async("string");
      expect(xml).toContain("<wp:posOffset>3175000</wp:posOffset>");
      expect(xml).toContain("Right column");
      expect(xml).toContain("224466");
      expect(rawContext.fillText).not.toHaveBeenCalled();
      expect(rawContext.fillRect).toHaveBeenCalled();
      expect(result.imagePages).toEqual([]);
      expect(zip.file("word/media/image1.png")).toBeTruthy();
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});
