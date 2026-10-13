import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { vi } from "vitest";
import { StudioFacade } from "../facade/studio.facade";
import { StudioStateService } from "../state/studio-state.service";
import { StudioPageService } from "./studio-page.service";
import { StudioObjectService } from "./studio-object.service";
import { StudioHistoryService } from "./studio-history.service";
import type { StudioPdfDocument } from "../models/pdf-document.model";
import type { PageNumberOptions } from "./studio-page-numbering";
const settings: PageNumberOptions = {
  from: 1,
  to: 3,
  start: 1,
  size: 12,
  margin: 24,
  position: "bottom-center",
  format: "number",
  color: "#ef4444",
};
function setup(count: number) {
  TestBed.configureTestingModule({ providers: [provideHttpClient()] });
  const facade = TestBed.inject(StudioFacade),
    state = TestBed.inject(StudioStateService),
    pages = TestBed.inject(StudioPageService);
  const pdf = {
    getPage: vi.fn(async () => ({
      userUnit: 1,
      rotate: 0,
      getViewport: () => ({ width: 600, height: 800 }),
    })),
  };
  state.setDocument({
    id: "test",
    name: "test.pdf",
    size: 1,
    type: "application/pdf",
    pageCount: count,
    file: new File([""], "test.pdf"),
    pdf,
  } as unknown as StudioPdfDocument);
  pages.initialize(count);
  return {
    facade,
    pdf,
    objects: TestBed.inject(StudioObjectService),
    history: TestBed.inject(StudioHistoryService),
  };
}
describe("Page number apply transaction", () => {
  it("commits once, replaces without duplicates, and preserves exact undo/redo colors", async () => {
    const { facade, objects, history } = setup(3);
    await facade.applyPageNumbers(settings);
    expect(objects.snapshot()).toHaveLength(3);
    const revision = history.revision();
    await facade.applyPageNumbers({ ...settings, from: 2, color: "#2563eb" });
    expect(objects.snapshot()).toHaveLength(2);
    expect(history.revision()).toBeGreaterThan(revision);
    expect(history.undo()?.objects.map((o) => o.textStyle?.color)).toEqual([
      "#ef4444",
      "#ef4444",
      "#ef4444",
    ]);
    expect(history.redo()?.objects.map((o) => o.textStyle?.color)).toEqual([
      "#2563eb",
      "#2563eb",
    ]);
  });
  it("cancels with no partial objects or new history entry", async () => {
    const { facade, objects, history } = setup(50),
      controller = new AbortController();
    await expect(
      facade.applyPageNumbers(
        { ...settings, to: 50 },
        controller.signal,
        (done) => {
          if (done >= 16) controller.abort();
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(objects.snapshot()).toHaveLength(0);
    expect(history.canUndo()).toBe(false);
  });
  it("processes a synthetic 36,628-page manifest and reuses all metadata on reapply", async () => {
    const { facade, pdf, objects } = setup(36628);
    const start = performance.now();
    await facade.applyPageNumbers({ ...settings, to: 36628 });
    const initial = performance.now() - start;
    expect(objects.snapshot()).toHaveLength(36628);
    expect(pdf.getPage).toHaveBeenCalledTimes(36628);
    const second = performance.now();
    await facade.applyPageNumbers({ ...settings, to: 36628, color: "#2563eb" });
    expect(pdf.getPage).toHaveBeenCalledTimes(36628);
    expect(objects.snapshot()).toHaveLength(36628);
    console.log(
      JSON.stringify({
        syntheticPages: 36628,
        firstApplyMs: Math.round(initial),
        cachedApplyMs: Math.round(performance.now() - second),
        metadataReads: pdf.getPage.mock.calls.length,
      }),
    );
  }, 30000);
});
