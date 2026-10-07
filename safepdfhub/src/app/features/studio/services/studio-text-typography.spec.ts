import { StudioObjectService } from './studio-object.service';
import { pdfFontSize, textFontWeight, textFontStyle, pdfFontFaceChanged } from './studio-text-typography';
import type { StudioObject } from '../models/studio-selection.model';
const source = (): StudioObject => ({ id:'source', type:'text', pageNumber:1,
  bounds:{x:.1,y:.1,width:.6,height:.15}, text:'Original paragraph',
  textStyle:{fontSize:.015,fontWeight:400,fontStyle:'normal',textAlign:'left',fontFamily:'Helvetica',lineHeight:1.2,letterSpacing:0,color:'#000000'},
  pdfText:{originalText:'Original paragraph',fontName:'Helvetica',transform:[12,0,0,12,60,720],edited:false,
    fontSizePdf:12,pageWidthPdf:600,pageHeightPdf:800,sourceFontWeight:400,sourceFontStyle:'normal',typographyLocked:true}
});
describe('replacement text typography',()=>{
  it('accepts explicit size, bold and italic without changing source erasure metrics',()=>{
    const service=new StudioObjectService(),original=source();service.add(original);
    const result=service.updateTextStyle(original.id,{fontSize:24/800,fontWeight:700,fontStyle:'italic'})!;
    expect(pdfFontSize(result.pdfText)).toBe(24);expect(textFontWeight(result)).toBe(700);expect(textFontStyle(result)).toBe('italic');
    expect(pdfFontFaceChanged(result)).toBe(true);expect(result.pdfText?.edited).toBe(true);
    expect(result.pdfText?.fontSizePdf).toBe(12);expect(result.pdfText?.sourceFontWeight).toBe(400);
    expect(result.pdfText?.transform).toEqual(original.pdfText?.transform);expect(result.bounds).toEqual(original.bounds);
  });
  it('can remove bold from an originally bold font and select a compatible regular face',()=>{
    const service=new StudioObjectService(),base=source();const original={...base,pdfText:{...base.pdfText!,sourceFontWeight:700 as const}};service.add(original);
    const result=service.updateTextStyle(original.id,{fontWeight:400})!;
    expect(textFontWeight(result)).toBe(400);expect(pdfFontFaceChanged(result)).toBe(true);expect(result.pdfText?.edited).toBe(true);
  });
  it('restores original size, style, destination and source visibility',()=>{
    const service=new StudioObjectService(),original=source();service.add(original);
    service.updateTextStyle(original.id,{fontSize:30/800,fontWeight:700,fontStyle:'italic'});
    service.updateBounds(original.id,{x:.2,y:.2,width:.5,height:.2});
    const restored=service.restorePdfText(original.id)!;
    expect(pdfFontSize(restored.pdfText)).toBe(12);expect(pdfFontFaceChanged(restored)).toBe(false);
    expect(restored.pdfText?.edited).toBe(false);expect(restored.bounds).toEqual(original.bounds);
    expect(restored.textStyle?.fontWeight).toBe(400);expect(restored.textStyle?.fontStyle).toBe('normal');
  });
  it('does not require a different face just to change the point size',()=>{
    const base=source();const original={...base,pdfText:{...base.pdfText!,replacementFontSizePdf:18}};
    expect(pdfFontSize(original.pdfText)).toBe(18);expect(pdfFontFaceChanged(original)).toBe(false);
  });
});
