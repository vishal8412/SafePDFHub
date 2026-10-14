import { DOMParser, type Element as X } from "@xmldom/xmldom";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  beginText,
  endText,
  setCharacterSpacing,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { lineSlots, type FlowObstacle } from "./word-flow";
import { openDocx } from "./docx-archive";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const children = (el: X | null | undefined, name?: string): X[] =>
  el
    ? (Array.from(el.childNodes).filter(
        (n) => n.nodeType === 1 && (!name || n.localName === name),
      ) as X[])
    : [];
const child = (el: X | null | undefined, name: string) => children(el, name)[0];
const all = (el: X, name: string): X[] =>
  Array.from(el.getElementsByTagNameNS("*", name));
const attr = (el: X | undefined, name = "val") =>
  el?.getAttributeNS(W, name) || el?.getAttribute(name) || "";
const num = (value: string, fallback: number) =>
  value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;
const onAttribute = (value: string) => ["1", "true", "on"].includes(value);
const on = (el: X | undefined) =>
  !!el && !["0", "false", "off"].includes(attr(el));
const color = (hex: string) =>
  /^[0-9a-f]{6}$/i.test(hex)
    ? rgb(
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
      )
    : rgb(0, 0, 0);
interface Face {
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  underline: boolean;
  family: string;
  spacing: number;
}
interface Token {
  text: string;
  font: PDFFont;
  face: Face;
  width: number;
  drawing?: (page: PDFPage) => void;
  image?: Awaited<ReturnType<PDFDocument["embedPng"]>>;
  height?: number;
  break?: boolean;
  anchor?: X;
}
interface Paragraph {
  tokens: Token[];
  anchors: Token[];
  empty: Token;
  exact: boolean;
  borders?: X;
  keepLines: boolean;
  contextual: boolean;
  style: string;
  lines: Token[][];
  before: number;
  after: number;
  line: number;
  align: string;
  left: number;
  right: number;
  first: number;
  pageBreak: boolean;
  keep: boolean;
}
interface Paper {
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}
export interface LocalWordResult {
  bytes: Uint8Array;
  pages: number;
  warnings: string[];
}
/** Runs in a dedicated worker. No document content or external relationships are fetched. */
export async function convertLocalWord(
  file: Blob,
  asset: (name: string) => Promise<Uint8Array>,
  progress: (message: string) => void,
): Promise<LocalWordResult> {
  progress("Reading Word document…");
  const archive = await openDocx(file),
    pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const warnings = new Set<string>();
  const xml = async (name: string): Promise<X | undefined> => {
    if (!archive.parts.has(name)) return undefined;
    const text = new TextDecoder().decode(await archive.read(name));
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      throw Error("Document XML declarations are not supported.");
    return (
      new DOMParser({
        onError: () => {
          throw Error("The document contains damaged XML.");
        },
      }).parseFromString(text, "application/xml").documentElement || undefined
    );
  };
  const root = (await xml("word/document.xml"))!,
    body = child(root, "body");
  if (!body) throw Error("This DOCX has no document body.");
  // DrawingML is the supported representation. Do not render its VML fallback too.
  const normalize = (el: X): void => {
    for (const c of children(el)) {
      if (c.localName === "AlternateContent") {
        const branch =
          children(c, "Choice").find((choice) =>
            (choice.getAttribute("Requires") || "")
              .split(/\s+/)
              .every((prefix) =>
                [
                  "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
                  "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
                ].includes(choice.lookupNamespaceURI(prefix) || ""),
              ),
          ) || child(c, "Fallback");
        if (!branch)
          throw Error(
            "This document contains an unsupported alternate drawing.",
          );
        normalize(branch);
        for (const node of Array.from(branch.childNodes))
          el.insertBefore(node, c);
        el.removeChild(c);
      } else normalize(c);
    }
  };
  normalize(root);
  // Avoid producing a success result with silently missing unsupported objects.
  for (const name of [
    "altChunk",
    "object",
    "OLEObject",
    "pict",
    "oMath",
    "oMathPara",
  ])
    if (all(root, name).length)
      throw Error(
        "This document contains equations, text boxes or embedded objects that the local converter cannot preserve yet.",
      );
  if (
    all(root, "footnoteReference").length ||
    all(root, "endnoteReference").length
  )
    throw Error(
      "Footnotes and endnotes are not supported by this local converter yet.",
    );
  if (all(root, "ins").length || all(root, "del").length)
    warnings.add(
      "Tracked changes were exported using the current text; deleted text was excluded.",
    );
  const stylesRoot = await xml("word/styles.xml"),
    styles = new Map<string, X>();
  if (stylesRoot)
    for (const s of children(stylesRoot, "style"))
      styles.set(attr(s, "styleId"), s);
  const defaults = child(stylesRoot, "docDefaults");
  const resolveStyle = (id: string, seen = new Set<string>()): X[] => {
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const s = styles.get(id);
    return s ? [...resolveStyle(attr(child(s, "basedOn")), seen), s] : [];
  };
  const rels = new Map<string, string>();
  const relRoot = await xml("word/_rels/document.xml.rels");
  for (const r of children(relRoot)) {
    if (r.getAttribute("TargetMode") === "External") continue;
    const target = r.getAttribute("Target") || "";
    if (
      target.startsWith("/") ||
      target.includes("..") ||
      /^[a-z]+:/i.test(target)
    )
      continue;
    rels.set(r.getAttribute("Id") || "", "word/" + target.replace(/^\.\//, ""));
  }
  const metrics = new WeakMap<
    PDFFont,
    { height: number; ascent: number; descent: number }
  >();
  const fontCache = new Map<string, Promise<PDFFont>>();
  const coverage = new WeakMap<PDFFont, Set<number>>();
  const loadFont = (name: string) => {
    if (!fontCache.has(name))
      fontCache.set(
        name,
        asset(name).then(async (bytes) => {
          const info = fontkit.create(bytes);
          const embedded = await pdf.embedFont(bytes, { subset: true });
          metrics.set(embedded, {
            height:
              (info.ascent - info.descent + info.lineGap) / info.unitsPerEm,
            ascent: info.ascent / info.unitsPerEm,
            descent: -info.descent / info.unitsPerEm,
          });
          return embedded;
        }),
      );
    return fontCache.get(name)!;
  };
  const font = async (face: Face, text: string) => {
    const script = /[\u0900-\u097f]/u.test(text);
    const variant = face.bold
      ? face.italic
        ? "BoldItalic"
        : "Bold"
      : face.italic
        ? "Italic"
        : "Regular";
    const name = script ? "NotoSansDevanagari.ttf" : `Carlito-${variant}.ttf`;
    let selected = await loadFont(name);
    const supports = (f: PDFFont) => {
      let set = coverage.get(f);
      if (!set) {
        set = new Set(f.getCharacterSet());
        coverage.set(f, set);
      }
      return Array.from(text).every(
        (c) => /\s/u.test(c) || set.has(c.codePointAt(0)!),
      );
    };
    if (!supports(selected)) {
      const fallback = `DejaVuSans${face.bold ? (face.italic ? "-BoldOblique" : "-Bold") : face.italic ? "-Oblique" : ""}.ttf`;
      selected = await loadFont(fallback);
      if (!supports(selected))
        throw Error(
          "This document contains characters not supported by the bundled fonts. Conversion stopped to avoid missing text.",
        );
    }
    if (face.family && !/calibri|carlito/i.test(face.family))
      warnings.add(
        "Compatible bundled fonts were used. Line breaks may differ from Microsoft Word.",
      );
    return selected;
  };
  const faceFrom = (props: (X | undefined)[]): Face => {
    const f: Face = {
      size: 11,
      bold: false,
      italic: false,
      color: "000000",
      underline: false,
      family: "Calibri",
      spacing: 0,
    };
    for (const rp of props) {
      if (!rp) continue;
      if (child(rp, "spacing"))
        f.spacing = num(attr(child(rp, "spacing")), 0) / 20;
      if (child(rp, "sz"))
        f.size = Math.max(1, Math.min(400, num(attr(child(rp, "sz")), 22) / 2));
      if (child(rp, "b")) f.bold = on(child(rp, "b"));
      if (child(rp, "i")) f.italic = on(child(rp, "i"));
      if (child(rp, "color")) f.color = attr(child(rp, "color"));
      if (child(rp, "u"))
        f.underline = !["none", "0", "false"].includes(attr(child(rp, "u")));
      if (child(rp, "rFonts"))
        f.family =
          attr(child(rp, "rFonts"), "ascii") ||
          attr(child(rp, "rFonts"), "hAnsi") ||
          f.family;
    }
    return f;
  };
  const imageCache = new Map<
    string,
    Awaited<ReturnType<PDFDocument["embedPng"]>>
  >();
  const getImage = async (blip: X | undefined) => {
    const path = rels.get(blip?.getAttributeNS(R, "embed") || "");
    if (!path)
      throw Error(
        "An image is missing or linked externally. Embed it in Word before converting.",
      );
    let image = imageCache.get(path);
    if (!image) {
      const bytes = await archive.read(path, 150_000_000);
      checkImage(bytes);
      image =
        bytes[0] === 255 && bytes[1] === 216
          ? await pdf.embedJpg(bytes)
          : await pdf.embedPng(bytes);
      await image.embed();
      imageCache.set(path, image);
    }
    return image;
  };
  type Paint = (page: PDFPage) => void;
  const emu = (el: X | undefined, key: string, fallback = 0) =>
    num(el?.getAttribute(key) || "", fallback * 12700) / 12700;
  const drawing = async (node: X): Promise<Paint> => {
    const paints: Paint[] = [];
    const visit = async (node: X): Promise<Paint> => {
      const group = ["wgp", "grpSp"].includes(node.localName || "");
      const props = child(node, group ? "grpSpPr" : "spPr");
      const xf = child(props, "xfrm");
      if (
        xf?.getAttribute("rot") ||
        xf?.getAttribute("flipH") ||
        xf?.getAttribute("flipV")
      )
        throw Error(
          "Rotated or flipped grouped drawings are not supported yet.",
        );
      const off = child(xf, "off"),
        ext = child(xf, "ext"),
        x = emu(off, "x"),
        y = emu(off, "y"),
        w = emu(ext, "cx"),
        h = emu(ext, "cy");
      if (group) {
        const origin = child(xf, "chOff"),
          size = child(xf, "chExt"),
          sx = w / (emu(size, "cx") || w || 1),
          sy = h / (emu(size, "cy") || h || 1);
        const items: Paint[] = [];
        for (const c of children(node))
          if (["wsp", "sp", "pic", "wgp", "grpSp"].includes(c.localName || ""))
            items.push(await visit(c));
        return (page) => {
          page.pushOperators(
            pushGraphicsState(),
            concatTransformationMatrix(
              sx,
              0,
              0,
              sy,
              x - emu(origin, "x") * sx,
              -y + emu(origin, "y") * sy,
            ),
          );
          items.forEach((paint) => paint(page));
          page.pushOperators(popGraphicsState());
        };
      }
      if (node.localName === "pic") {
        const image = await getImage(all(node, "blip")[0]);
        return (page) =>
          page.drawImage(image, { x, y: -y - h, width: w, height: h });
      }
      const fill = child(props, "solidFill"),
        fillHex = child(fill, "srgbClr")?.getAttribute("val"),
        ln = child(props, "ln"),
        strokeHex = child(child(ln, "solidFill"), "srgbClr")?.getAttribute(
          "val",
        ),
        opacity =
          num(
            child(child(fill, "srgbClr"), "alpha")?.getAttribute("val") || "",
            100000,
          ) / 100000;
      const paths: string[] = [];
      const geom = child(props, "prstGeom"),
        custom = child(props, "custGeom");
      if (geom && geom.getAttribute("prst") !== "rect")
        throw Error("This drawing uses an unsupported shape geometry.");
      if (geom) paths.push(`M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`);
      for (const path of children(child(custom, "pathLst"), "path")) {
        const sx = w / (num(path.getAttribute("w") || "", w * 12700) || 1),
          sy = h / (num(path.getAttribute("h") || "", h * 12700) || 1);
        const commands: string[] = [];
        for (const op of children(path)) {
          if (op.localName === "close") {
            commands.push("Z");
            continue;
          }
          const code = (
            {
              moveTo: "M",
              lnTo: "L",
              cubicBezTo: "C",
              quadBezTo: "Q",
            } as Record<string, string>
          )[op.localName || ""];
          if (!code)
            throw Error("This drawing uses an unsupported vector path.");
          commands.push(
            code +
              children(op, "pt")
                .map(
                  (pt) =>
                    `${num(pt.getAttribute("x") || "", 0) * sx} ${num(pt.getAttribute("y") || "", 0) * sy}`,
                )
                .join(" "),
          );
        }
        paths.push(commands.join(" "));
      }
      const box = child(child(node, "txbx"), "txbxContent"),
        bp = child(node, "bodyPr");
      const insetL = emu(bp, "lIns", 7.2),
        insetR = emu(bp, "rIns", 7.2),
        insetT = emu(bp, "tIns", 3.6);
      const plans: Paragraph[] = [];
      if (box)
        for (const block of children(box)) {
          if (block.localName !== "p")
            throw Error(
              "Tables inside drawing text boxes are not supported yet.",
            );
          plans.push(await paragraph(block, Math.max(1, w - insetL - insetR)));
        }
      return (page) => {
        for (const path of paths)
          if (fillHex || strokeHex)
            page.drawSvgPath(path, {
              x,
              y: -y,
              color: fillHex ? color(fillHex) : undefined,
              borderColor: strokeHex ? color(strokeHex) : undefined,
              borderWidth: strokeHex ? emu(ln, "w", 0.75) : 0,
              opacity,
            });
        let top = -y - insetT;
        for (const plan of plans) {
          top -= plan.before;
          plan.lines.forEach((line, i) => {
            renderLine(
              line,
              plan,
              x + insetL,
              top,
              w - insetL - insetR,
              i,
              page,
            );
            top -= lineHeight(line, plan);
          });
          top -= plan.after;
        }
      };
    };
    const data = all(node, "graphicData")[0];
    if (!data || !children(data).length)
      throw Error(
        "An image is missing or linked externally. Embed it in Word before converting.",
      );
    if (children(data).length === 1 && children(data)[0].localName === "pic") {
      const pic = children(data)[0],
        image = await getImage(all(pic, "blip")[0]),
        extent = all(node, "extent")[0];
      const w = emu(extent, "cx", image.width),
        h = emu(extent, "cy", image.height);
      return (page) =>
        page.drawImage(image, { x: 0, y: -h, width: w, height: h });
    }
    for (const c of children(data)) {
      if (!["pic", "wgp", "wsp", "sp", "grpSp"].includes(c.localName || ""))
        throw Error("This document contains an unsupported drawing type.");
      paints.push(await visit(c));
    }
    return (page) => paints.forEach((paint) => paint(page));
  };
  const numberingRoot = await xml("word/numbering.xml");
  const counters = new Map<string, number>();
  const listPrefix = (pr: X | undefined) => {
    const np = child(pr, "numPr");
    if (!np || !numberingRoot) return "";
    const id = attr(child(np, "numId")),
      level = attr(child(np, "ilvl")) || "0";
    if (id === "0") return "";
    const n = children(numberingRoot, "num").find(
      (n) => attr(n, "numId") === id,
    );

    const abstractId = attr(child(n, "abstractNumId"));
    const definition = children(numberingRoot, "abstractNum").find(
      (e) => attr(e, "abstractNumId") === abstractId,
    );
    const lvl = children(definition, "lvl").find(
      (e) => attr(e, "ilvl") === level,
    );
    const key = id + ":" + level,
      value = (counters.get(key) ?? num(attr(child(lvl, "start")), 1) - 1) + 1;
    counters.set(key, value);
    return attr(child(lvl, "numFmt")) === "bullet" ? "• " : `${value}. `;
  };
  const paragraph = async (
    p: X,
    width: number,
    context: X[] = [],
  ): Promise<Paragraph> => {
    const pr = child(p, "pPr"),
      styleChain = resolveStyle(
        attr(child(pr, "pStyle")) ||
          [...styles.values()]
            .find(
              (s) =>
                attr(s, "type") === "paragraph" && attr(s, "default") === "1",
            )
            ?.getAttributeNS(W, "styleId") ||
          "",
      );
    const pprops = [
      child(child(defaults, "pPrDefault"), "pPr"),
      ...context.map((s) => child(s, "pPr")),
      ...styleChain.map((s) => child(s, "pPr")),
      pr,
    ].filter(Boolean) as X[];
    const property = (name: string) =>
      pprops
        .map((x) => child(x, name))
        .filter(Boolean)
        .at(-1);
    // OOXML inherits individual attributes (a heading may override before/after only).
    const inherited = (name: string, key: string, fallback: string) => {
      for (let i = pprops.length - 1; i >= 0; i--) {
        const el = child(pprops[i], name);
        if (el?.hasAttributeNS(W, key) || el?.hasAttribute(key))
          return attr(el, key);
      }
      return fallback;
    };
    const spacing = property("spacing"),
      ind = property("ind"),
      left = num(attr(ind, "left"), 0) / 20,
      right = num(attr(ind, "right"), 0) / 20,
      first =
        (num(attr(ind, "firstLine"), 0) - num(attr(ind, "hanging"), 0)) / 20;
    const base = [
      child(child(defaults, "rPrDefault"), "rPr"),
      ...context.map((s) => child(s, "rPr")),
      ...styleChain.map((s) => child(s, "rPr")),
    ];
    const tokens: Token[] = [],
      anchors: Token[] = [];
    const emptyFace = faceFrom([...base, child(pr, "rPr")]);
    const empty: Token = {
      text: "",
      font: await font(emptyFace, ""),
      face: emptyFace,
      width: 0,
    };
    const push = async (text: string, face: Face) => {
      for (const part of text.match(/\s+|\S+/gu) || []) {
        const clean = part.replace(/[\t\r\n]/g, " ");
        const f = await font(face, clean);
        tokens.push({
          text: clean,
          font: f,
          face,
          width:
            f.widthOfTextAtSize(clean, face.size) +
            Array.from(clean).length * face.spacing,
        });
      }
    };
    const prefix = listPrefix(pr);
    if (prefix) await push(prefix, faceFrom(base));
    const walk = async (el: X): Promise<void> => {
      if (["pPr", "del"].includes(el.localName!)) return;
      if (el.localName === "r") {
        const rp = child(el, "rPr");
        if (on(child(rp, "vanish"))) return;
        const face = faceFrom([
          ...base,
          ...resolveStyle(attr(child(rp, "rStyle"))).map((s) =>
            child(s, "rPr"),
          ),
          rp,
        ]);
        for (const c of children(el)) {
          if (c.localName === "t") await push(c.textContent || "", face);
          else if (c.localName === "tab") {
            // Word tab positions are measured from the paragraph origin, not four spaces.
            let used = 0;
            for (
              let i = tokens.length - 1;
              i >= 0 && tokens[i].height !== -1;
              i--
            )
              used += tokens[i].width;
            const stops = children(property("tabs"), "tab")
              .filter((t) => attr(t) !== "clear")
              .map((t) => num(attr(t, "pos"), 0) / 20)
              .sort((a, b) => a - b);
            const position = used + left + first;
            const stop =
              stops.find((value) => value > position + 0.01) ??
              (Math.floor(position / 36) + 1) * 36;
            tokens.push({
              text: " ",
              font: await font(face, " "),
              face,
              width: Math.max(0, stop - position),
            });
          } else if (c.localName === "br" || c.localName === "cr")
            tokens.push({
              text: "",
              font: await font(face, ""),
              face,
              width: 0,
              break: attr(c, "type") === "page",
              height: -1,
            });
          else if (c.localName === "drawing") {
            const extent = all(c, "extent")[0];
            const w = emu(extent, "cx", 1),
              h = emu(extent, "cy", 1);
            // Preserve the dimensions authored in Word, including intentional margin overflow.
            const scale = 1;
            // Simple image fixtures and legacy drawings can omit graphicData.
            const paint = all(c, "graphicData").length
              ? await drawing(c)
              : null;
            const image = paint ? undefined : await getImage(all(c, "blip")[0]);
            const anchor = all(c, "anchor")[0];
            (anchor ? anchors : tokens).push({
              text: "",
              anchor,
              font: await font(face, ""),
              face,
              width: w * scale,
              height: h * scale,
              image,
              drawing: paint
                ? (page) => {
                    page.pushOperators(
                      pushGraphicsState(),
                      concatTransformationMatrix(scale, 0, 0, scale, 0, 0),
                    );
                    paint(page);
                    page.pushOperators(popGraphicsState());
                  }
                : undefined,
            });
          }
        }
        return;
      }
      for (const c of children(el)) await walk(c);
    };
    await walk(p);
    const lines: Token[][] = [[]];
    let used = 0;
    const next = () => {
      lines.push([]);
      used = 0;
    };
    for (const token of tokens) {
      if (token.height === -1) {
        lines.at(-1)!.push(token);
        next();
        continue;
      }
      const limit = Math.max(
        1,
        width - left - right - (lines.length === 1 ? first : 0),
      );
      if (token.width + used > limit && lines.at(-1)!.length) next();
      if (!used && !token.text.trim() && !token.image && !token.drawing)
        continue;
      if (token.width > limit && !token.image && !token.drawing) {
        for (const c of Array.from(token.text)) {
          const w = token.font.widthOfTextAtSize(c, token.face.size);
          if (used + w > limit && used) next();
          lines.at(-1)!.push({ ...token, text: c, width: w });
          used += w;
        }
      } else {
        lines.at(-1)!.push(token);
        used += token.width;
      }
    }
    if (
      lines.length > 1 &&
      !lines.at(-1)!.length &&
      lines.at(-2)!.some((t) => t.break)
    )
      lines.pop();
    for (const line of lines)
      while (
        line.length &&
        !line.at(-1)!.text.trim() &&
        !line.at(-1)!.image &&
        !line.at(-1)!.drawing &&
        line.at(-1)!.height !== -1
      )
        line.pop();
    const lineRule = inherited("spacing", "lineRule", "auto"),
      lineValue = num(inherited("spacing", "line", "240"), 240);
    return {
      tokens,
      anchors,
      empty,
      exact: lineRule === "exact",
      borders: property("pBdr"),
      keepLines: on(property("keepLines")),
      contextual: on(property("contextualSpacing")),
      style: attr(child(pr, "pStyle")) || "Normal",
      lines,
      before: num(inherited("spacing", "before", "0"), 0) / 20,
      after: num(inherited("spacing", "after", "0"), 0) / 20,
      line:
        lineRule === "exact" || lineRule === "atLeast"
          ? lineValue / 20
          : -lineValue / 240,
      align: attr(property("jc")) || "left",
      left,
      right,
      first,
      pageBreak: on(property("pageBreakBefore")),
      keep: on(property("keepNext")),
    };
  };
  let paper: Paper = {
      width: 612,
      height: 792,
      top: 72,
      bottom: 72,
      left: 72,
      right: 72,
    },
    page!: PDFPage,
    y = 0;
  let decorating = false,
    refs: { header: X[]; footer: X[] } = { header: [], footer: [] };
  const decorations: {
    page: PDFPage;
    paper: Paper;
    refs: typeof refs;
    first: boolean;
    header: number;
    footer: number;
  }[] = [];
  let firstInSection = true,
    headerDistance = 36,
    footerDistance = 36;
  interface PlacedFloat extends FlowObstacle {
    token: Token;
    z: number;
    behind: boolean;
  }
  let floats: PlacedFloat[] = [];
  const layers = new Map<
    PDFPage,
    {
      back: { z: number; paint: Paint }[];
      body: Paint[];
      front: { z: number; paint: Paint }[];
    }
  >();
  let previousAfter = 0,
    previousStyle = "",
    previousContextual = false;
  const emit = (paint: Paint) => {
    if (decorating) paint(page);
    else layers.get(page)!.body.push(paint);
  };
  const flush = (target: PDFPage | undefined) => {
    if (!target) return;
    const layer = layers.get(target);
    if (!layer) return;
    layer.back.sort((a, b) => a.z - b.z).forEach((p) => p.paint(target));
    layer.body.forEach((p) => p(target));
    layer.front.sort((a, b) => a.z - b.z).forEach((p) => p.paint(target));
    layers.delete(target);
  };
  const newPage = () => {
    flush(page);
    floats = [];
    previousAfter = 0;
    previousStyle = "";
    previousContextual = false;
    page = pdf.addPage([paper.width, paper.height]);
    layers.set(page, { back: [], body: [], front: [] });
    y = paper.height - paper.top;
    decorations.push({
      page,
      paper,
      refs,
      first: firstInSection,
      header: headerDistance,
      footer: footerDistance,
    });
    firstInSection = false;
  };
  const lineHeight = (line: Token[], p: Paragraph) => {
    const text = line.filter((t) => !t.drawing && !t.image && t.height !== -1);
    const natural = Math.max(
      ...(text.length ? text : [p.empty]).map(
        (t) => t.face.size * (metrics.get(t.font)?.height || 1.2),
      ),
    );
    const textHeight = p.exact
      ? p.line
      : p.line > 0
        ? Math.max(p.line, natural)
        : natural * -p.line;
    const objectHeight = Math.max(
      0,
      ...line.map((t) => Math.max(0, t.height || 0)),
    );
    return Math.max(
      0.1,
      textHeight,
      objectHeight
        ? objectHeight +
            p.empty.face.size * (metrics.get(p.empty.font)?.descent || 0.25)
        : 0,
    );
  };
  const renderLine = (
    line: Token[],
    p: Paragraph,
    x: number,
    top: number,
    width: number,
    index: number,
    page: PDFPage,
  ) => {
    const height = lineHeight(line, p),
      total = line.reduce((s, t) => s + t.width, 0),
      available = width - p.left - p.right - (index === 0 ? p.first : 0);
    let cursor =
      x +
      p.left +
      (index === 0 ? p.first : 0) +
      (p.align === "center"
        ? Math.max(0, (available - total) / 2)
        : p.align === "right"
          ? Math.max(0, available - total)
          : 0);
    const gaps = line.filter((t) => /^\s+$/u.test(t.text)).length,
      extra =
        p.align === "both" && index < p.lines.length - 1 && gaps
          ? Math.max(0, (available - total) / gaps)
          : 0;
    for (const t of line) {
      if (t.drawing) {
        page.pushOperators(
          pushGraphicsState(),
          concatTransformationMatrix(1, 0, 0, 1, cursor, top),
        );
        t.drawing(page);
        page.pushOperators(popGraphicsState());
      } else if (t.image) {
        page.drawImage(t.image, {
          x: cursor,
          y: top - (t.height || height),
          width: t.width,
          height: t.height!,
        });
      } else if (t.text) {
        const m = metrics.get(t.font) || {
          height: 1.2,
          ascent: 0.75,
          descent: 0.25,
        };
        const above = Math.max(
          ...line
            .filter((t) => t.height !== -1)
            .map((t) =>
              t.drawing || t.image
                ? t.height || 0
                : t.face.size *
                  ((metrics.get(t.font)?.height || 1.2) -
                    (metrics.get(t.font)?.descent || 0.25)),
            ),
        );
        const below = Math.max(
          ...line
            .filter((t) => !t.drawing && !t.image)
            .map((t) => t.face.size * (metrics.get(t.font)?.descent || 0.25)),
          0,
        );
        const baseline = top - (p.exact ? height - below : above);
        if (t.face.spacing)
          page.pushOperators(
            pushGraphicsState(),
            beginText(),
            setCharacterSpacing(t.face.spacing),
            endText(),
          );
        page.drawText(t.text, {
          x: cursor,
          y: baseline,
          size: t.face.size,
          font: t.font,
          color: color(t.face.color),
        });
        if (t.face.spacing) page.pushOperators(popGraphicsState());
        if (t.face.underline)
          page.drawLine({
            start: { x: cursor, y: baseline - 1 },
            end: { x: cursor + t.width, y: baseline - 1 },
            thickness: 0.5,
            color: color(t.face.color),
          });
      }
      cursor += t.width + (/^\s+$/u.test(t.text) ? extra : 0);
    }
  };
  const drawLine = (
    line: Token[],
    p: Paragraph,
    x: number,
    top: number,
    width: number,
    index: number,
  ) => emit((target) => renderLine(line, p, x, top, width, index, target));
  const placeAnchor = (token: Token, paragraphTop: number, x: number) => {
    const a = token.anchor!,
      h = token.height || 0,
      w = token.width;
    const horizontal = child(a, "positionH"),
      vertical = child(a, "positionV");
    const locate = (pos: X | undefined, axis: "x" | "y") => {
      const ref =
        pos?.getAttribute("relativeFrom") ||
        (axis === "x" ? "column" : "paragraph");
      const extent = axis === "x" ? w : h;
      const full = axis === "x" ? paper.width : paper.height;
      const start = axis === "x" ? paper.left : paper.top,
        end = axis === "x" ? paper.right : paper.bottom;
      let origin = start,
        span = full - start - end;
      if (ref === "page") {
        origin = 0;
        span = full;
      } else if (["paragraph", "line"].includes(ref)) {
        origin = paragraphTop;
        span = h;
      } else if (ref === "character") {
        origin = x;
        span = w;
      } else if (["leftMargin", "topMargin", "insideMargin"].includes(ref)) {
        origin = 0;
        span = start;
      } else if (
        ["rightMargin", "bottomMargin", "outsideMargin"].includes(ref)
      ) {
        origin = full - end;
        span = end;
      }
      const align = child(pos, "align")?.textContent;
      const offset = num(child(pos, "posOffset")?.textContent || "", 0) / 12700;
      if (align === "center") return origin + (span - extent) / 2;
      if (["right", "bottom", "outside"].includes(align || ""))
        return origin + span - extent;
      return origin + offset;
    };
    const simple = ["1", "true"].includes(a.getAttribute("simplePos") || "");
    const f: PlacedFloat = {
      token,
      x: simple ? emu(child(a, "simplePos"), "x") : locate(horizontal, "x"),
      top: simple ? emu(child(a, "simplePos"), "y") : locate(vertical, "y"),
      width: w,
      height: h,
      left: emu(a, "distL"),
      right: emu(a, "distR"),
      above: emu(a, "distT"),
      below: emu(a, "distB"),
      mode: child(a, "wrapNone")
        ? "none"
        : child(a, "wrapTopAndBottom")
          ? "topBottom"
          : child(a, "wrapTight")
            ? "tight"
            : child(a, "wrapThrough")
              ? "through"
              : "square",
      side:
        (
          child(a, "wrapSquare") ||
          child(a, "wrapTight") ||
          child(a, "wrapThrough")
        )?.getAttribute("wrapText") || "bothSides",
      behind: ["1", "true"].includes(a.getAttribute("behindDoc") || ""),
      z: num(a.getAttribute("relativeHeight") || "", 0),
    };
    const polygon = child(
      child(a, "wrapTight") || child(a, "wrapThrough"),
      "wrapPolygon",
    );
    if (polygon)
      f.polygon = children(polygon).map((p) => ({
        x: num(p.getAttribute("x") || "", 0),
        y: num(p.getAttribute("y") || "", 0),
      }));
    if (f.behind) f.mode = "none";
    const paint: Paint = (target) => {
      const top = paper.height - f.top;
      target.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(1, 0, 0, 1, f.x, target.getHeight() - f.top),
      );
      if (token.drawing) token.drawing(target);
      else if (token.image)
        target.drawImage(token.image, { x: 0, y: -h, width: w, height: h });
      target.pushOperators(popGraphicsState());
    };
    floats.push(f);
    layers.get(page)![f.behind ? "back" : "front"].push({ z: f.z, paint });
  };
  const drawParagraph = async (
    p: X,
    x = paper.left,
    width = paper.width - paper.left - paper.right,
    parsed?: Paragraph,
    following?: Paragraph,
  ) => {
    if (
      child(child(p, "pPr"), "sectPr") &&
      children(p).every((c) => c.localName === "pPr")
    )
      return;
    const plan = parsed || (await paragraph(p, width));
    if (decorating) {
      y -= plan.before;
      plan.lines.forEach((line, i) => {
        drawLine(line, plan, x, y, width, i);
        y -= lineHeight(line, plan);
      });
      y -= plan.after;
      return;
    }
    if (plan.pageBreak && y < paper.height - paper.top) newPage();
    let before = Math.max(previousAfter, plan.before);
    if (plan.contextual && previousContextual && previousStyle === plan.style)
      before = 0;
    if (y >= paper.height - paper.top - 0.01) before = 0;
    const estimated = plan.lines.reduce((n, l) => n + lineHeight(l, plan), 0);
    const nextHeight = following
      ? Math.max(plan.after, following.before) +
        following.lines
          .slice(0, 2)
          .reduce((n, l) => n + lineHeight(l, following), 0)
      : 0;
    const required =
      (plan.keepLines ? estimated : lineHeight(plan.lines[0], plan)) +
      (plan.keep ? nextHeight : 0);
    // An empty paragraph that only overflows the bottom margin must not create
    // a leading blank line and its spacing on the following page.
    if (
      !plan.tokens.length &&
      !plan.anchors.length &&
      !plan.pageBreak &&
      y - before - required < paper.bottom
    ) {
      if (y < paper.height - paper.top) newPage();
      return;
    }
    if (
      y - before - required < paper.bottom &&
      required <= paper.height - paper.top - paper.bottom &&
      y < paper.height - paper.top
    ) {
      newPage();
      before = 0;
    }
    y -= before;
    for (const token of plan.anchors) placeAnchor(token, paper.height - y, x);
    // Work with a copy: line splitting must not mutate cached paragraph plans or their drawings.
    const queue = plan.tokens.map((t) => ({ ...t }));
    let at = 0,
      index = 0,
      finalBreak = false,
      laidEmpty = false,
      bandHeight = 0;
    do {
      const head = queue[at];
      if (head?.height === -1 && head.break) {
        newPage();
        at++;
        index++;
        finalBreak = at >= queue.length;
        continue;
      }
      const lineStart = at;
      const splitBefore: [number, Token][] = [];
      const fragments: {
        line: Token[];
        plan: Paragraph;
        x: number;
        width: number;
      }[] = [];
      let height = Math.max(bandHeight, lineHeight(head ? [head] : [], plan));
      const initialHeight = height;
      if (height > paper.height - paper.top - paper.bottom)
        throw Error(
          "An image or text line is taller than the page. Resize it in Word before converting.",
        );
      if (y - height < paper.bottom) newPage();
      const left = x + plan.left + (index === 0 ? plan.first : 0),
        right = x + width - plan.right;
      const slots = lineSlots(
        left,
        right - left,
        paper.height - y,
        height,
        floats,
      );
      if (!slots.length) {
        const bottoms = floats
          .filter(
            (f) =>
              f.mode !== "none" &&
              f.top + f.height + f.below > paper.height - y,
          )
          .map((f) => f.top + f.height + f.below);
        if (!bottoms.length)
          throw Error("The document has no available text area.");
        y = paper.height - Math.min(...bottoms);
        continue;
      }
      let consumed = false;
      for (const slot of slots) {
        const line: Token[] = [];
        let used = 0;
        while (at < queue.length) {
          const t = queue[at];
          if (t.height === -1) {
            at++;
            line.push(t);
            consumed = true;
            break;
          }
          if (!used && /^\s+$/.test(t.text)) {
            at++;
            continue;
          }
          // Keep text fragments belonging to the same word together, even across Word runs.
          let wordWidth = t.width;
          if (t.text.trim())
            for (
              let j = at + 1;
              j < queue.length &&
              queue[j].text.trim() &&
              queue[j].height !== -1;
              j++
            )
              wordWidth += queue[j].width;
          if (used + wordWidth > slot.width + 0.01 && line.length) break;
          if (t.width > slot.width + 0.01 && !t.drawing && !t.image) {
            let text = "",
              size = 0;
            for (const char of Array.from(t.text)) {
              const cw =
                t.font.widthOfTextAtSize(char, t.face.size) + t.face.spacing;
              if (text && size + cw > slot.width) break;
              text += char;
              size += cw;
            }
            if (!text) break;
            line.push({ ...t, text, width: size });
            splitBefore.push([at, { ...t }]);
            t.text = t.text.slice(text.length);
            t.width -= size;
            if (!t.text) at++;
            consumed = true;
            break;
          }
          line.push(t);
          used += t.width;
          at++;
          consumed = true;
          if (used >= slot.width) break;
        }
        while (line.length && /^\s+$/.test(line.at(-1)!.text)) line.pop();
        height = Math.max(height, lineHeight(line, plan));
        const fragment = {
          ...plan,
          left: 0,
          right: 0,
          first: 0,
          lines: at >= queue.length ? [line] : [line, []],
        };
        fragments.push({ line, plan: fragment, x: slot.x, width: slot.width });
        if (line.some((t) => t.height === -1)) break;
        if (at >= queue.length) break;
      }
      if (height > paper.height - paper.top - paper.bottom)
        throw Error(
          "An image or text line is taller than the page. Resize it in Word before converting.",
        );
      if (
        y - height < paper.bottom ||
        (height > initialHeight + 0.01 && floats.length)
      ) {
        at = lineStart;
        for (const [i, t] of splitBefore) queue[i] = t;
        if (y - height < paper.bottom) newPage();
        bandHeight = height;
        continue;
      }
      for (const fragment of fragments)
        drawLine(
          fragment.line,
          fragment.plan,
          fragment.x,
          y,
          fragment.width,
          0,
        );
      bandHeight = 0;
      y -= height;
      laidEmpty = true;
      index++;
      if (!consumed && at < queue.length)
        throw Error(
          "Text cannot fit beside this drawing. Adjust its wrapping in Word.",
        );
      if (queue[at - 1]?.break) {
        newPage();
        finalBreak = at >= queue.length;
      }
    } while (at < queue.length || (!queue.length && !laidEmpty));
    // Paragraph borders are part of the Word style, not a separate HTML decoration.
    const border = child(plan.borders, "bottom");
    if (border && !["nil", "none"].includes(attr(border))) {
      const borderY = y - num(attr(border, "space"), 0);
      emit((target) =>
        target.drawLine({
          start: { x, y: borderY },
          end: { x: x + width, y: borderY },
          thickness: num(attr(border, "sz"), 4) / 8,
          color: color(attr(border, "color")),
        }),
      );
    }
    previousAfter = finalBreak
      ? 0
      : plan.after +
        (border
          ? num(attr(border, "space"), 0) + num(attr(border, "sz"), 4) / 8
          : 0);
    previousStyle = plan.style;
    previousContextual = plan.contextual;
  };
  const drawTable = async (table: X) => {
    const tablePr = child(table, "tblPr"),
      chain = resolveStyle(attr(child(tablePr, "tblStyle")));
    const prop = (name: string) =>
      child(tablePr, name) ||
      chain
        .map((s) => child(child(s, "tblPr"), name))
        .filter(Boolean)
        .at(-1);
    const borders = prop("tblBorders"),
      margins = prop("tblCellMar"),
      look = prop("tblLook");
    const enabled = (name: string, bit: number) =>
      look?.hasAttributeNS(W, name)
        ? onAttribute(attr(look, name))
        : !!(parseInt(attr(look), 16) & bit);
    const firstRow = enabled("firstRow", 0x20),
      lastRow = enabled("lastRow", 0x40),
      firstCol = enabled("firstColumn", 0x80),
      lastCol = enabled("lastColumn", 0x100),
      bands = !enabled("noHBand", 0x200),
      verticalBands = !enabled("noVBand", 0x400);
    const rows = children(table, "tr"),
      grid = children(child(table, "tblGrid"), "gridCol").map(
        (c) => num(attr(c, "w"), 1440) / 20,
      );
    const available = paper.width - paper.left - paper.right;
    const declared = prop("tblW"),
      total = grid.reduce((a, b) => a + b, 0);
    const tableWidth =
      attr(declared, "type") === "pct"
        ? (available * num(attr(declared, "w"), 5000)) / 5000
        : attr(declared, "type") === "dxa" && num(attr(declared, "w"), 0) > 0
          ? num(attr(declared, "w"), 0) / 20
          : total || available;
    const defaultLeft = num(attr(child(margins, "left"), "w"), 108) / 20;
    const alignment = attr(prop("jc")),
      indent = num(attr(prop("tblInd"), "w"), 0) / 20;
    const tableX =
      alignment === "center"
        ? paper.left + (available - tableWidth) / 2
        : alignment === "right"
          ? paper.width - paper.right - tableWidth
          : paper.left + indent - defaultLeft;
    const rowBand = Math.max(1, num(attr(prop("tblStyleRowBandSize")), 1)),
      colBand = Math.max(1, num(attr(prop("tblStyleColBandSize")), 1));
    type CellPlan = {
      w: number;
      cell: X;
      paragraphs: Paragraph[];
      column: number;
      span: number;
      continuation: boolean;
      rowSpan: number;
      context: X[];
      padding: { top: number; bottom: number; left: number; right: number };
    };
    const prepared: { cells: CellPlan[]; height: number }[] = [],
      active = new Map<number, CellPlan>();
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex],
        cells = children(row, "tc");
      if (cells.some((c) => all(c, "tbl").length))
        throw Error(
          "Nested tables are not supported by the local converter yet.",
        );
      let column = 0;
      const plans: CellPlan[] = [];
      for (let ci = 0; ci < cells.length; ci++) {
        const cell = cells[ci],
          cp = child(cell, "tcPr"),
          span = Math.max(1, num(attr(child(cp, "gridSpan")), 1)),
          start = column;
        const w = total
          ? (grid.slice(column, column + span).reduce((a, b) => a + b, 0) /
              total) *
            tableWidth
          : tableWidth / cells.length;
        column += span;
        const types: string[] = [];
        if (
          bands &&
          !(firstRow && rowIndex === 0) &&
          !(lastRow && rowIndex === rows.length - 1)
        )
          types.push(
            Math.floor((rowIndex - (firstRow ? 1 : 0)) / rowBand) % 2 === 0
              ? "band1Horz"
              : "band2Horz",
          );
        if (verticalBands)
          types.push(
            Math.floor((ci - (firstCol ? 1 : 0)) / colBand) % 2 === 0
              ? "band1Vert"
              : "band2Vert",
          );
        if (firstCol && ci === 0) types.push("firstCol");
        if (lastCol && ci === cells.length - 1) types.push("lastCol");
        if (firstRow && rowIndex === 0) types.push("firstRow");
        if (lastRow && rowIndex === rows.length - 1) types.push("lastRow");
        const context = [
          ...chain,
          ...types.flatMap((type) =>
            chain.flatMap((s) =>
              children(s, "tblStylePr").filter((p) => attr(p, "type") === type),
            ),
          ),
        ];
        const cm = child(cp, "tcMar");
        const padding = { top: 0, bottom: 0, left: 5.4, right: 5.4 };
        for (const side of ["top", "bottom", "left", "right"] as const)
          padding[side] =
            num(
              attr(child(cm, side) || child(margins, side), "w"),
              padding[side] * 20,
            ) / 20;
        const merge = child(cp, "vMerge"),
          continuation = !!merge && attr(merge) !== "restart",
          owner = active.get(start);
        if (continuation && (!owner || owner.span !== span))
          throw Error("The document has an invalid merged table cell.");
        if (continuation) owner!.rowSpan++;
        const plan: CellPlan = {
          w,
          cell,
          column: start,
          span,
          continuation,
          rowSpan: 1,
          context,
          padding,
          paragraphs: [],
        };
        for (const p of children(cell, "p"))
          plan.paragraphs.push(
            await paragraph(
              p,
              Math.max(1, w - padding.left - padding.right),
              context,
            ),
          );
        if (plan.paragraphs.some((p) => p.anchors.length))
          throw Error(
            "Floating drawings inside table cells are not supported yet. Set those drawings to inline in Word before converting.",
          );
        if (!continuation) {
          if (merge) active.set(start, plan);
          else active.delete(start);
        }
        plans.push(plan);
      }
      const contentHeight = (c: CellPlan) =>
        c.paragraphs.reduce(
          (sum, p, i) =>
            sum +
            Math.max(i ? c.paragraphs[i - 1].after : 0, p.before) +
            p.lines.reduce((n, l) => n + lineHeight(l, p), 0),
          c.padding.top + c.padding.bottom,
        ) + (c.paragraphs.at(-1)?.after || 0);
      const rh = child(child(row, "trPr"), "trHeight");
      const height =
        Math.max(
          1,
          num(attr(rh), 0) / 20,
          ...plans.filter((c) => !c.continuation).map(contentHeight),
        ) + 1;
      prepared.push({ cells: plans, height });
    }
    if (!decorating) {
      y -= previousAfter;
      previousAfter = 0;
    }
    for (let rowIndex = 0; rowIndex < prepared.length; rowIndex++) {
      const row = prepared[rowIndex],
        height = row.height;
      const span = Math.max(1, ...row.cells.map((c) => c.rowSpan)),
        required = prepared
          .slice(rowIndex, rowIndex + span)
          .reduce((n, r) => n + r.height, 0);
      if (required > paper.height - paper.top - paper.bottom)
        throw Error(
          "A table row or merged cell is taller than a page. Split it in Word before converting.",
        );
      if (!decorating && y - required < paper.bottom) newPage();
      let cursor = tableX;
      const rowTop = y;
      for (const c of row.cells) {
        const x = cursor;
        cursor += c.w;
        if (c.continuation) continue;
        const cellHeight = prepared
          .slice(rowIndex, rowIndex + c.rowSpan)
          .reduce((n, r) => n + r.height, 0);
        const cp = child(c.cell, "tcPr"),
          cprop = (name: string) =>
            child(cp, name) ||
            c.context
              .map((p) => child(child(p, "tcPr"), name))
              .filter(Boolean)
              .at(-1);
        const fill = attr(cprop("shd"), "fill");
        if (/^[0-9a-f]{6}$/i.test(fill))
          emit((target) =>
            target.drawRectangle({
              x,
              y: rowTop - cellHeight,
              width: c.w,
              height: cellHeight,
              color: color(fill),
            }),
          );
        const own = cprop("tcBorders");
        for (const side of ["top", "bottom", "left", "right"]) {
          const outside =
            side === "top"
              ? rowIndex === 0
              : side === "bottom"
                ? rowIndex + c.rowSpan === prepared.length
                : side === "left"
                  ? c.column === 0
                  : cursor >= tableX + tableWidth - 0.01;
          const edge =
            child(own, side) ||
            child(
              borders,
              outside
                ? side
                : side === "top" || side === "bottom"
                  ? "insideH"
                  : "insideV",
            );
          if (!edge || ["nil", "none"].includes(attr(edge))) continue;
          const start = {
              x: side === "right" ? x + c.w : x,
              y: side === "bottom" ? rowTop - cellHeight : rowTop,
            },
            end = {
              x: side === "left" ? x : x + c.w,
              y: side === "top" ? rowTop : rowTop - cellHeight,
            };
          emit((target) =>
            target.drawLine({
              start,
              end,
              thickness: Math.max(0.1, num(attr(edge, "sz"), 4) / 8),
              color: color(attr(edge, "color")),
            }),
          );
        }
        let top = rowTop - c.padding.top - 0.5,
          after = 0;
        for (const plan of c.paragraphs) {
          top -= Math.max(after, plan.before);
          plan.lines.forEach((line, i) => {
            drawLine(
              line,
              plan,
              x + c.padding.left,
              top,
              c.w - c.padding.left - c.padding.right,
              i,
            );
            top -= lineHeight(line, plan);
          });
          after = plan.after;
        }
      }
      y -= height;
    }
    previousAfter = 0;
    previousStyle = "";
  };
  const blocks = children(body),
    sections: { blocks: X[]; props: X | undefined }[] = [];
  let pending: X[] = [];
  for (const b of blocks) {
    if (b.localName === "sectPr") {
      sections.push({ blocks: pending, props: b });
      pending = [];
    } else {
      pending.push(b);
      const props = child(child(b, "pPr"), "sectPr");
      if (props) {
        sections.push({ blocks: pending, props });
        pending = [];
      }
    }
  }
  if (pending.length || !sections.length)
    sections.push({ blocks: pending, props: undefined });
  let processed = 0;
  for (const section of sections) {
    if (!section.blocks.length && pdf.getPageCount()) continue;
    const size = child(section.props, "pgSz"),
      m = child(section.props, "pgMar");
    const width = num(attr(size, "w"), paper.width * 20) / 20,
      height = num(attr(size, "h"), paper.height * 20) / 20;
    paper = {
      width,
      height,
      top: num(attr(m, "top"), paper.top * 20) / 20,
      bottom: num(attr(m, "bottom"), paper.bottom * 20) / 20,
      left: num(attr(m, "left"), paper.left * 20) / 20,
      right: num(attr(m, "right"), paper.right * 20) / 20,
    };
    if (
      width < 36 ||
      height < 36 ||
      width > 14400 ||
      height > 14400 ||
      paper.top + paper.bottom >= height - 12 ||
      paper.left + paper.right >= width - 12
    )
      throw Error("The document has invalid page dimensions or margins.");
    if (num(attr(child(section.props, "cols"), "num"), 1) > 1)
      throw Error(
        "Multi-column sections are not supported by the local converter yet.",
      );
    refs = {
      header: children(section.props, "headerReference").length
        ? children(section.props, "headerReference")
        : refs.header,
      footer: children(section.props, "footerReference").length
        ? children(section.props, "footerReference")
        : refs.footer,
    };
    headerDistance = num(attr(m, "header"), 720) / 20;
    footerDistance = num(attr(m, "footer"), 720) / 20;
    firstInSection = on(child(section.props, "titlePg"));
    newPage();
    let cached: Paragraph | undefined;
    for (let blockIndex = 0; blockIndex < section.blocks.length; blockIndex++) {
      const b = section.blocks[blockIndex],
        next = section.blocks[blockIndex + 1],
        width = paper.width - paper.left - paper.right;
      if (b.localName === "p") {
        const plan = cached || (await paragraph(b, width));
        const following =
          next?.localName === "p" ? await paragraph(next, width) : undefined;
        cached = following;
        await drawParagraph(b, paper.left, width, plan, following);
      } else if (b.localName === "tbl") {
        cached = undefined;
        await drawTable(b);
      } else throw Error("This document contains an unsupported block layout.");
      if (++processed % 25 === 0)
        progress(`Converting document… ${pdf.getPageCount()} pages created`);
    }
  }
  flush(page);
  decorating = true;
  for (let i = 0; i < decorations.length; i++) {
    const item = decorations[i];
    page = item.page;
    paper = item.paper;
    for (const kind of ["header", "footer"] as const) {
      const reference =
        item.refs[kind].find(
          (r) =>
            attr(r, "type") ===
            (item.first ? "first" : (i + 1) % 2 === 0 ? "even" : "default"),
        ) || item.refs[kind].find((r) => attr(r, "type") === "default");
      if (!reference) continue;
      const path = rels.get(reference.getAttributeNS(R, "id") || "");
      if (!path) throw Error("A document header or footer is missing.");
      const part = await xml(path);
      if (!part) throw Error("A document header or footer could not be read.");
      if (all(part, "drawing").length || all(part, "pict").length)
        throw Error("Images in headers or footers are not supported yet.");
      let instruction = "",
        inResult = false,
        filled = false;
      const fieldValue = (instruction: string) =>
        /^\s*NUMPAGES\b/i.test(instruction)
          ? String(decorations.length)
          : /^\s*PAGE\b/i.test(instruction)
            ? String(i + 1)
            : null;
      for (const run of all(part, "r")) {
        const marker = child(run, "fldChar"),
          type = attr(marker, "fldCharType");
        if (type === "begin") {
          instruction = "";
          inResult = false;
          filled = false;
        }
        if (type === "separate") inResult = true;
        if (type === "end") {
          inResult = false;
          instruction = "";
        }
        if (child(run, "instrText"))
          instruction += child(run, "instrText")!.textContent || "";
        if (inResult && fieldValue(instruction) !== null)
          for (const t of children(run, "t")) {
            t.textContent = filled ? "" : fieldValue(instruction);
            filled = true;
          }
      }
      for (const field of all(part, "fldSimple")) {
        const value = fieldValue(attr(field, "instr"));
        if (value !== null) {
          let first = true;
          for (const t of all(field, "t")) {
            t.textContent = first ? value : "";
            first = false;
          }
        }
      }
      const ps = await Promise.all(
        children(part, "p").map((p) =>
          paragraph(p, paper.width - paper.left - paper.right),
        ),
      );
      const regionHeight = ps.reduce(
        (sum, p) =>
          sum +
          p.before +
          p.after +
          p.lines.reduce((n, l) => n + lineHeight(l, p), 0),
        0,
      );
      y =
        kind === "header"
          ? paper.height - item.header
          : item.footer + regionHeight - (ps.at(-1)?.after || 0);
      for (const b of children(part)) {
        if (b.localName === "p") await drawParagraph(b);
        else if (b.localName === "tbl") await drawTable(b);
      }
    }
  }
  if (!pdf.getPageCount()) throw Error("No pages could be converted.");
  progress("Preparing your PDF…");
  const bytes = await pdf.save();
  return { bytes, pages: pdf.getPageCount(), warnings: [...warnings] };
}

function checkImage(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0,
    h = 0;
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47) {
    w = view.getUint32(16);
    h = view.getUint32(20);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let p = 2;
    while (p + 4 < bytes.length) {
      if (bytes[p++] !== 255) continue;
      const marker = bytes[p++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(p);
      if (length < 2 || p + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) {
        h = view.getUint16(p + 3);
        w = view.getUint16(p + 5);
        break;
      }
      p += length;
    }
  }
  if (!w || !h) throw Error("Only embedded PNG and JPEG images are supported.");
  if (w * h > 40_000_000)
    throw Error(
      "An image exceeds the local decoding limit. Reduce its resolution in Word before converting.",
    );
}
