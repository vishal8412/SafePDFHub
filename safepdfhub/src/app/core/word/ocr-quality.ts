import type { Page } from 'tesseract.js';

/** Confidence is a rejection heuristic, never a guarantee that words are correct. */
export interface OcrAssessment {
  accepted: boolean;
  reason: string;
  confidence: number;
  weakWordRatio: number;
}
export function assessOcr(data: Page): OcrAssessment {
  const words = (data.blocks ?? [])
    .flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
    .filter((w) => /[\p{L}\p{N}]/u.test(w.text));
  const confidence = Number.isFinite(data.confidence) ? data.confidence : 0;
  const weakWordRatio = words.length
    ? words.filter((w) => !Number.isFinite(w.confidence) || w.confidence < 80).length / words.length
    : 1;
  const rejected =
    !data.text.trim() ||
    !words.length ||
    confidence < 90 ||
    weakWordRatio > 0.05 ||
    words.some((w) => !Number.isFinite(w.confidence) || w.confidence < 45);
  return {
    accepted: !rejected,
    confidence,
    weakWordRatio,
    reason: !words.length
      ? 'No reliable text was recognized.'
      : rejected
        ? 'Recognition was uncertain; the source page was preserved.'
        : 'OCR text needs proofreading.',
  };
}

/** Ruled tables cannot be faithfully exported by the paragraph-only OCR writer.
 * Sample at a bounded resolution; require intersecting long rules rather than a single border. */
export function containsRuledTable(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement('canvas');
  probe.width = Math.min(700, canvas.width);
  probe.height = Math.max(1, Math.round((canvas.height * probe.width) / canvas.width));
  try {
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
    const { data, width, height } = ctx.getImageData(0, 0, probe.width, probe.height);
    const dark = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return data[i] + data[i + 1] + data[i + 2] < 420;
    };
    // A local band tolerates a slightly slanted or curved scan.
    let rules = 0,
      last = -20;
    for (let y = 8; y < height - 8; y += 2) {
      let occupied = 0;
      for (let x = 10; x < width - 10; x++) {
        let hit = false;
        for (let dy = -3; dy <= 3 && !hit; dy++) hit = dark(x, y + dy);
        if (hit) occupied++;
      }
      if (occupied > width * 0.7 && y - last > 12) {
        rules++;
        last = y;
      }
    }
    let vertical = 0;
    for (let x = 8; x < width - 8; x += 3) {
      let occupied = 0;
      for (let y = 10; y < height - 10; y++) {
        if (dark(x, y) || dark(x - 2, y) || dark(x + 2, y)) occupied++;
      }
      if (occupied > height * 0.35) vertical++;
    }
    return rules >= 3 && vertical >= 2;
  } finally {
    probe.width = probe.height = 0;
  }
}
