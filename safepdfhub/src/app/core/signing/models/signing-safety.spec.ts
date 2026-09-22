import {
  MAX_SIGNATURE_IMAGE_DIMENSION,
  MAX_SIGNATURE_IMAGE_PIXELS,
  MAX_SIGNATURE_UPLOAD_BYTES,
  MAX_SIGNING_PDF_BYTES,
  MAX_SIGNING_PDF_PAGES,
  MAX_SIGNING_PREVIEW_PIXELS,
} from './signing.models';

describe('Signing safety budgets', () => {
  it('keeps browser-side document and image budgets finite and positive', () => {
    expect(MAX_SIGNING_PDF_BYTES).toBe(100 * 1024 * 1024);
    expect(MAX_SIGNING_PDF_PAGES).toBe(500);
    expect(MAX_SIGNING_PREVIEW_PIXELS).toBe(16_000_000);
    expect(MAX_SIGNATURE_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_SIGNATURE_IMAGE_DIMENSION).toBe(8_000);
    expect(MAX_SIGNATURE_IMAGE_PIXELS).toBe(12_000_000);
  });
});
