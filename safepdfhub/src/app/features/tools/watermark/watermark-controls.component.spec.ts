import { describe, expect, it } from 'vitest';
import { WatermarkControlsComponent } from './watermark-controls.component';

describe('WatermarkControlsComponent page-range controls', () => {
  function createComponent(): WatermarkControlsComponent {
    const component = new WatermarkControlsComponent();
    component.pageCount = 11;
    return component;
  }

  it('accepts a valid page range expression', () => {
    const component = createComponent();

    component.selectPageMode('ranges');
    component.onPageRangesChange('1-3,5,8-10');

    expect(component.pageRangeError).toBe('');
    expect(component.canApply).toBe(true);
  });

  it('rejects empty, malformed, reversed, zero, and out-of-document ranges', () => {
    const component = createComponent();
    component.selectPageMode('ranges');

    const invalidValues = ['', '1-', '3-1', '0', '12', '1,,3', '1-3,99'];
    for (const value of invalidValues) {
      component.onPageRangesChange(value);
      expect(component.pageRangeError).not.toBe('');
      expect(component.canApply).toBe(false);
    }
  });

  it('keeps page-range selection clickable after switching to another page scope', () => {
    const component = createComponent();

    component.selectPageMode('ranges');
    component.onPageRangesChange('2-4');

    component.selectPageMode('current');
    expect(component.pageMode).toBe('current');
    expect(component['buildRequest']().pageSelection).toEqual({ mode: 'current', page: 1 });

    component.selectPageMode('ranges');
    expect(component.pageMode).toBe('ranges');
    expect(component.pageRanges).toBe('2-4');
    expect(component.pageRangeError).toBe('');
  });

  it('keeps an invalid range visible when switching away and back so the user can correct it', () => {
    const component = createComponent();

    component.selectPageMode('ranges');
    component.onPageRangesChange('2312321312');
    expect(component.canApply).toBe(false);

    component.selectPageMode('all');
    component.selectPageMode('current');
    component.selectPageMode('ranges');

    expect(component.pageMode).toBe('ranges');
    expect(component.pageRanges).toBe('2312321312');
    expect(component.pageRangeError).toContain('outside the document');
    expect(component.canApply).toBe(false);
  });


  it('keeps the current-page snapshot stable until the user selects Current page again', () => {
    const component = createComponent();

    component.currentPage = 4;
    component.selectPageMode('current');
    expect(component['buildRequest']().pageSelection).toEqual({ mode: 'current', page: 4 });

    component.currentPage = 9;
    expect(component.selectedPageSummary).toBe('Current page 4');
    expect(component['buildRequest']().pageSelection).toEqual({ mode: 'current', page: 4 });

    component.selectPageMode('current');
    expect(component['buildRequest']().pageSelection).toEqual({ mode: 'current', page: 9 });
  });

  it('accepts current page selection independently from range validation', () => {
    const component = createComponent();

    component.onPageRangesChange('2312321312');
    component.selectPageMode('current');

    expect(component.pageMode).toBe('current');
    expect(component.pageRangeError).toBe('');
    expect(component.canApply).toBe(true);
  });
});
