import { WordLine, WordRun } from './word-document';
export interface TextFragment {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  font?: string;
  family?: string;
  rtl?: boolean;
}
/** Group glyph fragments by baseline, keeping large column gaps as separate lines. */
export function groupText(fragments: TextFragment[]): WordLine[] {
  const rows: TextFragment[][] = [];
  for (const f of fragments
    .filter((f) => f.text.trim() && Number.isFinite(f.x + f.y + f.size + f.width))
    .sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - f.y) <= Math.max(2, Math.min(row[0].size, f.size) * 0.25))
      row.push(f);
    else rows.push([f]);
  }
  const lines: WordLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let line: WordLine | undefined;
    let end = 0;
    for (const f of row) {
      const font = `${f.font ?? ''} ${f.family ?? ''}`;
      const r: WordRun = {
        text: f.text,
        size: f.size,
        font: /mono|courier/i.test(font)
          ? 'Courier New'
          : /serif|times|georgia/i.test(font) && !/sans/i.test(font)
            ? 'Times New Roman'
            : 'Arial',
        bold: /bold|black|heavy/i.test(font),
        italic: /italic|oblique/i.test(font),
        rtl: f.rtl,
      };
      if (!line || f.x - end > Math.max(28, f.size * 3)) {
        line = { x: f.x, y: f.y, width: f.width, height: f.size, runs: [r] };
        lines.push(line);
      } else {
        if (
          f.x - end > f.size * 0.15 &&
          !line.runs.at(-1)!.text.endsWith(' ') &&
          !r.text.startsWith(' ')
        )
          r.text = ' ' + r.text;
        line.runs.push(r);
        line.width = Math.max(line.width, f.x + f.width - line.x);
        line.height = Math.max(line.height, f.size);
      }
      end = f.x + f.width;
    }
  }
  return lines;
}
export function safeWordName(name: string): string {
  return (
    (name
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/, '')
      .slice(0, 120) || 'converted') + '.docx'
  );
}
