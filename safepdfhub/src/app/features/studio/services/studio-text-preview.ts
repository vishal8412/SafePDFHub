/** Fit the temporary browser text layer while the exact PDF preview renders.
 * measure receives text and a font size in pixels. Explicit newlines and long
 * tokens follow pre-wrap / overflow-wrap:anywhere in the overlay stylesheet. */
export function fitPreviewFontSize(text: string, width: number, height: number,
  maximum: number, lineHeight: number, measure: (text: string, size: number) => number): number {
  if (!text || width <= 0 || height <= 0) return maximum;
  const fits = (size: number): boolean => {
    let lines = 0;
    for (const paragraph of text.split('\n')) {
      let current = '';
      lines++;
      for (const token of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
        if (current && measure(current + token.trimEnd(), size) > width) { lines++; current = ''; }
        if (measure(token.trimEnd(), size) <= width) { current += token; continue; }
        for (const char of token) {
          if (current && measure(current + char, size) > width) { lines++; current = ''; }
          current += char;
        }
      }
    }
    return lines * size * lineHeight <= height;
  };
  if (fits(maximum)) return maximum;
  let low = .1, high = maximum;
  for (let iteration = 0; iteration < 12; iteration++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle; else high = middle;
  }
  return low;
}
