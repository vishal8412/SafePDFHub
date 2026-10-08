import { StudioObjectService } from './studio-object.service';
import { studioPageWindow } from './studio-page-window';

describe('Inserted content rotation', () => {
  it('rotates text bounds and point size without drift across four turns', () => {
    const service = new StudioObjectService();
    const text = service.createTextObject(1,.2,.3);
    for (let turn=0;turn<4;turn++) service.rotateVectorObjects(1,90,turn%2 ? 600/800 : 800/600);
    const result = service.get(text.id)!;
    expect(result.contentRotation).toBe(0);
    for (const key of ['x','y','width','height'] as const) expect(result.bounds[key]).toBeCloseTo(text.bounds[key],10);
    expect(result.textStyle!.fontSize).toBeCloseTo(text.textStyle!.fontSize,10);
  });
  it('preserves the physical image aspect ratio on portrait and landscape pages', () => {
    const service = new StudioObjectService();
    for(const ratio of [800/600,600/800]) {
      const image = service.createImageObject(1,.5,.5,{dataUrl:'data:image/png;base64,AA==',mimeType:'image/png',naturalWidth:200,naturalHeight:100,aspectRatio:2},ratio);
      expect(image.bounds.width / image.bounds.height / ratio).toBeCloseTo(2,8);
    }
  });
  it('keeps the final sidebar row in the virtual window',()=>{
    const result=studioPageWindow(4149,4149*176-600,600,1,176);
    expect(result.end).toBe(4149);
    expect(result.bottom).toBe(0);
    expect(result.end-result.start).toBeLessThanOrEqual(8);
  });
});
