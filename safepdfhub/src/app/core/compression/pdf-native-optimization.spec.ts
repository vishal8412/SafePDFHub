import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { optimizeNativePdf, targetQualityLadder } from './pdf-native-optimization';

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

describe('Target byte-budget search', () => {
  it('avoids redundant whole-document writes when the requested image saving is large', () => {
    expect(targetQualityLadder(5_558_121, 1_098_792, 5_000_000)).toEqual([0.45]);
    expect(targetQualityLadder(1_200_000, 1_100_000, 1_000_000)).toEqual([0.82, 0.65, 0.45]);
    expect(targetQualityLadder(1_200_000, 1_000_000, 950_000)).toEqual([0.65, 0.45]);
    expect(targetQualityLadder(1_200_000, 0, 1_000_000)).toEqual([]);
    expect(targetQualityLadder(1_200_000, 1_000_000, 2_000_000)).toEqual([]);
  });
});
