import { PdfValidationService } from './pdf-validation.service';

function makePdf(
  name = 'document.pdf',
  size = 32,
  type = 'application/pdf'
): File {
  return new File(
    [new Uint8Array(size)],
    name,
    { type }
  );
}

function makeService(options?: {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxFiles?: number;
  securitySupported?: boolean;
  securityMaxFileBytes?: number;
}): PdfValidationService {
  const capability = {
    budget: {
      maxFileBytes: options?.maxFileBytes ?? 100 * 1024 * 1024,
      maxTotalBytes: options?.maxTotalBytes ?? 400 * 1024 * 1024,
      maxFiles: options?.maxFiles ?? 40,
      maxPages: 40_000,
      largeWorkloadBytes: 300 * 1024 * 1024,
      largeWorkloadPages: 10_000
    }
  };

  const securityCapability = {
    supported: options?.securitySupported ?? true,
    current: {
      maxFileBytes: options?.securityMaxFileBytes ?? 1024 * 1024 * 1024
    }
  };

  return new PdfValidationService(
    capability as never,
    securityCapability as never
  );
}

describe('PdfValidationService', () => {
  it('accepts a valid PDF selection', () => {
    const service = makeService();

    expect(
      service.validateSelection(makePdf(), [], false)
    ).toEqual({
      valid: true,
      code: 'ok'
    });
  });

  it('accepts a PDF file when the MIME type is missing but the filename is valid', () => {
    const service = makeService();
    const file = makePdf('document.pdf', 32, '');

    expect(
      service.validateSelection(file, [], false)
    ).toEqual({
      valid: true,
      code: 'ok'
    });
  });

  it('rejects non-PDF files before capacity checks', () => {
    const service = makeService();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    expect(
      service.validateSelection(file, [], false)
    ).toEqual({
      valid: false,
      code: 'invalid-type',
      message: 'Only PDF files are allowed.'
    });
  });

  it('rejects duplicate files by name and size', () => {
    const service = makeService();
    const existing = makePdf('document.pdf', 32);
    const duplicate = makePdf('document.pdf', 32);

    expect(
      service.validateSelection(duplicate, [existing], false)
    ).toEqual({
      valid: false,
      code: 'duplicate',
      message: 'document.pdf is already added.'
    });
  });

  it('rejects a file above the device file-size budget', () => {
    const service = makeService({ maxFileBytes: 100 });
    const file = makePdf('large.pdf', 101);

    const result = service.validateSelection(file, [], false);

    expect(result.valid).toBe(false);
    expect(result.code).toBe('file-too-large');
    expect(result.message).toContain('large.pdf');
  });

  it('rejects an additional file when the multi-file count budget is exceeded', () => {
    const service = makeService({ maxFiles: 2 });
    const existingFiles = [
      makePdf('one.pdf'),
      makePdf('two.pdf')
    ];

    const result = service.validateSelection(
      makePdf('three.pdf'),
      existingFiles,
      true
    );

    expect(result).toEqual({
      valid: false,
      code: 'too-many-files',
      message: 'You can process up to 2 PDFs at a time on this device.'
    });
  });

  it('does not apply the multi-file count limit to single-file workflows', () => {
    const service = makeService({ maxFiles: 1 });
    const existingFiles = [makePdf('one.pdf')];

    expect(
      service.validateSelection(
        makePdf('second.pdf'),
        existingFiles,
        false
      )
    ).toEqual({
      valid: true,
      code: 'ok'
    });
  });

  it('rejects a selection when the combined file size exceeds the device budget', () => {
    const service = makeService({
      maxTotalBytes: 100
    });

    const existingFiles = [makePdf('one.pdf', 60)];
    const result = service.validateSelection(
      makePdf('two.pdf', 41),
      existingFiles,
      true
    );

    expect(result.valid).toBe(false);
    expect(result.code).toBe('total-too-large');
    expect(result.message).toContain('combined files');
  });

  it('validates security selections against the dedicated security input target', () => {
    const service = makeService({
      maxFileBytes: 100,
      securityMaxFileBytes: 200
    });

    expect(
      service.validateSecuritySelection(makePdf('security.pdf', 150))
    ).toEqual({
      valid: true,
      code: 'ok'
    });

    const result = service.validateSecuritySelection(
      makePdf('security-large.pdf', 201)
    );

    expect(result.valid).toBe(false);
    expect(result.code).toBe('file-too-large');
    expect(result.message).toContain('1 GB');
  });

  it('falls back to the normal device selection budget when the security capability is unavailable', () => {
    const service = makeService({
      securitySupported: false,
      maxFileBytes: 100
    });

    const result = service.validateSecuritySelection(
      makePdf('large.pdf', 101)
    );

    expect(result.valid).toBe(false);
    expect(result.code).toBe('file-too-large');
  });

  it('rejects a non-PDF security selection', () => {
    const service = makeService();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    expect(
      service.validateSecuritySelection(file)
    ).toEqual({
      valid: false,
      code: 'invalid-type',
      message: 'Only PDF files are allowed.'
    });
  });

  it('formats byte values consistently for capacity messages', () => {
    const service = makeService();

    expect(service.formatBytes(0)).toBe('0 B');
    expect(service.formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(service.formatBytes(100 * 1024 * 1024)).toBe('100 MB');
    expect(service.formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(service.formatBytes(Number.NaN)).toBe('0 B');
  });
});
