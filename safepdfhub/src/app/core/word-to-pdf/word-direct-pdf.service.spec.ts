import { TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import { WordDirectPdfService } from "./word-direct-pdf.service";
class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
}
describe("Browser Word conversion lifecycle", () => {
  beforeEach(() => vi.stubGlobal("Worker", FakeWorker));
  afterEach(() => vi.unstubAllGlobals());
  it("terminates the worker immediately on cancel", async () => {
    const service = TestBed.inject(WordDirectPdfService),
      controller = new AbortController();
    const pending = service.convert(
      new File(["PK"], "draft.docx"),
      controller.signal,
      () => {},
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it("returns a named downloadable PDF only after successful generation", async () => {
    const service = TestBed.inject(WordDirectPdfService),
      progress = vi.fn();
    const result = service.convert(
      new File(["PK"], "draft.docx"),
      new AbortController().signal,
      progress,
    );
    FakeWorker.latest.onmessage!({
      data: { type: "progress", message: "Creating PDF" },
    });
    expect(progress).toHaveBeenCalledWith("Creating PDF");
    FakeWorker.latest.onmessage!({
      data: {
        type: "complete",
        bytes: Uint8Array.from(new TextEncoder().encode("%PDF-1.7\n")),
        pages: 2,
        warnings: [],
      },
    });
    expect((await result).file.name).toBe("draft.pdf");
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it("rejects invalid output and releases worker resources", async () => {
    const pending = TestBed.inject(WordDirectPdfService).convert(
      new File(["PK"], "draft.docx"),
      new AbortController().signal,
      () => {},
    );
    FakeWorker.latest.onmessage!({
      data: { type: "complete", bytes: new Uint8Array([1, 2]), pages: 1 },
    });
    await expect(pending).rejects.toThrow("validated");
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
});
