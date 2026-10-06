import { pdfTextDestination } from './studio-pdf-text-geometry';
import type { StudioObject } from '../models/studio-selection.model';
const object = () => ({ bounds: {x:.2,y:.3,width:.4,height:.1}, pdfText: {
  sourceBounds:{x:.1,y:.2,width:.2,height:.05}, pageWidthPdf:600,pageHeightPdf:800,
  transform:[12,0,0,12,60,640],textWidthPdf:120,textHeightPdf:40,
  sourceLines:[{transform:[12,0,0,12,60,640],width:120,height:12}]
}} as unknown as StudioObject);
describe('editable PDF text destinations',()=>{
  it('uses the resized area without changing the immutable source region',()=>{
    const original=object(),destination=pdfTextDestination(original)!;
    expect(destination.textWidthPdf).toBe(240);expect(destination.textHeightPdf).toBe(80);
    expect(destination.transform[4]).toBeCloseTo(120);expect(destination.transform[5]).toBeCloseTo(560);
    expect(original.pdfText!.transform).toEqual([12,0,0,12,60,640]);
    expect(destination.sourceLines).toEqual(original.pdfText!.sourceLines);
  });
  it('converts a displayed move correctly on a rotated page',()=>{
    const destination=pdfTextDestination(object(),90)!;
    expect(destination.transform[4]).toBeCloseTo(140);expect(destination.transform[5]).toBeCloseTo(700);
  });
  it('keeps untouched source geometry exact',()=>{
    const original=object();delete (original.pdfText as any).sourceBounds;
    expect(pdfTextDestination(original)).toBe(original.pdfText);
  });
});
