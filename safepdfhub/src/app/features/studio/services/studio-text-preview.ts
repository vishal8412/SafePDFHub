/** Shared word wrapping for the live editor and PDF export. */
export function wrapTextLines(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let current = '';
    for (const word of paragraph.trim().split(/\s+/u).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && measure(candidate) > width) { lines.push(current); current = ''; }
      if (measure(word) > width) {
        for (const char of word) {
          if (current && measure(current + char) > width) { lines.push(current); current = ''; }
          current += char;
        }
      } else current = current ? `${current} ${word}` : word;
    }
    lines.push(current);
  }
  return lines;
}

/** Do not stretch the last line of a paragraph, including explicit newlines. */
export function isJustifiedLine(text: string, lines: readonly string[], index: number): boolean {
  if (index >= lines.length - 1 || !/\S+\s+\S/u.test(lines[index])) return false;
  const count = (value: string) => value.replace(/\s/gu, '').length;
  const consumed = count(lines.slice(0, index + 1).join(''));
  let end = 0;
  return !text.split(/\r?\n/).some(paragraph => { end += count(paragraph); return end === consumed; });
}

/** PDF glyph boxes contain n glyph heights but only n-1 baseline gaps. */
export function fitPreviewFontSize(text: string, width: number, height: number,
  maximum: number, lineHeight: number, measure: (text: string, size: number) => number): number {
  if (!text || width <= 0 || height <= 0) return maximum;
  const fits = (size: number): boolean => {
    const lines = wrapTextLines(text, width, value => measure(value, size));
    return (lines.length - 1) * size * lineHeight + size <= height + size * .15
      && lines.every(line => measure(line, size) <= width + .01);
  };
  if (fits(maximum)) return maximum;
  let low = .1, high = maximum;
  for (let iteration = 0; iteration < 12; iteration++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle; else high = middle;
  }
  return low;
}
