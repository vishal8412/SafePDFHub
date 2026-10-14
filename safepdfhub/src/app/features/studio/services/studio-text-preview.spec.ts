import { fitPreviewFontSize, wrapTextLines, isJustifiedLine } from './studio-text-preview';
describe('immediate PDF text preview', () => {
  const measure = (text: string, size: number) => Array.from(text).length * size;
  it('retains font size when the complete paragraph fits', () => {
    expect(fitPreviewFontSize('one two',40,20,10,1,measure)).toBe(10);
  });
  it('fits wrapped words and explicit newlines within the source area', () => {
    expect(fitPreviewFontSize('one\ntwo',40,10,10,1,measure)).toBeCloseTo(10 / 1.85,1);
  });
  it('wraps a long unbroken token instead of losing it beyond the page', () => {
    const size = fitPreviewFontSize('abcdefghij',25,10,10,1,measure);
    expect(size).toBeLessThanOrEqual(5);
    expect(size).toBeGreaterThan(4.9);
  });
});

describe('paragraph layout consistency', () => {
  it('retains the source size for five tight PDF line boxes at every view scale', () => {
    const text = 'one\ntwo\nthree\nfour\nfive';
    for (const scale of [.5, .8, 4/3, 2]) {
      const size = fitPreviewFontSize(text, 470*scale, 66.96*scale, 10.56*scale, 14.1/10.56,
        (value,size)=>value.length*size*.5);
      expect(size).toBeCloseTo(10.56*scale,4);
    }
  });
  it('keeps words inside the line and preserves explicit paragraph ends', () => {
    const lines=wrapTextLines('one two three four\nfive six',8,text=>text.length);
    expect(lines).toEqual(['one two','three','four','five six']);
    expect(isJustifiedLine('one two three four\nfive six',lines,0)).toBe(true);
    expect(isJustifiedLine('one two three four\nfive six',lines,2)).toBe(false);
    expect(isJustifiedLine('one two three four\nfive six',lines,3)).toBe(false);
  });
});
