import { normalizeHeadingBoxes, normalizeListSymbols, tagTabStops, normalizeTableIndents, normalizeParagraphMarks, applyParagraphStyleFonts } from './word-layout';
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

describe('Source layout geometry', () => {
  const parse = (body: string) => new DOMParser().parseFromString(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`, 'application/xml');
  it('adapts an actual Word table indent without changing its cell padding', () => {
    const doc = parse('<w:tbl><w:tblPr><w:tblInd w:w="341" w:type="dxa"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:tbl>');
    expect(normalizeTableIndents(doc)).toBe(1);
    expect(doc.getElementsByTagName('w:ind')[0].getAttribute('w:start')).toBe('341');
    expect(doc.getElementsByTagName('w:left')[0].getAttribute('w:w')).toBe('108');
    expect(normalizeTableIndents(doc)).toBe(0);
  });
  it('does not override centered, floating, or percentage table positioning', () => {
    for (const extra of ['<w:jc w:val="center"/>','<w:tblpPr/>']) {
      expect(normalizeTableIndents(parse(`<w:tblPr><w:tblInd w:w="341" w:type="dxa"/>${extra}</w:tblPr>`))).toBe(0);
    }
    expect(normalizeTableIndents(parse('<w:tblPr><w:tblInd w:w="50" w:type="pct"/></w:tblPr>'))).toBe(0);
  });
  it('retains negative and zero table indents', () => {
    for (const value of ['-100','0']) {
      const doc=parse(`<w:tblPr><w:tblInd w:w="${value}" w:type="dxa"/></w:tblPr>`);
      expect(normalizeTableIndents(doc)).toBe(1);
      expect(doc.getElementsByTagName('w:ind')[0].getAttribute('w:start')).toBe(value);
    }
  });
  it('preserves a heading vertical offset, height and exact width', () => {
    const doc=xml();const anchor=doc.getElementsByTagName('wp:anchor')[0];
    const fragment=new DOMParser().parseFromString('<root xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:positionH relativeFrom="page"><wp:posOffset>685800</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>127000</wp:posOffset></wp:positionV><wp:extent cx="6350000" cy="254000"/></root>','application/xml');
    for(const c of [...fragment.documentElement.children])anchor.append(doc.importNode(c,true));
    const section=parse('<w:sectPr><w:pgSz w:w="11910"/><w:pgMar w:left="850" w:right="425"/></w:sectPr>').getElementsByTagName('w:sectPr')[0];
    doc.getElementsByTagName('w:body')[0].append(doc.importNode(section,true));
    normalizeHeadingBoxes(doc);
    const spacing=doc.getElementsByTagName('w:spacing')[0],indent=doc.getElementsByTagName('w:ind')[0];
    expect(spacing.getAttribute('w:before')).toBe('360');
    expect(spacing.getAttribute('w:line')).toBe('400');
    expect(indent.getAttribute('w:left')).toBe('230');
    expect(indent.getAttribute('w:right')).toBe('405');
  });
  it('carries paragraph mark font size into the parser without changing the run', () => {
    const doc=parse('<w:p><w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t>Large run</w:t></w:r></w:p>');
    expect(normalizeParagraphMarks(doc)).toBe(1);
    expect(doc.getElementsByTagName('w:pPr')[0].lastElementChild?.getAttribute('w:val')).toBe('20');
    expect(doc.getElementsByTagName('w:r')[0].getElementsByTagName('w:sz')[0].getAttribute('w:val')).toBe('28');
    expect(normalizeParagraphMarks(doc)).toBe(0);
  });
  it('sets paragraph struts from defaults and paragraph styles, not character styles', () => {
    const styles=[{styles:[{target:'span',values:{'font-size':'11pt','font-weight':'bold'}}]},{target:'p',styles:[{target:'span',values:{'font-size':'10pt'}}]},{target:'span',styles:[{target:'span',values:{'font-size':'20pt'}}]}];
    applyParagraphStyleFonts(styles);
    expect(styles[0].styles[1]).toEqual({target:'p',values:{'font-size':'11pt'}});
    expect(styles[1].styles[1].values['font-size']).toBe('10pt');
    expect(styles[2].styles).toHaveLength(1);
  });
  it('retains automatic line multipliers including inherited values and missing rule', () => {
    const node={styleName:'Child',cssStyle:{} as Record<string,string>};
    tagTabStops(node,[{id:'Child',basedOn:'Base'},{id:'Base',paragraphProps:{lineSpacing:{line:278,lineRule:'auto'}}}]);
    expect(Number(node.cssStyle['$data-word-auto-line'])).toBeCloseTo(278/240);
    const exact={lineSpacing:{line:240,lineRule:'exact'},cssStyle:{} as Record<string,string>};
    tagTabStops(exact);expect(exact.cssStyle['$data-word-auto-line']).toBeUndefined();
  });
});

describe('Tab metadata', () => {
  it('carries source stops as inert attributes with validated values', () => {
    const node = { tabs: [{position:'72pt',style:'right',leader:'dot'}], cssStyle:{} as Record<string,string> };
    tagTabStops(node);
    expect(node.cssStyle['$data-safepdf-tab-stops']).toBe('72 right dot');
  });
});
