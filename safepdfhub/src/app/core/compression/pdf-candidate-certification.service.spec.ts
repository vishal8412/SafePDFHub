import { describe, expect, it, vi } from 'vitest';
import { PdfCandidateCertificationService } from './pdf-candidate-certification.service';
import { PdfFinalIntegrityResult } from './pdf-final-integrity.models';

function makeFile(bytes: number, name: string): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
}

function passedResult(): PdfFinalIntegrityResult {
  return {
    status: 'passed',
    pagesChecked: 1,
    totalPages: 1,
    metadataMatched: true,
    pageGeometryMatched: true,
    pageCountMatched: true,
    pages: [{
      pageNumber: 1,
      textMatched: true,
      annotationsMatched: true,
      sourceTextLength: 0,
      candidateTextLength: 0,
      sourceAnnotationCount: 0,
      candidateAnnotationCount: 0,
      passed: true,
    }],
    durationMs: 1,
    reason: null,
  };
}

describe('PdfCandidateCertificationService — V2.7', () => {
  it('certifies candidates from smallest to largest and returns the first passing candidate', async () => {
    const finalIntegrity = {
      certify: vi.fn(async (_source: File, candidate: File) =>
        candidate.name === 'small-rejected.pdf'
          ? { ...passedResult(), status: 'rejected' as const, reason: 'fixture rejection' }
          : passedResult(),
      ),
    };
    const service = new PdfCandidateCertificationService(finalIntegrity as never);
    const source = makeFile(100_000, 'source.pdf');
    const smallRejected = makeFile(50_000, 'small-rejected.pdf');
    const largerPassing = makeFile(60_000, 'larger-passing.pdf');

    const result = await service.certifySmallest(source, [largerPassing, smallRejected]);

    expect(result.selected?.name).toBe('larger-passing.pdf');
    expect(finalIntegrity.certify).toHaveBeenCalledTimes(2);
    expect(finalIntegrity.certify.mock.calls[0][1].name).toBe('small-rejected.pdf');
    expect(finalIntegrity.certify.mock.calls[1][1].name).toBe('larger-passing.pdf');
  });

  it('skips byte-identical duplicate candidates after the first certification', async () => {
    const finalIntegrity = {
      certify: vi.fn(async () => ({ ...passedResult(), status: 'rejected' as const, reason: 'fixture rejection' })),
    };
    const service = new PdfCandidateCertificationService(finalIntegrity as never);
    const source = makeFile(100_000, 'source.pdf');
    const first = makeFile(60_000, 'first.pdf');
    const duplicate = makeFile(60_000, 'duplicate.pdf');

    const result = await service.certifySmallest(source, [first, duplicate]);

    expect(result.selected).toBeNull();
    expect(finalIntegrity.certify).toHaveBeenCalledTimes(1);
    expect(result.duplicateCandidatesSkipped).toBe(1);
  });

  it('does not certify candidates that cannot beat the source size', async () => {
    const finalIntegrity = {
      certify: vi.fn(async () => passedResult()),
    };
    const service = new PdfCandidateCertificationService(finalIntegrity as never);
    const source = makeFile(50_000, 'source.pdf');

    const result = await service.certifySmallest(source, [
      makeFile(50_000, 'equal.pdf'),
      makeFile(60_000, 'larger.pdf'),
    ]);

    expect(result.selected).toBeNull();
    expect(result.candidatesConsidered).toBe(0);
    expect(finalIntegrity.certify).not.toHaveBeenCalled();
  });

  it('reuses final-integrity certification from the bounded cache', async () => {
    const finalIntegrity = {
      certify: vi.fn(async () => passedResult()),
    };
    const service = new PdfCandidateCertificationService(finalIntegrity as never);
    const source = makeFile(100_000, 'source.pdf');
    const candidate = makeFile(60_000, 'candidate.pdf');

    const first = await service.certifySmallest(source, [candidate]);
    const second = await service.certifySmallest(source, [candidate]);

    expect(first.selected?.name).toBe('candidate.pdf');
    expect(second.selected?.name).toBe('candidate.pdf');
    expect(finalIntegrity.certify).toHaveBeenCalledTimes(1);
    expect(second.cacheHits).toBe(1);
  });
});

describe('Quality-aware certification cache', () => {
  it('does not reuse Maximum Reduction approval under High Quality', async () => {
    const finalIntegrity = { certify: vi.fn(async (_a, _b, _c, _d, level) =>
      level === 'strong' ? passedResult() : { ...passedResult(), status: 'rejected' as const }) };
    const service = new PdfCandidateCertificationService(finalIntegrity as never);
    const source = makeFile(10000, 'source.pdf'), candidate = makeFile(5000, 'candidate.pdf');
    expect((await service.certifySmallest(source, [candidate], undefined, undefined, 'strong')).selected).toBe(candidate);
    expect((await service.certifySmallest(source, [candidate], undefined, undefined, 'light')).selected).toBeNull();
    expect(finalIntegrity.certify).toHaveBeenCalledTimes(2);
  });
});
