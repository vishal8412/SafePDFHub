import { StudioStateService } from './studio-state.service';
import type { StudioPdfDocument } from '../models/pdf-document.model';

describe('StudioStateService — responsive view defaults', () => {
  it('opens a document in Fit Page mode with a remembered 100% numeric zoom', () => {
    const service = new StudioStateService();

    const document = {
      name: 'sample.pdf',
      file: {} as File,
      pdf: {} as StudioPdfDocument['pdf'],
      pageCount: 1
    } as StudioPdfDocument;

    service.setDocument(document);

    expect(service.viewMode()).toBe('fit-page');
    expect(service.zoom()).toBe(100);
  });

  it('switches from Fit Page to true numeric zoom without changing the stored view contract', () => {
    const service = new StudioStateService();

    service.setZoom(100);

    expect(service.viewMode()).toBe('zoom');
    expect(service.zoom()).toBe(100);
  });
});
