import { PDFDocument, PDFName } from 'pdf-lib';
import { collectPageFontPrograms, normalizePdfFontName, type PdfFontMetrics } from './pdf-source-fonts';

describe('native PDF font resources',()=>{
  it('keeps face variants while removing subset prefixes',()=>{
    expect(normalizePdfFontName('/ABCDEF+Satoshi-Medium')).toBe('satoshimedium');
    expect(normalizePdfFontName('/ABCDEF+Satoshi-Bold')).toBe('satoshibold');
  });
  it('reads descriptor metrics in PDF thousandths on each page including nested forms',async()=>{
    const pdf=await PDFDocument.create();const a=pdf.addPage(),b=pdf.addPage();
    const resources=(ascent:number,descent:number)=>pdf.context.obj({Font:{F1:{Type:'Font',Subtype:'Type0',BaseFont:'ABCDEF+Satoshi-Medium',DescendantFonts:[{Type:'Font',Subtype:'CIDFontType2',FontDescriptor:{Type:'FontDescriptor',Ascent:ascent,Descent:descent}}]}}});
    a.node.set(PDFName.of('Resources'),resources(1010,-240));
    const form=pdf.context.flateStream('',{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:resources(800,-200)});
    b.node.set(PDFName.of('Resources'),pdf.context.obj({XObject:{Form:pdf.context.register(form)}}));
    const metricsA=new Map<string,PdfFontMetrics>(),metricsB=new Map<string,PdfFontMetrics>();
    collectPageFontPrograms(pdf,0,metricsA);collectPageFontPrograms(pdf,1,metricsB);
    expect(metricsA.get('satoshimedium')).toEqual({ascent:1.01,descent:-.24});
    expect(metricsB.get('satoshimedium')).toEqual({ascent:.8,descent:-.2});
  });
});
