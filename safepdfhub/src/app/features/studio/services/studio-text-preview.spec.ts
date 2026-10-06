import { fitPreviewFontSize } from './studio-text-preview';
describe('immediate PDF text preview', () => {
  const measure = (text: string, size: number) => Array.from(text).length * size;
  it('retains font size when the complete paragraph fits', () => {
    expect(fitPreviewFontSize('one two',40,20,10,1,measure)).toBe(10);
  });
  it('fits wrapped words and explicit newlines within the source area', () => {
    expect(fitPreviewFontSize('one\ntwo',40,10,10,1,measure)).toBeCloseTo(5,1);
  });
  it('wraps a long unbroken token instead of losing it beyond the page', () => {
    const size = fitPreviewFontSize('abcdefghij',25,10,10,1,measure);
    expect(size).toBeLessThanOrEqual(5);
    expect(size).toBeGreaterThan(4.9);
  });
});
