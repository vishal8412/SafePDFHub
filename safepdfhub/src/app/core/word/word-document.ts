/** Small, deterministic OOXML writer. No HTML import, macros, or external relationships. */
export interface WordRun {
  text: string;
  size: number;
  font: string;
  bold?: boolean;
  italic?: boolean;
  rtl?: boolean;
  color?: string;
  width?: number;
  scale?: number;
}
export interface WordLine {
  runs: WordRun[];
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WordImage {
  format?: "jpg" | "png";
  id: number;
  bytes: Uint8Array;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WordPage {
  width: number;
  height: number;
  lines: WordLine[];
  images: WordImage[];
  visual: boolean;
  positioned?: boolean;
  readingOrder?: boolean;
}
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
const twips = (n: number) => Math.max(0, Math.round(n * 20));
function run(r: WordRun): string {
  const size = Math.round(Math.max(4, Math.min(144, r.size)) * 2);
  return `<w:r><w:rPr><w:rFonts w:ascii="${xml(r.font)}" w:hAnsi="${xml(r.font)}" w:eastAsia="${xml(r.font)}" w:cs="${xml(r.font)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${r.color && /^[0-9a-f]{6}$/i.test(r.color) ? `<w:color w:val="${r.color}"/>` : ""}${r.scale ? `<w:w w:val="${Math.max(1, Math.min(600, Math.round(r.scale)))}"/>` : ""}${r.bold ? "<w:b/><w:bCs/>" : ""}${r.italic ? "<w:i/><w:iCs/>" : ""}${r.rtl ? "<w:rtl/>" : ""}</w:rPr><w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
}
function picture(im: WordImage, maxWidth: number, maxHeight: number): string {
  const scale = Math.min(1, maxWidth / im.width, maxHeight / im.height);
  const cx = Math.max(1, Math.round(im.width * scale * 12700)),
    cy = Math.max(1, Math.round(im.height * scale * 12700));
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${im.id}" name="PDF image ${im.id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${im.id}" name="image${im.id}.${im.format ?? "jpg"}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="img${im.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
function section(p: WordPage): string {
  const margin =
    p.visual || p.positioned
      ? 0
      : Math.min(36, ...p.lines.map((l) => Math.max(0, l.x)));
  return `<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="${twips(p.width)}" w:h="${twips(p.height)}"${p.width > p.height ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${twips(margin)}" w:right="${twips(margin)}" w:bottom="${twips(margin)}" w:left="${twips(margin)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
}
function positionedPage(p: WordPage, pageIndex: number): string {
  const anchor = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    body: string,
    z: number,
  ) =>
    `<w:r><w:pict><v:shape id="${id}" style="position:absolute;margin-left:${x.toFixed(3)}pt;margin-top:${y.toFixed(3)}pt;width:${width.toFixed(3)}pt;height:${height.toFixed(3)}pt;z-index:${z};mso-position-horizontal-relative:page;mso-position-vertical-relative:page" stroked="f" filled="f" o:allowincell="f" o:insetmode="custom">${body}</v:shape></w:pict></w:r>`;
  const pictures = p.images
    .map((im, i) =>
      anchor(
        `artwork${pageIndex + 1}_${i + 1}`,
        im.x,
        im.y,
        im.width,
        im.height,
        `<v:imagedata r:id="img${im.id}" o:title="PDF artwork"/>`,
        -1,
      ),
    )
    .join("");
  const text = p.lines
    .map((line, i) => {
      const cx = Math.round(Math.max(1, line.width + 4) * 12700),
        cy = Math.round(Math.max(line.height * 1.5, 4) * 12700);
      return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${Math.round(line.x * 12700)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${Math.round(line.y * 12700)}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${pageIndex * 100000 + i + 1}" name="PDF text ${pageIndex + 1}-${i + 1}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${twips(line.height * 1.2)}" w:lineRule="exact"/><w:ind w:left="0" w:right="0"/><w:widowControl w:val="0"/>${line.runs.some((r) => r.rtl) ? "<w:bidi/>" : ""}</w:pPr>${line.runs.map(run).join("")}</w:p></w:txbxContent></wps:txbx><wps:bodyPr rot="0" vert="horz" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
    })
    .join("");
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>${pictures}${text}</w:p>`;
}
export function documentXml(pages: WordPage[], pageOffset = 0): string {
  const body = pages
    .map((p, index) => {
      const margin =
        p.visual || p.positioned
          ? 0
          : Math.min(36, ...p.lines.map((l) => Math.max(0, l.x)));
      if (p.positioned || p.visual) {
        const content = positionedPage(p, index + pageOffset);
        return (
          content +
          (index === pages.length - 1
            ? section(p)
            : `<w:p><w:pPr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/>${section(p)}</w:pPr></w:p>`)
        );
      }
      const blocks = [
        ...p.lines.map((line) => ({ y: line.y, line })),
        ...p.images.map((image) => ({ y: image.y, image })),
      ];
      if (!p.readingOrder) blocks.sort((a, b) => a.y - b.y);
      const content =
        blocks
          .map((block) => {
            if ("image" in block)
              return picture(
                block.image,
                p.width - 2 * margin,
                p.height - 2 * margin - 4,
              );
            const l = block.line;
            return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${twips(l.height * 1.15)}" w:lineRule="atLeast"/><w:ind w:left="${twips(Math.max(0, l.x - margin))}"/>${l.runs.some((r) => r.rtl) ? "<w:bidi/>" : ""}</w:pPr>${l.runs.map(run).join("")}</w:p>`;
          })
          .join("") || "<w:p/>";
      return (
        content +
        (index === pages.length - 1
          ? section(p)
          : `<w:p><w:pPr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/>${section(p)}</w:pPr></w:p>`)
      );
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>${body}</w:body></w:document>`;
}
export async function packWord(
  pages: WordPage[],
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const images = pages.flatMap((p) => p.images);
  zip.file("word/document.xml", documentXml(pages));
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${images.map((im) => `<Relationship Id="img${im.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${im.id}.${im.format ?? "jpg"}"/>`).join("")}</Relationships>`,
  );
  for (const im of images)
    zip.file(`word/media/image${im.id}.${im.format ?? "jpg"}`, im.bytes, {
      compression: "STORE",
    });
  return zip.generateAsync(
    {
      type: "blob",
      mimeType: DOCX_MIME,
      compression: "DEFLATE",
      compressionOptions: { level: 1 },
    },
    (m) => onProgress?.(m.percent),
  );
}
