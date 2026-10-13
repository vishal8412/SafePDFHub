import { NO_ERRORS_SCHEMA } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { FormsModule } from "@angular/forms";
import { provideHttpClient } from "@angular/common/http";
import { vi } from "vitest";
import { StudioShellComponent } from "./studio-shell.component";
import { StudioFacade } from "../../facade/studio.facade";
import { StudioDialogFocusDirective } from "../../signing/studio-dialog-focus.directive";

describe("Page number dialog interactions", () => {
  it("updates color immediately from swatches, native input and hex; applies the selected value", async () => {
    TestBed.configureTestingModule({
      imports: [StudioShellComponent],
      providers: [provideHttpClient()],
    });
    // Isolate unrelated canvas/sidebar components while retaining the real shell template.
    TestBed.overrideComponent(StudioShellComponent, {
      set: {
        imports: [FormsModule, StudioDialogFocusDirective],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    const facade = TestBed.inject(StudioFacade);
    vi.spyOn(facade, "pageCount").mockReturnValue(3);
    const apply = vi.spyOn(facade, "applyPageNumbers").mockResolvedValue();
    const fixture = TestBed.createComponent(StudioShellComponent),
      component = fixture.componentInstance;
    component.numberOptions.to = 3;
    component.numberDialogOpen.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    root
      .querySelector<HTMLButtonElement>('[aria-label="Use color #ef4444"]')!
      .click();
    fixture.detectChanges();
    expect(component.numberOptions.color).toBe("#ef4444");
    const native = root.querySelector<HTMLInputElement>('[type="color"]')!;
    native.value = "#00ff00";
    native.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    expect(component.numberOptions.color).toBe("#00ff00");
    const hex = root.querySelector<HTMLInputElement>("#number-hex")!;
    hex.value = "#2563eb";
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    expect(
      root.querySelector<HTMLElement>(".number-dialog__sample")!.style.color,
    ).toBe("rgb(37, 99, 235)");
    root.querySelector<HTMLButtonElement>(".number-dialog__primary")!.click();
    await fixture.whenStable();
    expect(apply.mock.calls[0][0].color).toBe("#2563eb");
    expect(component.numberDialogOpen()).toBe(false);
  });
});
