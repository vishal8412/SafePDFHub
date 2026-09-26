import { StudioHistoryService, type StudioHistorySnapshot } from './studio-history.service';
import type { PdfWatermarkRequest } from '../../../core/watermark/pdf-watermark.types';

describe('StudioHistoryService — watermark history', () => {
  const makeSnapshot = (watermark: PdfWatermarkRequest | null): StudioHistorySnapshot => ({
    pages: [],
    objects: [],
    currentPage: 1,
    watermark,
  });

  const makeTextWatermark = (): PdfWatermarkRequest => ({
    kind: 'text',
    text: 'CONFIDENTIAL',
    opacity: 0.28,
    rotation: -35,
    position: 'top-right',
    pageSelection: { mode: 'all' },
    tiled: false,
    fontSize: 42,
    font: 'Helvetica',
    color: '#17324d',
    imageScalePercent: 28,
  });

  it('undoes and redoes Add Watermark as part of the shared history snapshot', () => {
    const service = new StudioHistoryService();
    const watermark = makeTextWatermark();

    service.record(
      'Add Watermark',
      makeSnapshot(null),
      makeSnapshot(watermark),
    );

    expect(service.undo()?.watermark).toBeNull();
    expect(service.canRedo()).toBe(true);
    expect(service.redo()?.watermark).toEqual(watermark);
  });

  it('restores the exact image File reference without serializing image bytes into history', () => {
    const service = new StudioHistoryService();
    const imageFile = new File(['watermark-image'], 'logo.png', { type: 'image/png' });
    const watermark: PdfWatermarkRequest = {
      ...makeTextWatermark(),
      kind: 'image',
      text: undefined,
      imageFile,
    };

    service.record(
      'Add Watermark',
      makeSnapshot(null),
      makeSnapshot(watermark),
    );

    const restored = service.undo();
    expect(restored?.watermark).toBeNull();

    const redone = service.redo();
    expect(redone?.watermark?.imageFile).toBe(imageFile);
  });


  it('records two different image files even when their metadata matches', () => {
    const service = new StudioHistoryService();
    const firstFile = new File(['first'], 'logo.png', { type: 'image/png', lastModified: 1 });
    const secondFile = new File(['second'], 'logo.png', { type: 'image/png', lastModified: 1 });
    const first = { ...makeTextWatermark(), kind: 'image' as const, text: undefined, imageFile: firstFile };
    const second = { ...makeTextWatermark(), kind: 'image' as const, text: undefined, imageFile: secondFile };

    service.record('Add Watermark', makeSnapshot(null), makeSnapshot(first));
    service.record('Update Watermark', makeSnapshot(first), makeSnapshot(second));

    expect(service.undo()?.watermark?.imageFile).toBe(firstFile);
    expect(service.undo()?.watermark).toBeNull();
    expect(service.redo()?.watermark?.imageFile).toBe(firstFile);
    expect(service.redo()?.watermark?.imageFile).toBe(secondFile);
  });

  it('keeps watermark and ordinary Studio mutations on one ordered timeline', () => {
    const service = new StudioHistoryService();
    const watermark = makeTextWatermark();
    const changedWatermark = { ...watermark, rotation: 45 } satisfies PdfWatermarkRequest;

    service.record('Add Watermark', makeSnapshot(null), makeSnapshot(watermark));
    service.record('Update Watermark', makeSnapshot(watermark), makeSnapshot(changedWatermark));
    service.record('Remove Watermark', makeSnapshot(changedWatermark), makeSnapshot(null));

    expect(service.undo()?.watermark).toEqual(changedWatermark);
    expect(service.undo()?.watermark).toEqual(watermark);
    expect(service.undo()?.watermark).toBeNull();

    expect(service.redo()?.watermark).toEqual(watermark);
    expect(service.redo()?.watermark).toEqual(changedWatermark);
    expect(service.redo()?.watermark).toBeNull();
  });
});
