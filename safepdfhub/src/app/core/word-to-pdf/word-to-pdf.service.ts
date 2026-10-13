import { Injectable } from '@angular/core';
import { normalizeHeadingBoxes, normalizeListSymbols, tagTabStops, layoutTabStops } from './word-layout';
export { WORD_INPUT_BYTES } from './docx-preflight';
import { WORD_INPUT_BYTES } from './docx-preflight';
export function validateWordSelection(file: File): string | null {
  if (!/\.docx$/i.test(file.name))
    return 'Choose a .docx file. For older .doc files, use Save As in Word to create a DOCX first.';
  if (!file.size || file.size > WORD_INPUT_BYTES) return 'Choose a non-empty DOCX up to 200 MB.';
  return null;
}
export function wordPdfName(name: string) {
  return (
    (name
      .replace(/\.docx$/i, '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .trim()
      .slice(0, 150) || 'document') + '.pdf'
  );
}
export interface WordPreview {
  paperSizes: string[];
  pageDimensions: { width: number; height: number }[];
  hasText: boolean;
  warnings: string[];
  fonts: string[];
  sections: number;
  durationMs: number;
  dispose: () => void;
}
interface CheckedDocument {
  buffer: ArrayBuffer;
  fonts: string[];
  warnings: string[];
  error?: string;
}
@Injectable({ providedIn: 'root' })
export class WordToPdfService {
  async preview(
    file: File,
    frame: HTMLIFrameElement,
    signal: AbortSignal,
    progress: (message: string) => void,
  ): Promise<WordPreview> {
    const invalid = validateWordSelection(file);
    if (invalid) throw Error(invalid);
    const started = performance.now();
    const urls: string[] = [];
    let disposed = false;
    let resize: ResizeObserver | undefined;
    const dispose = () => {
      disposed = true;
      resize?.disconnect();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.length = 0;
      frame.remove();
    };
    signal.addEventListener('abort', dispose, { once: true });
    try {
      progress('Checking document structure and memory requirements…');
      const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      const checked = await this.check(
        file,
        signal,
        !memory || memory <= 4 || navigator.maxTouchPoints > 1 ? 128_000_000 : 256_000_000,
      );
      signal.throwIfAborted();
      progress('Preparing the local document preview…');
      const { parseAsync, renderDocument } = await import('docx-preview');
      signal.throwIfAborted();
      const doc = frame.contentDocument;
      if (!doc) throw Error('The preview could not be opened. Please try again.');
      doc.open();
      doc.write(
        `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Word document preview</title></head><body><main id="document"></main></body></html>`,
      );
      doc.close();
      doc.title = wordPdfName(file.name).replace(/\.pdf$/, '');
      doc.addEventListener('click', (e) => {
        if ((e.target as Element)?.closest?.('a')) e.preventDefault();
      });
      const options = {
        inWrapper: true,
        hideWrapperOnPrint: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderAltChunks: false,
        renderChanges: false,
        useBase64URL: false,
        experimental: true,
        keepOrigin: true,
      };
      const model = await parseAsync(checked.buffer, options);
      const source = model.documentPart._xmlDocument as Document;
      if (source && normalizeHeadingBoxes(source)) model.documentPart.parseXml(source.documentElement);
      const numbering = model.numberingPart?._xmlDocument as Document | undefined;
      if (numbering && normalizeListSymbols(numbering)) model.numberingPart.parseXml(numbering.documentElement);
      signal.throwIfAborted();
      // Pinned renderer adapter: own resource URLs so replacement/cancellation releases images and fonts.
      if (typeof model.blobToURL !== 'function')
        throw Error('The document renderer is incompatible. Please reload the website.');
      model.blobToURL = (blob: Blob | null) => {
        if (!blob || disposed) return null;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return url;
      };
      // Word sections inherit header/footer references unless explicitly replaced.
      const properties = [];
      for (const child of model.documentPart.body.children)
        if (child.sectionProps) {
          properties.push(child.sectionProps);
          // An empty section delimiter is structural; a browser's default empty
          // paragraph line box can otherwise spill onto an extra blank page.
          if (!child.children?.length) child.cssStyle = { ...child.cssStyle, 'min-height': '0', height: '0', 'font-size': '0', margin: '0' };
        }
      properties.push(model.documentPart.body.props);
      type Reference = { type: string; id: string };
      let headers: Reference[] = [],
        footers: Reference[] = [];
      for (const props of properties) {
        if (!props) continue;
        const ownHeaders: Reference[] = props.headerRefs || [],
          ownFooters: Reference[] = props.footerRefs || [];
        headers = [
          ...headers.filter((h) => !ownHeaders.some((r) => r.type === h.type)),
          ...ownHeaders,
        ];
        footers = [
          ...footers.filter((h) => !ownFooters.some((r) => r.type === h.type)),
          ...ownFooters,
        ];
        props.headerRefs = headers;
        props.footerRefs = footers;
      }
      tagTabStops(model.documentPart.body, model.stylesPart?.styles || []);
      for (const part of model.parts || [])
        if (part.rootElement) tagTabStops(part.rootElement, model.stylesPart?.styles || []);
      const rendererStyles = doc.createElement('div');
      rendererStyles.style.display = 'none';
      doc.body.prepend(rendererStyles);
      await renderDocument(model, doc.getElementById('document')!, rendererStyles, options);
      signal.throwIfAborted();
      progress('Loading document fonts and images…');
      const fontResponse = await fetch(
        new URL('assets/fonts/NotoSansDevanagari.ttf', document.baseURI),
        { signal },
      );
      if (!fontResponse.ok)
        throw Error('The bundled script font could not be loaded. Reload the website and retry.');
      const fontUrl = URL.createObjectURL(await fontResponse.blob());
      urls.push(fontUrl);
      const fallback = doc.createElement('style');
      fallback.textContent = `@font-face{font-family:SafePDFScript;src:url('${fontUrl}')} section.docx{font-family:var(--docx-minorHAnsi-font, Arial),SafePDFScript,sans-serif}`;
      doc.head.append(fallback);
      for (const el of doc.querySelectorAll<HTMLElement>('[style]'))
        if (el.style.fontFamily) el.style.fontFamily += ', SafePDFScript';
      for (const sheet of [...doc.styleSheets])
        for (const rule of [...sheet.cssRules]) {
          const css = rule as CSSStyleRule;
          if (
            rule.type === CSSRule.STYLE_RULE &&
            css.style?.fontFamily &&
            !css.style.fontFamily.includes('SafePDFScript')
          )
            css.style.fontFamily += ', SafePDFScript';
        }
      // Prefer installed Calibri; Carlito supplies compatible metrics when unavailable.
      for (const [suffix, weight, fontStyle] of [['Regular','400','normal'], ['Bold','700','normal'], ['Italic','400','italic'], ['BoldItalic','700','italic']]) {
        const response = await fetch(new URL(`assets/fonts/Carlito-${suffix}.ttf`, document.baseURI), { signal });
        if (!response.ok) throw Error('A document font could not be loaded. Please retry.');
        const url = URL.createObjectURL(await response.blob()); urls.push(url);
        fallback.textContent += `@font-face{font-family:Calibri;src:local('${suffix === 'Regular' ? 'Calibri' : 'Calibri ' + suffix.replace('BoldItalic', 'Bold Italic')}'),url('${url}');font-weight:${weight};font-style:${fontStyle}}`;
      }
      const symbols = await fetch(new URL('assets/fonts/DejaVuSans.ttf', document.baseURI), { signal });
      if (!symbols.ok) throw Error('The list symbol font could not be loaded. Please retry.');
      const symbolsUrl = URL.createObjectURL(await symbols.blob()); urls.push(symbolsUrl);
      fallback.textContent += `@font-face{font-family:SafePDFSymbols;src:url('${symbolsUrl}')}`;
      await Promise.all([doc.fonts.load('12px SafePDFSymbols'), doc.fonts.load('12px SafePDFScript'), doc.fonts.load('11px Calibri'), doc.fonts.load('bold 11px Calibri')]);
      // The pinned renderer defers tab measurement for 500 ms.
      await this.bounded(new Promise(resolve => setTimeout(resolve, 550)), signal);
      await this.bounded(
        Promise.all(
          [...doc.images].map(async (img) => {
            try {
              await img.decode();
            } catch {
              throw Error(
                'An image could not be rendered. Save a DOCX with PNG or JPEG images and retry.',
              );
            }
          }),
        ),
        signal,
      );
      await this.bounded(doc.fonts.ready, signal);
      layoutTabStops(doc, parseFloat(model.settingsPart?.settings?.defaultTabStop) || 36);
      signal.throwIfAborted();
      const sections = [...doc.querySelectorAll<HTMLElement>('section.docx')];
      if (!sections.length) throw Error('No document content could be rendered.');
      const style = doc.createElement('style');
      style.textContent = `.docx-wrapper{-webkit-print-color-adjust:exact;print-color-adjust:exact} html,body{margin:0;background:#e6eaf0} .docx-wrapper{padding:20px!important} section.docx{max-width:none!important} @media print{html,body{background:white} .docx-wrapper{padding:0!important;background:white!important} .docx-wrapper{zoom:1!important;width:auto!important} section.docx{box-shadow:none!important;margin:0!important;break-after:page} section.docx:last-child{break-after:auto} }`;
      sections.forEach((section, i) => {
        const width = section.style.width,
          height = section.style.minHeight || section.style.height;
        if (/^\d+(\.\d+)?pt$/.test(width) && /^\d+(\.\d+)?pt$/.test(height)) {
          section.style.page = `word${i}`;
          // Keep source margins inside the page. Driver-controlled outer margins
          // otherwise replace Word margins and make room for browser headers.
          const margins = [section.style.paddingTop, section.style.paddingRight, section.style.paddingBottom, section.style.paddingLeft].map(v => /^\d+(\.\d+)?pt$/.test(v) ? v : '0pt');
          section.dataset['wordPage'] = String(i);
          style.textContent += `@page word${i}{size:${width} ${height};margin:0}`;
          if (i === 0) style.textContent += `@page{size:${width} ${height};margin:0}`;
          style.textContent += `@media print{section[data-word-page="${i}"]{display:block;width:auto!important;min-height:0!important;padding:${margins.join(' ')}!important;box-decoration-break:clone;-webkit-box-decoration-break:clone;overflow:visible}}`;
        }
      });
      doc.head.append(style);
      const wrapper = doc.querySelector<HTMLElement>('.docx-wrapper');
      if (wrapper) {
        const fit = () => {
          const widest = Math.max(...sections.map((s) => s.offsetWidth)) + 40;
          wrapper.style.width = `${widest}px`;
          wrapper.style.zoom = String(Math.min(1, frame.clientWidth / widest));
        };
        resize = new ResizeObserver(fit);
        resize.observe(frame);
        fit();
      }
      const warnings = [
        ...checked.warnings,
        'Review the print preview before saving. Fonts, automatic page breaks and repeated headers can differ from Microsoft Word.',
      ];
      if (sections.some((s) => s.scrollWidth > s.clientWidth + 2))
        warnings.push(
          'Some content is wider than its page. Check wide tables and images in the print preview.',
        );
      return {
        warnings,
        fonts: checked.fonts,
        paperSizes: [...new Set(sections.map(s => paperSizeLabel(parseFloat(s.style.width), parseFloat(s.style.minHeight || s.style.height))))],
        pageDimensions: sections.map(s => ({ width: parseFloat(s.style.width), height: parseFloat(s.style.minHeight || s.style.height) })).filter(s => Number.isFinite(s.width) && Number.isFinite(s.height)),
        hasText: sections.some(s => /[\p{L}\p{N}]/u.test(s.querySelector('article')?.textContent || '')),
        sections: sections.length,
        durationMs: performance.now() - started,
        dispose,
      };
    } catch (e) {
      dispose();
      throw e;
    } finally {
      signal.removeEventListener('abort', dispose);
    }
  }
  private check(file: File, signal: AbortSignal, expandedLimit: number): Promise<CheckedDocument> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./docx-preflight.worker', import.meta.url), {
        type: 'module',
      });
      const finish = (error?: Error, result?: CheckedDocument) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        worker.terminate();
        error ? reject(error) : resolve(result!);
      };
      const cancel = () => finish(new DOMException('Preview cancelled.', 'AbortError'));
      const timer = setTimeout(
        () => finish(Error('Document checks took too long. Try a smaller document.')),
        60000,
      );
      worker.onmessage = ({ data }: { data: CheckedDocument }) =>
        data.error ? finish(Error(data.error)) : finish(undefined, data);
      worker.onerror = () => finish(Error('Unable to inspect the document. Try a smaller DOCX.'));
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      worker.postMessage({ file, expandedLimit });
    });
  }
  private bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancel = () => end(new DOMException('Preview cancelled.', 'AbortError'));
      const timer = setTimeout(
        () => end(Error('Images or fonts took too long to load. Try a smaller document.')),
        30000,
      );
      const end = (error?: Error, value?: T) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        error ? reject(error) : resolve(value!);
      };
      signal.addEventListener('abort', cancel, { once: true });
      promise.then(
        (v) => end(undefined, v),
        (e) => end(e),
      );
      if (signal.aborted) cancel();
    });
  }
}

export function paperSizeLabel(width: number, height: number): string {
  const landscape = width > height;
  const [w,h] = landscape ? [height,width] : [width,height];
  const name = Math.abs(w - 595.3) < 1.5 && Math.abs(h - 841.9) < 1.5 ? 'A4'
    : Math.abs(w - 612) < 1.5 && Math.abs(h - 792) < 1.5 ? 'Letter'
    : `${Math.round(width * 25.4 / 72)} × ${Math.round(height * 25.4 / 72)} mm`;
  return name + (landscape ? ' landscape' : '');
}
