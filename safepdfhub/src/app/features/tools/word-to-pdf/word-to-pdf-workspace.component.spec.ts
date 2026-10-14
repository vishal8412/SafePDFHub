import { TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import { WordToPdfWorkspaceComponent } from "./word-to-pdf-workspace.component";
import { WordDirectPdfService } from "../../../core/word-to-pdf/word-direct-pdf.service";
import { LoaderService } from "../../../shared/services/loader.service";
describe("Word to PDF workflow", () => {
  const result = {
    file: new File(["%PDF-"], "output.pdf", { type: "application/pdf" }),
    pages: 1,
    durationMs: 100,
    warnings: [],
  };
  function setup(convert: any) {
    TestBed.configureTestingModule({
      imports: [WordToPdfWorkspaceComponent],
      providers: [
        { provide: WordDirectPdfService, useValue: { convert } },
        {
          provide: LoaderService,
          useValue: {
            show: vi.fn(),
            hide: vi.fn(),
            setIndeterminate: vi.fn(),
            setText: vi.fn(),
            registerCancellationHandler: () => () => {},
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(WordToPdfWorkspaceComponent);
    fixture.componentRef.setInput("file", new File(["PK"], "input.docx"));
    fixture.detectChanges();
    return fixture;
  }
  it("shows a download result only after conversion", async () => {
    let finish!: (value: any) => void;
    const fixture = setup(() => new Promise((resolve) => (finish = resolve)));
    expect(fixture.nativeElement.textContent).toContain("Convert to PDF");
    expect(fixture.nativeElement.textContent).not.toContain("Download PDF");
    const pending = fixture.componentInstance.convert();
    expect(fixture.componentInstance.busy).toBe(true);
    finish(result);
    await pending;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Download PDF");
    expect(fixture.nativeElement.textContent).not.toContain("Prepare preview");
  });
  it("prevents cancelled work from replacing a new file result", async () => {
    let finish!: (value: any) => void;
    const fixture = setup(() => new Promise((resolve) => (finish = resolve)));
    const pending = fixture.componentInstance.convert();
    fixture.componentInstance.cancel();
    finish(result);
    await pending;
    expect(fixture.componentInstance.result).toBeNull();
    expect(fixture.componentInstance.busy).toBe(false);
  });
});
