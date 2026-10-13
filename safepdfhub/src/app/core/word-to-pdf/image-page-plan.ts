import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from '@xmldom/xmldom';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  A = 'http://schemas.openxmlformats.org/drawingml/2006/main',
  R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
export interface ImagePage {
  path: string;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}
export function parseSafeXml(xml: string): XmlDocument {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Document XML declarations are not supported.');
  return new DOMParser({
    onError: () => {
      throw Error('The document contains damaged XML.');
    },
  }).parseFromString(xml, 'application/xml');
}
/** Strictly recognize the full-page JPEG DOCX format emitted by our PDF-to-Word exporter.
 * Content needing Word layout always falls back. No raster decoding or recompression. */
export function imagePagePlan(documentXml: string, relationshipsXml: string): ImagePage[] | null {
  const doc = parseSafeXml(documentXml),
    rels = parseSafeXml(relationshipsXml);
  const drawingNames = new Map([
    [
      A,
      new Set([
        'graphic',
        'graphicData',
        'graphicFrameLocks',
        'blip',
        'stretch',
        'fillRect',
        'xfrm',
        'off',
        'ext',
        'prstGeom',
        'avLst',
      ]),
    ],
    [WP, new Set(['inline', 'extent', 'docPr', 'cNvGraphicFramePr'])],
    [PIC, new Set(['pic', 'nvPicPr', 'cNvPr', 'cNvPicPr', 'blipFill', 'spPr'])],
  ]);
  const allowed = new Set([
    'document',
    'body',
    'p',
    'pPr',
    'spacing',
    'r',
    'rPr',
    'sz',
    'drawing',
    'sectPr',
    'type',
    'pgSz',
    'pgMar',
  ]);
  for (const e of Array.from(doc.getElementsByTagName('*'))) {
    if (e.namespaceURI === W) {
      if (!allowed.has(e.localName || '')) return null;
    } else if (!drawingNames.get(e.namespaceURI || '')?.has(e.localName || '')) return null;
    if (
      e.namespaceURI === A &&
      e.localName === 'xfrm' &&
      (e.hasAttribute('rot') || e.hasAttribute('flipH') || e.hasAttribute('flipV'))
    )
      return null;
    if (e.namespaceURI === A && e.localName === 'prstGeom' && e.getAttribute('prst') !== 'rect')
      return null;
  }
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) return null;
  const images = new Map<string, string>();
  for (const r of Array.from(rels.getElementsByTagName('*'))) {
    const target = r.getAttribute('Target') || '';
    if (
      r.localName === 'Relationship' &&
      r.getAttribute('Type') === R + '/image' &&
      r.getAttribute('TargetMode') !== 'External' &&
      /^media\/[A-Za-z0-9_.-]+\.jpe?g$/i.test(target)
    )
      images.set(r.getAttribute('Id') || '', 'word/' + target);
  }
  const pages: ImagePage[] = [];
  let pending: XmlElement[] = [];
  const finish = (sect: XmlElement): boolean => {
    if (pending.length !== 1) return false;
    const inline = pending[0],
      extent = inline.getElementsByTagNameNS(WP, 'extent')[0],
      blips = inline.getElementsByTagNameNS(A, 'blip');
    if (
      !/^PDF image \d+$/.test(
        inline.getElementsByTagNameNS(WP, 'docPr')[0]?.getAttribute('name') || '',
      ) ||
      !extent ||
      blips.length !== 1
    )
      return false;
    const path = images.get(blips[0].getAttributeNS(R, 'embed') || '');
    if (!path) return false;
    const size = sect.getElementsByTagNameNS(W, 'pgSz')[0],
      margins = sect.getElementsByTagNameNS(W, 'pgMar')[0],
      type = sect.getElementsByTagNameNS(W, 'type')[0];
    if (!size || !margins || (type && type.getAttributeNS(W, 'val') !== 'nextPage')) return false;
    for (const side of ['top', 'right', 'bottom', 'left', 'gutter'])
      if (Number(margins.getAttributeNS(W, side)) !== 0) return false;
    const width = Number(size.getAttributeNS(W, 'w')) / 20,
      height = Number(size.getAttributeNS(W, 'h')) / 20,
      imageWidth = Number(extent.getAttribute('cx')) / 12700,
      imageHeight = Number(extent.getAttribute('cy')) / 12700;
    if (
      ![width, height, imageWidth, imageHeight].every(
        (n) => Number.isFinite(n) && n >= 10 && n <= 14400,
      ) ||
      imageWidth > width ||
      imageHeight > height ||
      imageWidth < width * 0.8 ||
      imageHeight < height * 0.8
    )
      return false;
    pages.push({ path, width, height, imageWidth, imageHeight });
    pending = [];
    return true;
  };
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType !== 1) continue;
    const e = node as XmlElement;
    if (e.localName === 'sectPr') {
      if (!finish(e)) return null;
      continue;
    }
    if (e.localName !== 'p') return null;
    pending.push(...Array.from(e.getElementsByTagNameNS(WP, 'inline')));
    const sections = e.getElementsByTagNameNS(W, 'sectPr');
    if (sections.length > 1) return null;
    if (sections.length && !finish(sections[0])) return null;
  }
  return pages.length > 0 &&
    pending.length === 0 &&
    pages.length === doc.getElementsByTagNameNS(A, 'blip').length
    ? pages
    : null;
}
