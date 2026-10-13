import { normalizeHeadingBoxes, normalizeListSymbols, tagTabStops } from './word-layout';
const xml = (wrap = 'wrapTopAndBottom', rotation = '') => new DOMParser().parseFromString(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body><w:p><w:pPr><w:spacing w:before="160"/></w:pPr><w:r><mc:AlternateContent><mc:Choice><w:drawing><wp:anchor><wp:${wrap}/><a:xfrm ${rotation}/><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="DFDFDF"/></a:solidFill><w:txbxContent><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Heading</w:t></w:r></w:p></w:txbxContent></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:t>Heading</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p></w:body></w:document>`, 'application/xml');
describe('Word flow layout normalization', () => {
  it('keeps heading once with formatting, shading and spacing', () => {
    const doc = xml(); expect(normalizeHeadingBoxes(doc)).toBe(1);
    expect(doc.documentElement.textContent).toBe('Heading');
    expect(doc.getElementsByTagName('w:b').length).toBe(1);
    expect(doc.getElementsByTagName('w:shd')[0].getAttribute('w:fill')).toBe('DFDFDF');
    expect(doc.getElementsByTagName('w:spacing')[0].getAttribute('w:before')).toBe('160');
    expect(normalizeHeadingBoxes(doc)).toBe(0);
  });
  it('preserves side-wrapped text boxes', () => expect(normalizeHeadingBoxes(xml('wrapSquare'))).toBe(0));
  it('preserves rotated text boxes', () => expect(normalizeHeadingBoxes(xml('wrapTopAndBottom','rot="90000"'))).toBe(0));
  it('does not remove adjacent paragraph text', () => {
    const doc=xml(); const p=doc.getElementsByTagName('w:p')[0]; p.appendChild(doc.createElementNS(p.namespaceURI,'w:r'));
    expect(normalizeHeadingBoxes(doc)).toBe(0);
  });
  it('maps known legacy list symbols once', () => {
    const doc = new DOMParser().parseFromString('<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:lvl><w:lvlText w:val="&#xF0FC;"/><w:rPr><w:rFonts w:ascii="Wingdings"/></w:rPr></w:lvl></w:numbering>', 'application/xml');
    expect(normalizeListSymbols(doc)).toBe(1);
    expect(doc.getElementsByTagName('w:lvlText')[0].getAttribute('w:val')).toBe('✓');
    expect(normalizeListSymbols(doc)).toBe(0);
  });
});

describe('Tab metadata', () => {
  it('carries source stops as inert attributes with validated values', () => {
    const node = { tabs: [{position:'72pt',style:'right',leader:'dot'}], cssStyle:{} as Record<string,string> };
    tagTabStops(node);
    expect(node.cssStyle['$data-safepdf-tab-stops']).toBe('72 right dot');
  });
});
