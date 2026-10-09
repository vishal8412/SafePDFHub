import { assessOcr } from './ocr-quality';
import type { Page } from 'tesseract.js';
const result = (confidence: number, scores: number[]) =>
  ({
    text: 'Recognized document text',
    confidence,
    blocks: [
      {
        paragraphs: [
          { lines: [{ words: scores.map((score) => ({ text: 'word', confidence: score })) }] },
        ],
      },
    ],
  }) as Page;
describe('OCR content protection', () => {
  it('rejects nonempty but unreliable text rather than treating recognition as success', () => {
    expect(assessOcr(result(33, [12, 35, 90])).accepted).toBe(false);
  });
  it('rejects missing confidence/word evidence', () => {
    expect(assessOcr({ text: 'Nonempty', confidence: 96, blocks: null } as Page).accepted).toBe(
      false,
    );
  });
  it('rejects a very weak word even when the page average is high', () => {
    expect(assessOcr(result(96, [...Array(99).fill(96), 20])).accepted).toBe(false);
  });
  it('rejects excessive uncertain words even when the page average is high', () => {
    expect(assessOcr(result(91, [...Array(90).fill(96), ...Array(10).fill(75)])).accepted).toBe(
      false,
    );
  });
  it('permits clear text while still requiring proofreading', () => {
    const r = assessOcr(result(96, [96, 98, 94]));
    expect(r.accepted).toBe(true);
    expect(r.reason).toContain('proofreading');
  });
});
