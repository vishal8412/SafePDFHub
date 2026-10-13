const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** Only flatten standalone rectangular headings that explicitly wrap above/below. */
export function normalizeHeadingBoxes(doc: Document): number {
  let count = 0;
  for (const alternate of [...doc.getElementsByTagNameNS(MC, 'AlternateContent')]) {
    const anchor = alternate.getElementsByTagNameNS(WP, 'anchor')[0];
    const box = anchor?.getElementsByTagNameNS(W, 'txbxContent')[0];
    const geometry = anchor?.getElementsByTagNameNS(A, 'prstGeom')[0];
    const paragraphs = box ? [...box.children] : [];
    const run = alternate.parentElement, outer = run?.parentElement;
    if (!anchor || !box || geometry?.getAttribute('prst') !== 'rect' ||
        !anchor.getElementsByTagNameNS(WP, 'wrapTopAndBottom').length ||
        paragraphs.length !== 1 || paragraphs[0].localName !== 'p' ||
        outer?.namespaceURI !== W || outer.localName !== 'p' ||
        [...outer.children].some(c => c !== run && c.localName !== 'pPr') ||
        [...run!.children].some(c => c !== alternate && c.localName !== 'rPr') ||
        anchor.getElementsByTagNameNS(A, 'xfrm')[0]?.hasAttribute('rot')) continue;
    const replacement = paragraphs[0].cloneNode(true) as Element;
    let props = replacement.getElementsByTagNameNS(W, 'pPr')[0];
    if (!props) { props = doc.createElementNS(W, 'w:pPr'); replacement.prepend(props); }
    const outerProps = [...outer.children].find(c => c.localName === 'pPr');
    for (const name of ['spacing', 'sectPr']) {
      const original = outerProps && [...outerProps.children].find(c => c.localName === name);
      if (original) {
        const existing = [...props.children].find(c => c.localName === name);
        if (name === 'spacing' && existing) {
          for (const attr of [...original.attributes]) existing.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
        } else props.append(original.cloneNode(true));
      }
    }
    const fill = anchor.getElementsByTagNameNS(A, 'solidFill')[0]?.getElementsByTagNameNS(A, 'srgbClr')[0]?.getAttribute('val');
    if (fill && /^[\da-f]{6}$/i.test(fill)) {
      const shade = doc.createElementNS(W, 'w:shd'); shade.setAttributeNS(W, 'w:fill', fill); props.append(shade);
    }
    const position = anchor.getElementsByTagNameNS(WP, 'positionH')[0];
    const section = [...doc.getElementsByTagNameNS(W, 'sectPr')].find(s => !!(outer.compareDocumentPosition(s) & 4));
    const pageMargin = Number(section?.getElementsByTagNameNS(W, 'pgMar')[0]?.getAttributeNS(W, 'left'));
    const x = Number(position?.getElementsByTagNameNS(WP, 'posOffset')[0]?.textContent) / 635;
    if (position?.getAttribute('relativeFrom') === 'page' && Number.isFinite(pageMargin) && Number.isFinite(x)) {
      const indent = doc.createElementNS(W, 'w:ind');
      indent.setAttributeNS(W, 'w:left', String(Math.round(x - pageMargin))); props.append(indent);
    }
    props.append(doc.createElementNS(W, 'w:keepNext'));
    outer.replaceWith(replacement); count++;
  }
  return count + normalizeRules(doc);
}
/** Preserve simple rectangular separators as paragraph borders instead of unsupported VML. */
function normalizeRules(doc: Document): number {
  let count = 0;
  for (const alternate of [...doc.getElementsByTagNameNS(MC, 'AlternateContent')]) {
    const anchor = alternate.getElementsByTagNameNS(WP, 'anchor')[0];
    const path = anchor?.getElementsByTagNameNS(A, 'custGeom')[0]?.getElementsByTagNameNS(A, 'path')[0];
    const points = path ? [...path.getElementsByTagNameNS(A, 'pt')].map(p => [Number(p.getAttribute('x')), Number(p.getAttribute('y'))]) : [];
    const fill = anchor?.getElementsByTagNameNS(A, 'solidFill')[0]?.getElementsByTagNameNS(A, 'srgbClr')[0]?.getAttribute('val');
    const height = Number(anchor?.getElementsByTagNameNS(WP, 'extent')[0]?.getAttribute('cy')) / 12700;
    const run = alternate.parentElement, p = run?.parentElement;
    if (!anchor || !path || !fill || !/^[\da-f]{6}$/i.test(fill) || !(height > 0 && height <= 6) ||
        !anchor.getElementsByTagNameNS(WP, 'wrapTopAndBottom').length ||
        anchor.getElementsByTagNameNS(W, 't').length || p?.namespaceURI !== W || p.localName !== 'p' ||
        anchor.getElementsByTagNameNS(A, 'xfrm')[0]?.hasAttribute('rot') ||
        [...p.children].some(c => c !== run && c.localName !== 'pPr') ||
        [...run!.children].some(c => c !== alternate && c.localName !== 'rPr') ||
        points.length !== 5 || new Set(points.slice(0,4).map(p=>p.join())).size !== 4 ||
        new Set(points.map(p=>p[0])).size !== 2 || new Set(points.map(p=>p[1])).size !== 2 ||
        points[0].join() !== points[4].join() || points.slice(1).some((p,i)=>p[0] !== points[i][0] && p[1] !== points[i][1]) ||
        [...path.children].some(c => !['moveTo','lnTo','close'].includes(c.localName))) continue;
    let props = [...p.children].find(c => c.localName === 'pPr');
    if (!props) { props = doc.createElementNS(W,'w:pPr'); p.prepend(props); }
    const borders = doc.createElementNS(W,'w:pBdr'), bottom = doc.createElementNS(W,'w:bottom');
    for (const [key,value] of Object.entries({val:'single',sz:String(Math.round(height*8)),color:fill,space:'0'})) bottom.setAttributeNS(W,'w:'+key,value);
    borders.append(bottom); props.append(borders); run!.remove(); count++;
  }
  return count;
}
/** Translate only known legacy list glyphs, never ordinary document text. */
export function normalizeListSymbols(doc: Document): number {
  const map: Record<string, string> = { '\uf0fc': '✓', '\uf076': '❖', '\uf0b7': '•' };
  let count = 0;
  for (const level of [...doc.getElementsByTagNameNS(W, 'lvl')]) {
    const font = level.getElementsByTagNameNS(W, 'rFonts')[0];
    const text = level.getElementsByTagNameNS(W, 'lvlText')[0];
    const face = font?.getAttributeNS(W, 'ascii');
    const char = text?.getAttributeNS(W, 'val') || '';
    if (!font || !text || !map[char] || !['Wingdings', 'Symbol'].includes(face || '')) continue;
    if (face === 'Symbol' && char !== '\uf0b7') continue;
    text.setAttributeNS(W, 'w:val', map[char]);
    for (const attr of [...font.attributes]) font.removeAttributeNode(attr);
    font.setAttributeNS(W, 'w:ascii', 'SafePDFSymbols'); font.setAttributeNS(W, 'w:hAnsi', 'SafePDFSymbols'); count++;
  }
  return count;
}

