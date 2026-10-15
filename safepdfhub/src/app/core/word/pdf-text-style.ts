import { TextFragment, groupText } from "./word-layout";
import { WordLine } from "./word-document";
/** PDF text extraction omits paint colour. Match non-space Unicode characters
 * against the display operators, without guessing from headings or coordinates. */
export function textPaints(
  list: { fnArray: ArrayLike<number>; argsArray: any[] },
  ops: Record<string, number>,
) {
  let fill = "000000",
    mode = 0,
    pattern = false,
    unsafe = false;
  const stack: { fill: string; mode: number; pattern: boolean }[] = [],
    characters: { char: string; color: string }[] = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i],
      args = list.argsArray[i];
    if (op === ops["save"]) stack.push({ fill, mode, pattern });
    else if (op === ops["restore"]) {
      const old = stack.pop();
      if (old) ({ fill, mode, pattern } = old);
    } else if (op === ops["setFillRGBColor"] && typeof args[0] === "string") {
      fill = args[0].replace("#", "");
      pattern = false;
    } else if (op === ops["setFillColorN"]) pattern = true;
    else if (op === ops["setTextRenderingMode"]) mode = args[0];
    else if (op === ops["showText"]) {
      if (mode !== 0 || pattern) unsafe = true;
      for (const glyph of args[0] ?? [])
        if (typeof glyph === "object" && glyph?.unicode)
          for (const char of glyph.unicode.normalize("NFKC"))
            if (!/\s/.test(char)) characters.push({ char, color: fill });
    }
  }
  let at = 0;
  return {
    unsafe,
    color(text: string): string {
      const chars = Array.from(text.normalize("NFKC")).filter(
        (c) => !/\s/.test(c),
      );
      // Bounded resynchronization handles text omitted by the extraction API.
      for (
        let start = at;
        start < Math.min(characters.length, at + 256);
        start++
      ) {
        if (chars.every((c, i) => characters[start + i]?.char === c)) {
          at = start + chars.length;
          return characters[start]?.color || "000000";
        }
      }
      return "000000";
    },
  };
}
export function positionedText(
  fragments: TextFragment[],
  measure?: (
    text: string,
    font: string,
    size: number,
    bold: boolean,
    italic: boolean,
  ) => number,
): WordLine[] {
  // Each extracted span keeps its own origin and measured width. Equal baselines
  // in separate columns must never turn into sequential body paragraphs.
  return fragments.flatMap((fragment) => {
    const lines = groupText([fragment]);
    for (const line of lines)
      for (const run of line.runs) {
        run.width = fragment.width;
        run.color = fragment.color;
        const natural = measure?.(
          run.text,
          run.font,
          Math.round(run.size * 2) / 2,
          !!run.bold,
          !!run.italic,
        );
        if (natural && natural > 0)
          run.scale = Math.max(
            1,
            Math.min(600, Math.floor((100 * fragment.width) / natural)),
          );
      }
    return lines;
  });
}
/** Retain all vector/image painting while suppressing native canvas text. Used
 * only for fonts/modes for which PDF.js paints text through fillText/strokeText. */
export function graphicsContext(
  context: CanvasRenderingContext2D,
): CanvasRenderingContext2D {
  return new Proxy(context, {
    get(target, key) {
      if (key === "fillText" || key === "strokeText") return () => {};
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) {
      return Reflect.set(target, key, value, target);
    },
  });
}
