import { StudioObjectService } from './studio-object.service';
describe('Shape fill color', () => {
  it('retains the exact chosen color through fill off/on, snapshots and undo restoration', () => {
    const service = new StudioObjectService();
    const shape = service.createShapeObject(1, 0.1, 0.1, 0.3, 0.3, 'rectangle', {
      strokeColor: '#00d4b3',
      fillColor: '#ffdd00',
      strokeWidth: 0.003,
      opacity: 1,
    });
    service.updateShapeStyle(shape.id, { fillColor: null });
    const snapshot = service.snapshot();
    expect(snapshot[0].shape!.style.fillColor).toBeNull();
    expect(snapshot[0].shape!.style.rememberedFillColor).toBe('#ffdd00');
    service.restore(snapshot);
    service.updateShapeStyle(shape.id, {
      fillColor: service.get(shape.id)!.shape!.style.rememberedFillColor,
    });
    expect(service.get(shape.id)!.shape!.style.fillColor).toBe('#ffdd00');
    expect(service.get(shape.id)!.shape!.style.opacity).toBe(1);
  });
});