interface LayoutNode {
  styleName?: string;
  tabs?: { position: string; style: string; leader?: string }[];
  cssStyle?: Record<string, string>;
  children?: LayoutNode[];
}
/** Carry explicit Word tab stops through the pinned renderer as an inert data attribute. */
interface TabStyle { id: string; basedOn?: string; paragraphProps?: { tabs?: NonNullable<LayoutNode['tabs']> }; }
export function tagTabStops(node: LayoutNode, styles: TabStyle[] = []): void {
  let id = node.styleName;
  const seen = new Set<string>();
  while (!node.tabs && id && !seen.has(id)) {
    seen.add(id);
    const style = styles.find(s => s.id === id);
    node.tabs = style?.paragraphProps?.tabs;
    id = style?.basedOn;
  }
  if (node.tabs?.length) {
    const stops = node.tabs.filter(t => Number.isFinite(parseFloat(t.position)));
    node.cssStyle = { ...node.cssStyle, '$data-safepdf-tab-stops': stops.map(t =>
      `${parseFloat(t.position)} ${['left','right','center','decimal','clear'].includes(t.style) ? t.style : 'left'} ${['dot','middleDot','hyphen','heavy','underscore'].includes(t.leader || '') ? t.leader : 'none'}`).join(', ') };
  }
  for (const child of node.children || []) tagTabStops(child, styles);
}
/** Measure against loaded fonts and decoded images, before applying preview zoom. */
export function layoutTabStops(doc: Document, defaultSize = 36): void {
  const view = doc.defaultView;
  if (!view) return;
  if (!(defaultSize > 0)) defaultSize = 36;
  for (const p of doc.querySelectorAll<HTMLElement>('p')) {
    const tabs = [...p.querySelectorAll<HTMLElement>('.docx-tab-stop')];
    if (!tabs.length) continue;
    const css = view.getComputedStyle(p);
    const stops = (p.getAttribute('data-safepdf-tab-stops') || '').split(',').map(s => {
      const [pos, style, leader] = s.trim().split(/\s+/);
      return { pos: Number(pos), style: style || 'left', leader: leader || 'none' };
    }).filter(s => Number.isFinite(s.pos) && s.pos > 0).sort((a,b) => a.pos-b.pos);
    for (const tab of tabs) {
      tab.style.wordSpacing = '0'; tab.style.display = 'inline-block';
      tab.style.whiteSpace = 'pre'; tab.style.width = '0'; tab.textContent = '\u00a0';
      tab.style.textDecoration = 'none';
    }
    for (const [index,tab] of tabs.entries()) {
      const bounds = p.getBoundingClientRect();
      const origin = bounds.left - (parseFloat(css.marginLeft) || 0);
      const left = tab.getBoundingClientRect().left;
      const at = (left-origin)*72/96;
      const explicit = stops.find(s => s.style !== 'clear' && s.pos > at + 0.1);
      const last = stops.length ? stops[stops.length-1].pos : 0;
      const stop = explicit || { pos: last + Math.max(1, Math.floor((at-last)/defaultSize)+1)*defaultSize, style:'left', leader:'none' };
      let following = 0;
      if (['right','center','decimal'].includes(stop.style)) {
        const range = doc.createRange(); range.setStartAfter(tab);
        if (tabs[index+1]) range.setEndBefore(tabs[index+1]); else range.setEnd(p,p.childNodes.length);
        if (stop.style === 'decimal') {
          const walker = doc.createTreeWalker(p, 4);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (!range.intersectsNode(node)) continue;
            const decimal = (node.textContent || '').search(/[.,]/);
            if (decimal >= 0) { range.setEnd(node, decimal); break; }
          }
        }
        following = range.getBoundingClientRect().width * (stop.style === 'center' ? .5 : 1);
      }
      tab.style.width = `${Math.max(0, Math.min(bounds.right-left-1, (stop.pos-at)*96/72-following))}px`;
      if (stop.leader !== 'none') {
        tab.style.textDecoration = 'underline';
        tab.style.textDecorationStyle = ['dot','middleDot'].includes(stop.leader) ? 'dotted' : 'solid';
      }
    }
  }
}
