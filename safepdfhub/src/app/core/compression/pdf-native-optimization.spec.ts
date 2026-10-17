import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { capTargetEdge, automaticScanTarget, optimizeNativePdf, targetQualityLadder } from './pdf-native-optimization';

describe('Native lossless worker algorithm', () => {
  it('compresses unfiltered streams and preserves content, metadata and page boxes', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    const page = pdf.addPage([612, 792]);
    page.setCropBox(15, 20, 550, 700);
    pdf.setTitle('Exact metadata');
    const raw = new Uint8Array(new TextEncoder().encode('q 1 0 0 1 0 0 cm Q\n'.repeat(5000)));
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(raw)));
    const source = await pdf.save({ useObjectStreams: false });
    const output = await optimizeNativePdf(source);
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThan(source.length / 2);
    const result = await PDFDocument.load(output!, { updateMetadata: false });
    expect(result.getTitle()).toBe('Exact metadata');
    expect(result.getPage(0).getCropBox()).toEqual(page.getCropBox());
    const stream = result.context.lookup(result.getPage(0).node.get(PDFName.of('Contents'))) as PDFRawStream;
    expect(decodePDFRawStream(stream).decode()).toEqual(raw);
  });

  it('does not rewrite signature-bearing documents', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage();
    pdf.catalog.set(PDFName.of('TestSignature'), pdf.context.register(pdf.context.obj({
      Type: 'Sig', ByteRange: [0, 1, 2, 3],
    })));
    expect(await optimizeNativePdf(await pdf.save())).toBeNull();
  });
});

describe('Native document graph optimization', () => {
  it('removes unreachable objects, shares identical streams, and keeps attached data reachable', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    const raw = new Uint8Array(new TextEncoder().encode('q 0 0 1 rg 10 10 50 50 re f Q\n'.repeat(100)));
    for (let i = 0; i < 3; i++) {
      pdf.addPage().node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(raw)));
    }
    const unused = pdf.context.register(pdf.context.obj({ Marker: 'unreachable-fixture' }));
    await pdf.attach(new Uint8Array([1, 2, 3, 4]), 'keep.bin');
    const output = await optimizeNativePdf(await pdf.save({ useObjectStreams: false }));
    const result = await PDFDocument.load(output!, { updateMetadata: false });
    expect(result.getPageCount()).toBe(3);
    const contents = result.getPages().map(page => page.node.get(PDFName.of('Contents'))?.toString());
    expect(new Set(contents).size).toBe(1);
    expect(result.context.lookup(unused)).toBeUndefined();
    expect(result.catalog.get(PDFName.of('Names'))).toBeDefined();
  });
});

describe('Dependent stream consolidation', () => {
  async function parents(profiles: string[], nested = false) {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    for (const profile of profiles) {
      // Assign the profile last: its parent must be encountered first.
      const imageRef = pdf.context.nextRef();
      const childRef = pdf.context.nextRef();
      const profileRef = nested ? pdf.context.nextRef() : childRef;
      pdf.context.assign(imageRef, pdf.context.stream(new Uint8Array(300).fill(17), {
        Type: 'XObject', Subtype: 'Image', Width: 10, Height: 10,
        BitsPerComponent: 8, ColorSpace: ['ICCBased', childRef], Filter: 'DCTDecode',
      }));
      if (nested) pdf.context.assign(childRef, pdf.context.stream(new Uint8Array([4, 5]), { Child: profileRef }));
      pdf.context.assign(profileRef, pdf.context.stream(new Uint8Array(new TextEncoder().encode(profile)), { N: 3 }));
      pdf.addPage().node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { Im: imageRef } }));
    }
    const source = await pdf.save({ useObjectStreams: false });
    const output = await optimizeNativePdf(source);
    expect(output).not.toBeNull();
    const result = await PDFDocument.load(output!, { updateMetadata: false });
    const references = result.getPages().map(page =>
      (page.node.Resources()!.lookup(PDFName.of('XObject')) as any).get(PDFName.of('Im')).toString());
    return { result, references };
  }
  it('shares identical image streams after identical ICC profile references converge', async () => {
    const { result, references } = await parents(['same ICC bytes', 'same ICC bytes']);
    expect(result.getPageCount()).toBe(2);
    expect(new Set(references).size).toBe(1);
  });
  it('retains different colour profiles even when encoded image payloads match', async () => {
    const { references } = await parents(['colour profile A', 'colour profile B']);
    expect(new Set(references).size).toBe(2);
  });
  it('resolves more than one dependency level without merging pages', async () => {
    const { result, references } = await parents(['same deepest bytes', 'same deepest bytes'], true);
    expect(new Set(references).size).toBe(1);
    expect(result.getPage(0).ref).not.toEqual(result.getPage(1).ref);
  });
});

