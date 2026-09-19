import { PdfValidationService } from './pdf-validation.service';

function makePdf(body = '1 0 obj\n<< /Type /Catalog >>\nendobj\n'): File {
  return new File(
    [new TextEncoder().encode(`%PDF-1.7\n${body}%%EOF\n`)],
    'document.pdf',
    { type: 'application/pdf' }
  );
}

function makeService(exitCode = 2, stderr: string[] = []): PdfValidationService {
  const capability = {
    budget: {
      maxFileBytes: 100 * 1024 * 1024,
      maxTotalBytes: 400 * 1024 * 1024,
      maxFiles: 40,
      maxPages: 40_000,
      largeWorkloadBytes: 300 * 1024 * 1024,
      largeWorkloadPages: 10_000
    }
  };
  const securityCapability = {
    supported: true,
    current: { maxFileBytes: 1024 * 1024 * 1024 }
  };
  const qpdf = {
    run: async ({ args }: { args: readonly string[] }) => ({
      ok: exitCode === 0,
      outputs: {},
      stdout: [],
      stderr,
      warnings: [],
      exitCode: args.includes('--is-encrypted') ? exitCode : exitCode,
      durationMs: 1
    })
  };

  return new PdfValidationService(
    capability as never,
    securityCapability as never,
    qpdf as never
  );
}

describe('PdfValidationService', () => {
  it('rejects non-PDF files before any engine work', () => {
    const service = makeService();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    expect(service.validateSelection(file, [], false).code).toBe('invalid-type');
  });

  it('rejects empty files', () => {
    const service = makeService();
    const file = new File([], 'empty.pdf', { type: 'application/pdf' });
    expect(service.validateSelection(file, [], false).code).toBe('empty-file');
  });

  it('rejects a missing PDF header', async () => {
    const service = makeService();
    const file = new File(['not-a-pdf\n%%EOF'], 'broken.pdf', { type: 'application/pdf' });
    const result = await service.validatePdfEnvelope(file);
    expect(result.code).toBe('invalid-header');
  });

  it('accepts a PDF upload after only checking the header', async () => {
    const service = makeService();
    const file = new File(['%PDF-1.7\n1 0 obj'], 'partial.pdf', { type: 'application/pdf' });
    const result = await service.validateUploadHeader(file);
    expect(result).toEqual({ valid: true, code: 'ok' });
  });

  it('keeps validatePdfEnvelope lightweight for upload admission', async () => {
    const service = makeService();
    const result = await service.validatePdfEnvelope(makePdf());
    expect(result).toEqual({ valid: true, code: 'ok' });
  });


  it('detects a protected PDF from the trailer tail without loading the whole file', async () => {
    const service = makeService();
    const protectedPdf = new File(
      [new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 7 0 R >>\nstartxref\n0\n%%EOF\n')],
      'protected.pdf',
      { type: 'application/pdf' }
    );
    await expect(service.inspectEncryptionHint(protectedPdf)).resolves.toBe('encrypted');
  });

  it('returns not-encrypted for a normal trailer without /Encrypt', async () => {
    const service = makeService();
    const result = await service.inspectEncryptionHint(makePdf());
    expect(result).toBe('not-encrypted');
  });
  it('detects encryption in a cross-reference stream located well before the final 256 KiB', async () => {
    const service = makeService();
    const prefix = new Uint8Array(300 * 1024);
    prefix.fill(32);
    const xrefOffset = prefix.length;
    const xref = new TextEncoder().encode(
      '76148 0 obj\n<< /Type /XRef /Length 10 /W [1 4 1] /Root 1 0 R /Encrypt 76147 0 R >>\nstream\n0123456789\nendstream\nendobj\n'
    );
    const suffix = new TextEncoder().encode(`startxref\n${xrefOffset}\n%%EOF\n`);
    const protectedPdf = new File([prefix, xref, new Uint8Array(300 * 1024), suffix], 'large-protected.pdf', { type: 'application/pdf' });

    await expect(service.inspectEncryptionHint(protectedPdf)).resolves.toBe('encrypted');
  });

  it('follows XRefStm from a traditional trailer', async () => {
    const service = makeService();
    const xrefStreamOffset = 1024;
    const xrefTableOffset = 4096;
    const prefix = new Uint8Array(xrefStreamOffset);
    prefix.fill(32);
    const xrefStream = new TextEncoder().encode(
      '7 0 obj\n<< /Type /XRef /Length 4 /W [1 1 1] /Encrypt 8 0 R >>\nstream\n1234\nendstream\nendobj\n'
    );
    const gap = new Uint8Array(xrefTableOffset - (xrefStreamOffset + xrefStream.length));
    gap.fill(32);
    const xrefTable = new TextEncoder().encode(
      `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 9 /Root 1 0 R /XRefStm ${xrefStreamOffset} >>\nstartxref\n${xrefTableOffset}\n%%EOF\n`
    );
    const protectedPdf = new File([prefix, xrefStream, gap, xrefTable], 'xref-stream-protected.pdf', { type: 'application/pdf' });

    await expect(service.inspectEncryptionHint(protectedPdf)).resolves.toBe('encrypted');
  });

  it('blocks Protect PDF when qpdf reports encryption', async () => {
    const service = makeService(0);
    const result = await service.validateSecurityContent(makePdf(), 'protect');
    expect(result.code).toBe('encrypted');
  });

  it('blocks Unlock PDF when qpdf reports a non-encrypted input', async () => {
    const service = makeService(2);
    const result = await service.validateSecurityContent(makePdf(), 'unlock');
    expect(result.code).toBe('not-encrypted');
  });

  it('classifies a qpdf structural failure as damaged', async () => {
    const service = makeService(2, ['xref table is damaged']);
    const result = await service.validatePdfStructure(makePdf());
    expect(result.code).toBe('damaged-pdf');
  });
});
