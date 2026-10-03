import { CompressionCancelledError } from './compression-cancellation';

describe('PdfCompressionWorkerService cancellation contract', () => {
  it('exposes a typed cancellation error', () => {
    const error = new CompressionCancelledError();
    expect(error.name).toBe('CompressionCancelledError');
    expect(error.message).toContain('cancelled');
  });
});
