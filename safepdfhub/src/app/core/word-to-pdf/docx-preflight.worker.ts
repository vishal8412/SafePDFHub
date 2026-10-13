/// <reference lib="webworker" />
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { inspectArchive } from './docx-preflight';
addEventListener('message', async ({ data }: { data: { file: File; expandedLimit: number } }) => {
  try {
    const entries = await inspectArchive(data.file, data.expandedLimit);
    const buffer = await data.file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    let elements = 0,
      xmlBytes = 0,
      pixels = 0;
    const fonts = new Set<string>();
    const warnings = new Set<string>();
    for (const entry of entries) {
      if (entry.name.endsWith('/')) continue;
      const content = await readBounded(zip.file(entry.name)!, entry.bytes);
      if (entry.name.startsWith('word/media/') && !entry.name.endsWith('/')) {
        if (entry.bytes > 40_000_000)
          throw Error('An image is too large for safe browser rendering. Resize it in Word first.');
        const image = content;
        const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
        let w = 0,
          h = 0;
        if (image.length >= 24 && view.getUint32(0) === 0x89504e47) {
          w = view.getUint32(16);
          h = view.getUint32(20);
        } else if (image.length >= 10 && new TextDecoder().decode(image.slice(0, 3)) === 'GIF') {
          w = view.getUint16(6, true);
          h = view.getUint16(8, true);
        } else if (image[0] === 255 && image[1] === 216) {
          let at = 2;
          while (at + 4 < image.length) {
            if (image[at++] !== 255) continue;
            const marker = image[at++];
            if (marker === 0xd9 || marker === 0xda) break;
            const length = view.getUint16(at);
            if (length < 2 || at + length > image.length) break;
            if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) {
              h = view.getUint16(at + 3);
              w = view.getUint16(at + 5);
              break;
            }
            at += length;
          }
        }
        if (!w || !h)
          throw Error(
            'An image format cannot be safely previewed. In Word, replace it with a PNG or JPEG image.',
          );
        pixels += w * h;
        if (
          w * h > 25_000_000 ||
          pixels > (data.expandedLimit <= 128_000_000 ? 40_000_000 : 80_000_000)
        )
          throw Error(
            'The decoded images exceed this device’s preview budget. Resize document images before converting.',
          );
      }
      if (!/\.(xml|rels)$/i.test(entry.name)) continue;
      xmlBytes += entry.bytes;
      if (xmlBytes > 24_000_000)
        throw Error(
          'This document contains too much layout data for safe browser rendering. Split it into smaller documents.',
        );
      const xml = new TextDecoder().decode(content);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml))
        throw Error('Document XML declarations are not supported.');
      const doc = new DOMParser({
        onError: () => {
          throw Error('The document contains damaged XML.');
        },
      }).parseFromString(xml, 'application/xml');
      const nodes = doc.getElementsByTagName('*');
      elements += nodes.length;
      if (elements > 80000)
        throw Error(
          'This document is too complex to preview safely. Split it into smaller documents.',
        );
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i],
          name = el.localName || '';
        if (['altChunk', 'object', 'OLEObject', 'control'].includes(name))
          throw Error(
            'Embedded objects or HTML content cannot be preserved. Save a standard DOCX copy first.',
          );
        if (
          name === 'Relationship' &&
          (el.getAttribute('TargetMode') === 'External' ||
            /^(?:[a-z]+:|\/\/)/i.test(el.getAttribute('Target') || '')) &&
          !el.getAttribute('Type')?.endsWith('/hyperlink')
        )
          throw Error('This document links to external content. Embed the images in Word first.');
        if (name === 'rFonts')
          for (const attr of ['ascii', 'hAnsi', 'eastAsia', 'cs']) {
            const font = el.getAttribute('w:' + attr);
            if (font) fonts.add(font);
          }
        if (['anchor', 'pict', 'oMath', 'oMathPara', 'cols', 'ins', 'del'].includes(name))
          warnings.add(
            'Floating objects, equations, columns or tracked changes may differ. Compare these areas with the original.',
          );
        if (name === 'instrText' || name === 'fldSimple')
          warnings.add(
            'Fields such as page numbers and tables of contents may use saved values. Check them before saving.',
          );
      }
    }
    postMessage({ buffer, fonts: [...fonts], warnings: [...warnings] }, [buffer]);
  } catch (e) {
    postMessage({ error: (e as Error).message || 'Unable to read this DOCX.' });
  }
});

function readBounded(entry: JSZip.JSZipObject, expected: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (!entry) {
      reject(Error('Missing archive entry.'));
      return;
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const stream = (
      entry as JSZip.JSZipObject & {
        internalStream(type: string): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream('uint8array');
    stream
      .on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > expected) {
          stream.pause();
          reject(Error('Archive size metadata does not match its contents.'));
          return;
        }
        chunks.push(chunk);
      })
      .on('error', reject)
      .on('end', () => {
        if (bytes !== expected) {
          reject(Error('Archive size metadata does not match its contents.'));
          return;
        }
        const result = new Uint8Array(bytes);
        let at = 0;
        for (const chunk of chunks) {
          result.set(chunk, at);
          at += chunk.length;
        }
        resolve(result);
      })
      .resume();
  });
}
