import { abortable, ocrLines, ocrStartupError } from './word-ocr';
import type { Page } from 'tesseract.js';
describe('OCR layout and cancellation', () => {
  it('preserves OCR column reading order and Unicode', () => {
    const line = (text: string, x: number, y: number) => ({
      text,
      bbox: { x0: x, y0: y, x1: x + 200, y1: y + 30 },
    });
    const data = {
      blocks: [
        {
          paragraphs: [
            {
              is_ltr: true,
              lines: [line('English हिन्दी', 40, 400), line('Next column', 500, 40)],
            },
          ],
        },
      ],
    } as Page;
    const lines = ocrLines(data, 2, 2);
    expect(lines.map((l) => l.runs[0].text)).toEqual(['English हिन्दी', 'Next column']);
    expect(lines[0].x).toBe(20);
    expect(lines[0].height).toBe(15);
  });
  it('keeps text when layout blocks are unavailable', () => {
    expect(ocrLines({ blocks: null, text: 'One\nTwo' } as Page, 1, 1)).toHaveLength(2);
  });
  it('returns promptly when a terminated worker never resolves its job', async () => {
    const controller = new AbortController();
    const pending = abortable(new Promise(() => {}), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('OCR startup errors', () => {
  it('explains missing models without exposing raw worker URLs', () => {
    const error = ocrStartupError('Network error fetching http://localhost:4200/assets/ocr/lang/mar.traineddata.gz. Response code: 404');
    expect(error.message).toContain('OCR language files');
    expect(error.message).toContain('Keep page appearance');
    expect(error.message).not.toContain('localhost');
  });
});
