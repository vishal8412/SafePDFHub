/// <reference types="node" />
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import JSZip from "jszip";
import { convertLocalWord } from "./local-word-pdf";
import { openDocx } from "./docx-archive";
const start =
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
const end = "</w:body></w:document>";
const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const assets = async (name: string) =>
  Uint8Array.from(readFileSync("src/assets/fonts/" + name));
async function fixture(
  body: string,
  files: Record<string, string | Uint8Array> = {},
) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", start + body + end);
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return new Blob([
    Uint8Array.from(
      await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    ).buffer,
  ]);
}
describe("Direct local Word to PDF", () => {
  it("generates a real PDF with text, table rows and explicit page breaks", async () => {
    const body =
      p("A selectable heading") +
      '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
      p("Left cell") +
      "</w:tc><w:tc>" +
      p("Right cell") +
      "</w:tc></w:tr></w:tbl>" +
      p("First page") +
      '<w:p><w:r><w:br w:type="page"/><w:t>Second page</w:t></w:r></w:p>';
    const result = await convertLocalWord(
      await fixture(body),
      assets,
      () => {},
    );
    expect(result.pages).toBe(2);
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const resources = pdf.getPage(0).node.Resources()!;
    expect(resources.toString()).toContain("/Font");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loaded = await getDocument({
      data: Uint8Array.from(result.bytes),
      disableFontFace: true,
    }).promise;
    const text = await (await loaded.getPage(1)).getTextContent();
    expect(
      text.items.map((item: { str?: string }) => item.str || "").join(""),
    ).toContain("A selectable heading");
    await loaded.destroy();
  });
  it("embeds and reuses images without rasterizing document text", async () => {
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const drawing =
      '<w:p><w:r><w:drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:extent cx="1270000" cy="1270000"/><w:blip r:embed="img"/></w:drawing></w:r></w:p>';
    const result = await convertLocalWord(
      await fixture(p("Image document") + drawing + drawing, {
        "word/media/a.png": png,
        "word/_rels/document.xml.rels":
          '<Relationships><Relationship Id="img" Target="media/a.png"/></Relationships>',
      }),
      assets,
      () => {},
    );
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPage(0).node.Resources()!.toString()).toContain("/XObject");
    expect(result.pages).toBe(1);
  });
  it("accepts a document XML part above the former 8 MB cutoff", async () => {
    const result = await convertLocalWord(
      await fixture(
        "<!--" + "x".repeat(8_100_000) + "-->" + p("Large XML document"),
      ),
      assets,
      () => {},
    );
    expect(result.pages).toBe(1);
  });
  it("paginates a long document without a whole-document HTML preview", async () => {
    const result = await convertLocalWord(
      await fixture(
        Array.from({ length: 250 }, (_, i) =>
          p(`Paragraph ${i}: readable content.`),
        ).join(""),
      ),
      assets,
      () => {},
    );
    expect(result.pages).toBeGreaterThan(3);
  });
  it("retains section page dimensions and repeats text headers", async () => {
    const header =
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      p("Header text") +
      "</w:hdr>";
    const body =
      p("Body text") +
      '<w:sectPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:headerReference w:type="default" r:id="h"/><w:pgSz w:w="16840" w:h="11900"/></w:sectPr>';
    const result = await convertLocalWord(
      await fixture(body, {
        "word/header1.xml": header,
        "word/_rels/document.xml.rels":
          '<Relationships><Relationship Id="h" Target="header1.xml"/></Relationships>',
      }),
      assets,
      () => {},
    );
    expect((await PDFDocument.load(result.bytes)).getPage(0).getSize()).toEqual(
      { width: 842, height: 595 },
    );
  });
  it("renders grouped vector drawings and text boxes once, excluding VML fallback", async () => {
    const body = `<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
      <mc:Choice Requires="wps"><w:drawing><wp:inline><wp:extent cx="2540000" cy="1270000"/><a:graphic><a:graphicData><wpg:wgp><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="1270000"/><a:chExt cx="2540000" cy="1270000"/></a:xfrm></wpg:grpSpPr>
      <wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="0"/></a:xfrm><a:custGeom><a:pathLst><a:path w="2540000" h="0"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="2540000" y="0"/></a:lnTo></a:path></a:pathLst></a:custGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr></wps:wsp>
      <wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill></wps:spPr><wps:txbx><w:txbxContent>${p("Chart label")}</w:txbxContent></wps:txbx><wps:bodyPr lIns="0" rIns="0" tIns="0"/></wps:wsp>
      </wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>
      <mc:Fallback><w:pict><w:txbxContent>${p("DUPLICATE FALLBACK")}</w:txbxContent></w:pict></mc:Fallback>
    </mc:AlternateContent></w:r></w:p>`;
    const result = await convertLocalWord(
      await fixture(body),
      assets,
      () => {},
    );
    const parsed = await PDFDocument.load(result.bytes);
    for (const [, obj] of parsed.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream)
        expect(
          new TextDecoder().decode(decodePDFRawStream(obj).decode()),
        ).not.toMatch(/\b(?:NaN|Infinity)\b/);
    }
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await getDocument({
      data: Uint8Array.from(result.bytes),
      disableFontFace: true,
    }).promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items
      .map((item: { str?: string }) => item.str || "")
      .join("");
    expect(text).toContain("Chart label");
    expect(text).not.toContain("DUPLICATE");
    expect(text.match(/Chart label/g)?.length).toBe(1);
    expect(result.pages).toBe(1);
    await pdf.destroy();
  });
  it("positions text at Word tab stops instead of inserting four spaces", async () => {
    const body = `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs></w:pPr><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>`;
    const result = await convertLocalWord(
      await fixture(body),
      assets,
      () => {},
    );
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await getDocument({
      data: Uint8Array.from(result.bytes),
      disableFontFace: true,
    }).promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    const label = content.items.find(
      (item: { str?: string }) => item.str === "B",
    ) as { transform: number[] };
    expect(label.transform[4]).toBeCloseTo(144, 1);
    await pdf.destroy();
  });
  it("converts vertically merged cells without repeating their text", async () => {
    const body = `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p("Merged heading")}</w:tc><w:tc>${p("First row")}</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>${p("")}</w:tc><w:tc>${p("Second row")}</w:tc></w:tr></w:tbl>`;
    const result = await convertLocalWord(
      await fixture(body),
      assets,
      () => {},
    );
    expect(result.pages).toBe(1);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await getDocument({
      data: Uint8Array.from(result.bytes),
      disableFontFace: true,
    }).promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items
      .map((item: { str?: string }) => item.str || "")
      .join("");
    expect(text).toContain("Merged heading");
    expect(text).toContain("Second row");
    expect(text.match(/Merged heading/g)?.length).toBe(1);
    await pdf.destroy();
  });
  it("preserves the six-page image-wrapping fixture, coordinates, layers and final table", async () => {
    const source = Uint8Array.from(
      readFileSync("src/app/core/word-to-pdf/fixtures/image-wrapping.docx"),
    );
    const result = await convertLocalWord(
      new Blob([source.buffer]),
      assets,
      () => {},
    );
    expect(result.pages).toBe(6);
    const { getDocument, OPS } =
      await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await getDocument({
      data: Uint8Array.from(result.bytes),
      disableFontFace: true,
    }).promise;
    const pages = await Promise.all(
      Array.from({ length: 6 }, (_, i) => pdf.getPage(i + 1)),
    );
    const texts = await Promise.all(pages.map((p) => p.getTextContent()));
    const ops = await Promise.all(pages.map((p) => p.getOperatorList()));
    const images = (op: (typeof ops)[number]) => {
      type Matrix = number[];
      let m: Matrix = [1, 0, 0, 1, 0, 0];
      const stack: Matrix[] = [];
      const found: {
        x: number;
        top: number;
        width: number;
        height: number;
        index: number;
      }[] = [];
      const multiply = (a: Matrix, b: Matrix) => [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
      ];
      op.fnArray.forEach((fn: number, i: number) => {
        if (fn === OPS.save) stack.push([...m]);
        else if (fn === OPS.restore) m = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) m = multiply(m, op.argsArray[i]);
        else if (
          [
            OPS.paintImageXObject,
            OPS.paintInlineImageXObject,
            OPS.paintImageMaskXObject,
          ].includes(fn)
        )
          found.push({
            x: m[4],
            top: 792 - m[5] - m[3],
            width: m[0],
            height: m[3],
            index: i,
          });
      });
      return found;
    };
    const figures = ops.map(images);
    expect(figures.map((p) => p.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(figures[0][0].width).toBeCloseTo(5733288 / 12700, 1); // Never shrink the authored image to the text column.
    expect(figures[1][0].x).toBeCloseTo(324, 1);
    expect(figures[2][0].x).toBeCloseTo(90, 1);
    expect(figures[3][0].x).toBeCloseTo(72, 1);
    expect(figures[5][0].x).toBeCloseTo(414, 1);
    expect(figures[3][0].index).toBeLessThan(
      ops[3].fnArray.indexOf(OPS.beginText),
    );
    expect(figures[5][0].index).toBeGreaterThan(
      ops[5].fnArray.indexOf(OPS.beginText),
    );
    const words = (i: number) =>
      texts[i].items.filter(
        (x: any) => typeof x.str === "string" && x.str.trim(),
      ) as { str: string; width: number; transform: number[] }[];
    for (const i of [1, 2, 3, 4, 5])
      expect(792 - words(i)[0].transform[5]).toBeLessThan(90);
    expect(
      words(1)
        .map((w) => w.str)
        .join(" "),
    ).not.toContain("Tight Text");
    expect(
      words(2)
        .map((w) => w.str)
        .join(" "),
    ).toContain("Tight Text Wrapping");
    expect(figures[2][0].top).toBeGreaterThan(150);
    expect(figures[2][0].top).toBeLessThan(170);
    const beside = words(1).filter(
      (w) => 792 - w.transform[5] > 160 && 792 - w.transform[5] < 335,
    );
    expect(beside.length).toBeGreaterThan(20);
    for (const word of beside)
      expect(word.transform[4] + word.width).toBeLessThanOrEqual(315.1);
    const over = words(3).find((w) => w.str.includes("Behind-text"))!;
    expect(792 - over.transform[5]).toBeGreaterThan(figures[3][0].top);
    expect(792 - over.transform[5]).toBeLessThan(
      figures[3][0].top + figures[3][0].height,
    );
    expect(
      words(5)
        .map((w) => w.str)
        .join(" "),
    ).toContain("After replacing");
    await pdf.destroy();
  });

  it("does not create a blank page by measuring a page-break-only paragraph at the bottom", async () => {
    const body =
      '<w:p><w:pPr><w:spacing w:line="1200" w:lineRule="exact" w:after="200"/></w:pPr><w:r><w:t>Page one</w:t></w:r></w:p>' +
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
      p("Page two") +
      '<w:sectPr><w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="1200" w:bottom="1200" w:left="300" w:right="300"/></w:sectPr>';
    expect(
      (await convertLocalWord(await fixture(body), assets, () => {})).pages,
    ).toBe(2);
  });
  it("preserves intentional consecutive manual page breaks", async () => {
    const br = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    expect(
      (
        await convertLocalWord(
          await fixture(p("First") + br + br + p("Third")),
          assets,
          () => {},
        )
      ).pages,
    ).toBe(3);
  });
  it("uses saved paragraph-start page hints without duplicating explicit breaks", async () => {
    const hinted =
      "<w:p><w:r><w:lastRenderedPageBreak/><w:t>Second</w:t></w:r></w:p>";
    for (const explicit of [
      "",
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    ]) {
      const result = await convertLocalWord(
        await fixture(p("First") + explicit + hinted),
        assets,
        () => {},
      );
      expect(result.pages).toBe(2);
    }
  });
  it("inherits list numbering and hanging indents from paragraph styles", async () => {
    const item = (text: string) =>
      '<w:p><w:pPr><w:pStyle w:val="Items"/></w:pPr><w:r><w:t>' +
      text +
      "</w:t></w:r></w:p>";
    const result = await convertLocalWord(
      await fixture(item("Alpha") + item("Beta"), {
        "word/styles.xml":
          '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Items" w:type="paragraph"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>',
        "word/numbering.xml":
          '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
      }),
      assets,
      () => {},
    );
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await getDocument({
      data: Uint8Array.from(result.bytes),
      disableFontFace: true,
    }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent())
      .items as any[];
    expect(items.map((i) => i.str).join(" ")).toMatch(
      /1\.\s+Alpha.*2\.\s+Beta/,
    );
    expect(items.find((i) => i.str === "1.").transform[4]).toBeCloseTo(90);
    expect(items.find((i) => i.str === "Alpha").transform[4]).toBeCloseTo(108);
    await pdf.destroy();
  });
  it("keeps orphan and widow lines together unless explicitly disabled", async () => {
    for (const enabled of [true, false]) {
      const body =
        '<w:p><w:pPr><w:spacing w:line="900" w:lineRule="exact"/></w:pPr><w:r><w:t>First</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:spacing w:line="400" w:lineRule="exact"/><w:widowControl w:val="' +
        (enabled ? "1" : "0") +
        '"/></w:pPr><w:r><w:t>Alpha bravo charlie delta echo foxtrot golf hotel india juliet</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="1200" w:bottom="1200" w:left="500" w:right="500"/></w:sectPr>';
      const result = await convertLocalWord(
        await fixture(body),
        assets,
        () => {},
      );
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const pdf = await getDocument({
        data: Uint8Array.from(result.bytes),
        disableFontFace: true,
      }).promise;
      const text = (await (await pdf.getPage(1)).getTextContent()).items
        .map((i: any) => i.str)
        .join(" ");
      expect(text.includes("Alpha")).toBe(!enabled);
      await pdf.destroy();
    }
  });
  it("converts the large reference fixture to 49 pages without losing its final content", async () => {
    const source = Uint8Array.from(
      readFileSync("src/app/core/word-to-pdf/fixtures/large-pagination.docx"),
    );
    const result = await convertLocalWord(
      new Blob([source.buffer]),
      assets,
      () => {},
    );
    expect(result.pages).toBe(49);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await getDocument({
      data: Uint8Array.from(result.bytes),
      disableFontFace: true,
    }).promise;
    const text = async (n: number) =>
      (await (await pdf.getPage(n)).getTextContent()).items
        .map((i: any) => i.str)
        .join(" ").replace(/\s+/g, " ");
    expect(await text(3)).not.toContain("1.3 The DOCX Format");
    expect(await text(4)).toContain("1.3 The DOCX Format");
    expect(await text(7)).toContain("•");
    expect(await text(7)).toContain("1.");
    expect(await text(17)).toContain("Programming Libraries");
    expect(await text(49)).toContain("This concludes the appendix material");
    await pdf.destroy();
  }, 15000);
  it("does not report success after dropping equations or unsupported content", async () => {
    await expect(
      convertLocalWord(
        await fixture("<w:oMath>equation</w:oMath>"),
        assets,
        () => {},
      ),
    ).rejects.toThrow("cannot preserve");
  });
  it("reports missing external images instead of fetching their URLs", async () => {
    const body = "<w:p><w:r><w:drawing><w:blip/></w:drawing></w:r></w:p>";
    await expect(
      convertLocalWord(await fixture(body), assets, () => {}),
    ).rejects.toThrow("linked externally");
  });
  it("reads a 200 MB archive by ranges without allocating the complete input", async () => {
    const source = new Uint8Array(
      await (await fixture(p("Boundary file"))).arrayBuffer(),
    );
    const prefix = 200_000_000 - source.length,
      view = new DataView(source.buffer);
    const end = source.length - 22,
      central = view.getUint32(end + 16, true),
      count = view.getUint16(end + 10, true);
    let at = central;
    for (let i = 0; i < count; i++) {
      view.setUint32(at + 42, view.getUint32(at + 42, true) + prefix, true);
      at +=
        46 +
        view.getUint16(at + 28, true) +
        view.getUint16(at + 30, true) +
        view.getUint16(at + 32, true);
    }
    view.setUint32(end + 16, central + prefix, true);
    let bytesRead = 0;
    const virtual = {
      size: 200_000_000,
      slice: (start = 0, end = 200_000_000) => {
        bytesRead += end - start;
        expect(end - start).toBeLessThan(100_000);
        const out = new Uint8Array(end - start),
          from = Math.max(start, prefix),
          to = Math.min(end, 200_000_000);
        if (to > from)
          out.set(source.subarray(from - prefix, to - prefix), from - start);
        return new Blob([out.buffer]);
      },
    } as Blob;
    const result = await convertLocalWord(virtual, assets, () => {});
    expect(result.pages).toBe(1);
    expect(bytesRead).toBeLessThan(100_000);
  });
  it("produces a reviewable PDF with styled text, lists, table and section pagination", async () => {
    const content =
      '<w:p><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>Local Word conversion</w:t></w:r></w:p>' +
      p(
        "This PDF was generated entirely on the device. Text remains selectable.",
      ) +
      '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>' +
      "A paragraph with enough words to demonstrate automatic line wrapping and readable spacing. ".repeat(
        8,
      ) +
      "</w:t></w:r></w:p>" +
      "<w:tbl><w:tr><w:tc>" +
      p("Feature") +
      "</w:tc><w:tc>" +
      p("Result") +
      "</w:tc></w:tr><w:tr><w:tc>" +
      p("Private processing") +
      "</w:tc><w:tc>" +
      p("No uploads") +
      "</w:tc></w:tr></w:tbl>" +
      p("End of document.");
    const result = await convertLocalWord(
      await fixture(content),
      assets,
      () => {},
    );
    if (process.env["WORD_PDF_SAMPLE"])
      writeFileSync(process.env["WORD_PDF_SAMPLE"], result.bytes);
    expect(result.pages).toBe(1);
  });
  it("checks archive CRC and rejects oversized inputs", async () => {
    await expect(openDocx({ size: 200_000_001 } as Blob)).rejects.toThrow(
      "200 MB",
    );
    const file = await fixture(p("Test"));
    const archive = await openDocx(file);
    const part = archive.parts.get("word/document.xml")!;
    part.crc = 0;
    await expect(archive.read(part.name)).rejects.toThrow("integrity");
  });
});