describe('Target byte-budget search', () => {
  it('avoids redundant whole-document writes when the requested image saving is large', () => {
    expect(targetQualityLadder(5_558_121, 1_098_792, 5_000_000)).toEqual([0.45]);
    expect(targetQualityLadder(1_200_000, 1_100_000, 1_000_000)).toEqual([0.82, 0.65, 0.45]);
    expect(targetQualityLadder(1_200_000, 1_000_000, 950_000)).toEqual([0.65, 0.45]);
    expect(targetQualityLadder(1_200_000, 0, 1_000_000)).toEqual([]);
    expect(targetQualityLadder(1_200_000, 1_000_000, 2_000_000)).toEqual([]);
  });
});

describe('Automatic large-scan budget', () => {
  it('gives Smart and Maximum Reduction different budgets for image-dominated documents', () => {
    expect(automaticScanTarget('recommended', 143_000_000, 142_000_000, 240, 240)).toBe(20_000_000);
    expect(automaticScanTarget('strong', 143_000_000, 142_000_000, 240, 240)).toBe(10_000_000);
  });
  it('keeps lossless, small and non-scan documents outside the automatic search', () => {
    expect(automaticScanTarget('light', 143_000_000, 142_000_000, 240, 240)).toBeUndefined();
    expect(automaticScanTarget('recommended', 19_000_000, 18_900_000, 240, 240)).toBeUndefined();
    expect(automaticScanTarget('recommended', 143_000_000, 50_000_000, 240, 240)).toBeUndefined();
    expect(automaticScanTarget('recommended', 143_000_000, 142_000_000, 10, 240)).toBeUndefined();
    expect(automaticScanTarget('recommended', 143_000_000, 142_000_000, 0, 0)).toBeUndefined();
  });
});

describe('Target search source-resolution cap', () => {
  it('reduces the search edge for scans already below the nominal canvas size', () => {
    expect(capTargetEdge(2400, [1470, 1500, 1618])).toBe(1500);
    expect(capTargetEdge(1660, [4000, 4500, 4800])).toBe(1660);
    expect(capTargetEdge(2400, [])).toBe(2400);
    expect(capTargetEdge(2400, [800])).toBe(1000);
  });
});

describe('Unresolved reference preservation', () => {
  it('does not reuse an unresolved reference number for a new object stream', async () => {
    const bodies = [
      '<< /Type /Catalog /Pages 2 0 R /Unresolved 5 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
      '<< /Length 3 >>\nstream\nq Q\nendstream',
    ];
    let source = '%PDF-1.7\n'; const offsets = [0];
    bodies.forEach((body, i) => { offsets.push(source.length); source += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = source.length;
    source += 'xref\n0 5\n0000000000 65535 f \n';
    for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, '0')} 00000 n \n`;
    source += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n%${'padding'.repeat(1000)}`;
    const output = await optimizeNativePdf(new Uint8Array(new TextEncoder().encode(source)));
    expect(output).not.toBeNull();
    const parsed = await PDFDocument.load(output!, { updateMetadata: false });
    const ref = parsed.catalog.get(PDFName.of('Unresolved'));
    expect(ref?.toString()).toBe('5 0 R');
    expect(parsed.context.lookup(ref)).toBeUndefined();
  });
});
