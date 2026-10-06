import { vi } from 'vitest';
import { PdfContentAnalysisService } from './pdf-content-analysis.service';
import { StudioObjectService } from './studio-object.service';
import type { StudioPdfDocument } from '../models/pdf-document.model';

vi.mock('pdfjs-dist', () => ({ OPS: { save: 1, restore: 2, transform: 3, paintFormXObjectBegin: 4, paintFormXObjectEnd: 5, paintImageXObject: 6, showText: 7, setFillRGBColor: 8, paintImageXObjectRepeat: 9, paintInlineImageXObjectGroup: 10 } }));
const documentFixture = (id = 'one') => ({ id, pageCount: 1 } as StudioPdfDocument);
const pageFixture = (ops = { fnArray: [8, 7], argsArray: [['#123456'], []] as unknown[][] }) => ({
  pageNumber: 1, userUnit: 1,
  getViewport: () => ({ width: 600, height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800 - y] }),
  getTextContent: async () => ({ items: [{ str: '', transform: [18,0,0,18,50,680], width: 0, height: 0 }, { str: 'Original text', fontName: 'F1', transform: [18,0,0,18,50,680], width: 120, height: 18 }], styles: { F1: { ascent: .8, descent: -.2 } } }),
  getOperatorList: async () => ops,
  commonObjs: { get: () => null },
});

describe('Studio source analysis and editing regressions', () => {
  it('retains the PDF baseline and converts only screen bounds; empty items do not consume colors', async () => {
    const analysis = await new PdfContentAnalysisService().ensurePage(documentFixture(), 1, async () => pageFixture() as any);
    const line = analysis!.textBlocks[0];
    expect(line.transform).toEqual([18,0,0,18,50,680]);
    expect(line.baselineYPdf).toBe(680);
    expect(line.y).toBeCloseTo((800-680-14.4)/800);
    expect(line.textColor).toBe('#123456');
  });
  it('uses nested form transforms and all mirrored image corners', async () => {
    const page = pageFixture({ fnArray: [4,3,6,5], argsArray: [[[1,0,0,1,20,30]],[-100,0,0,50,200,300],['img'],[]] });
    const result = await new PdfContentAnalysisService().ensurePage(documentFixture(), 1, async () => page as any);
    expect(result!.imageBlocks[0].x).toBeCloseTo(120/600);
    expect(result!.imageBlocks[0].y).toBeCloseTo(420/800);
    expect(result!.imageBlocks[0].width).toBeCloseTo(100/600);
    expect(result!.imageBlocks[0].height).toBeCloseTo(50/800);
  });
  it('finds every occurrence of optimized repeated image paints',async()=>{
    const page=pageFixture({fnArray:[3,9],argsArray:[[1,0,0,1,20,30],['img',100,50,new Float32Array([0,100,200,300])]]});
    const result=await new PdfContentAnalysisService().ensurePage(documentFixture(),1,async()=>page as any);
    expect(result!.imageBlocks).toHaveLength(2);
    expect(result!.imageBlocks[0].x).toBeCloseTo(20/600);
    expect(result!.imageBlocks[1].x).toBeCloseTo(220/600);
  });
  it('does not let a failed old document replace new analysis status', async () => {
    const service = new PdfContentAnalysisService();
    let reject!: (e: Error) => void;
    const old = service.ensurePage(documentFixture('old'), 1, () => new Promise((_, r) => reject = r));
    await service.ensurePage(documentFixture('new'), 1, async () => pageFixture() as any);
    reject(new Error('old document closed')); await old;
    expect(service.analysis()?.documentId).toBe('new');
    expect(service.analysis()?.status).not.toBe('error');
  });
  it('distinguishes automatic appearance capture from user changes and retains style edits', async () => {
    const result = await new PdfContentAnalysisService().ensurePage(documentFixture(), 1, async () => pageFixture() as any);
    const store = new StudioObjectService();
    store.syncPdfTextBlocks(result!.textBlocks);
    const id = result!.textBlocks[0].id;
    store.updatePdfTextAppearance(id, { backgroundColor: '#ffff00' });
    expect(store.get(id)?.pdfText?.edited).toBe(false);
    store.updatePdfTextAppearance(id, { textColor: '#ff0000' }, true);
    store.updateText(id, 'Original text');
    expect(store.get(id)?.pdfText?.edited).toBe(true);
    store.syncPdfTextBlocks(result!.textBlocks);
    expect(store.get(id)?.pdfText?.textColor).toBe('#ff0000');
  });

  it('groups matching consecutive lines but respects paragraph gaps and font changes', async () => {
    const page = pageFixture({fnArray:[8,7,7,7,7],argsArray:[['#123456'],[],[],[],[]]});
    page.getTextContent = async () => ({ items: [
      {str:'First line',fontName:'F1',transform:[18,0,0,18,50,680],width:120,height:18},
      {str:'Second line',fontName:'F1',transform:[18,0,0,18,50,656],width:130,height:18},
      {str:'New paragraph',fontName:'F1',transform:[18,0,0,18,50,610],width:160,height:18},
      {str:'Different font',fontName:'F2',transform:[18,0,0,18,50,586],width:140,height:18},
    ], styles:{F1:{ascent:.8,descent:-.2},F2:{ascent:.8,descent:-.2}} });
    const result = await new PdfContentAnalysisService().ensurePage(documentFixture(),1,async()=>page as any);
    expect(result!.textBlocks.map(block=>block.text)).toEqual(['First line Second line','New paragraph','Different font']);
    expect(result!.textBlocks[0].sourceLines).toHaveLength(2);
    expect(result!.textBlocks[0].lineHeightPdf).toBe(24);
    expect(result!.textBlocks[0].sourceLines![1].transform[5]).toBe(656);
  });
  it('retains source text erase geometry when resizing and reanalyzing', async () => {
    const result=await new PdfContentAnalysisService().ensurePage(documentFixture(),1,async()=>pageFixture() as any);
    const store=new StudioObjectService();store.syncPdfTextBlocks(result!.textBlocks);
    const id=result!.textBlocks[0].id,original=store.get(id)!;
    store.updateBounds(id,{...original.bounds,width:.6,height:.15});
    store.syncPdfTextBlocks(result!.textBlocks);
    const changed=store.get(id)!;
    expect(changed.bounds.width).toBe(.6);
    expect(changed.pdfText!.sourceBounds).toEqual(original.bounds);
    expect(changed.pdfText!.transform).toEqual(original.pdfText!.transform);
    expect(changed.pdfText!.edited).toBe(true);
    store.restorePdfText(id);
    expect(store.get(id)!.bounds).toEqual(original.bounds);
    expect(store.get(id)!.pdfText!.sourceBounds).toBeUndefined();
  });
  it('does not wait for unrelated page fonts when a source font has no bytes', async () => {
    const service:any=new PdfContentAnalysisService();
    const descriptor=Object.getOwnPropertyDescriptor(document,'fonts');
    Object.defineProperty(document,'fonts',{configurable:true,value:{ready:new Promise(()=>{})}});
    try {
      expect(await service.ensureBrowserSourceFontFace('doc',1,'font','loaded',null,null,400,false)).toBe('loaded');
    } finally {
      if(descriptor)Object.defineProperty(document,'fonts',descriptor);else delete (document as any).fonts;
    }
  });
  it('retains the source image region through moves, resync and restore', async () => {
    const page = pageFixture({fnArray:[3,6],argsArray:[[100,0,0,50,200,300],['img']]});
    const result = await new PdfContentAnalysisService().ensurePage(documentFixture(),1,async()=>page as any);
    const store = new StudioObjectService();
    store.syncPdfImageBlocks(result!.imageBlocks);
    const id=result!.imageBlocks[0].id;
    const original=store.get(id)!.bounds;
    store.updateImageData(id,{dataUrl:'data:image/png;base64,AA==',width:20,height:10,mimeType:'image/png'} as any);
    store.updateBounds(id,{...original,x:.1});
    store.syncPdfImageBlocks(result!.imageBlocks);
    expect(store.get(id)!.bounds.x).toBe(.1);
    expect(store.get(id)!.pdfImage!.sourceBounds).toEqual(original);
    store.clearImageData(id);
    expect(store.get(id)!.bounds).toEqual(original);
    expect(store.get(id)!.pdfImage!.replaced).toBe(false);
  });
});

describe('PDF producer layout variations', () => {
  const analyze = async (items: any[], ops?: any) => {
    const page = pageFixture(ops ?? {fnArray:[8,...items.map(()=>7)],argsArray:[['#123456'],...items.map(()=>[])]});
    page.getTextContent = async () => ({items, styles:{F1:{ascent:.8,descent:-.2}}});
    return (await new PdfContentAnalysisService().ensurePage(documentFixture(), 1, async () => page as any))!.textBlocks;
  };
  const item = (str: string, x: number, y: number, width=100, size=12) => ({str,fontName:'F1',transform:[size,0,0,size,x,y],width,height:size});
  it('joins fragments left-to-right despite fractional baseline jitter', async () => {
    const blocks = await analyze([item('world',104,680.2,30),item('Hello',70,680,30)]);
    expect(blocks.map(b=>b.text)).toEqual(['Hello world']);
    expect(blocks[0].baselineXPdf).toBe(70);
  });
  it('groups each paragraph independently when two columns interleave', async () => {
    const blocks = await analyze([item('Left one',40,680),item('Right one',340,680),item('Left two',40,664),item('Right two',340,664)]);
    expect(blocks.map(b=>b.text)).toEqual(['Left one Left two','Right one Right two']);
  });
  it('keeps aligned table cells separate and orders navigation across rows', async () => {
    const blocks = await analyze([item('1',40,680,8),item('2',140,680,8),item('3',240,680,8),
      item('4',40,664,8),item('5',140,664,8),item('6',240,664,8)]);
    expect(blocks.map(b=>b.text)).toEqual(['1','2','3','4','5','6']);
    expect(new Set(blocks.map(b=>b.tableId)).size).toBe(1);
    expect(blocks[0].tableId).toBeTruthy();
    expect(blocks.map(b=>b.tableOrder)).toEqual([0,1,2,3,4,5]);
  });
  it('does not mark an isolated row as a table', async () => {
    const blocks = await analyze([item('1',40,680,8),item('2',140,680,8),item('3',240,680,8)]);
    expect(blocks.every(b=>!b.tableId)).toBe(true);
  });
  it('does not combine different font sizes or separate list items', async () => {
    const blocks = await analyze([item('Large',40,680,40,18),item('small',84,680,40,12),item('• First',40,640),item('• Second',40,624)]);
    expect(blocks.map(b=>b.text)).toEqual(['Large','small','• First','• Second']);
  });
  it('binds colors by glyph content when one show operator yields several text items', async () => {
    const glyphs = (text:string) => [...text].map(unicode=>({unicode}));
    const blocks = await analyze([item('Red',40,680,20),item('words',63,680,30),item('Blue',40,640,30)],
      {fnArray:[8,7,8,7],argsArray:[['#ff0000'],[glyphs('Red words')],['#0000ff'],[glyphs('Blue')]]});
    expect(blocks.map(b=>[b.text,b.textColor])).toEqual([['Red words','#ff0000'],['Blue','#0000ff']]);
  });
  it('joins equivalent face resources despite different PDF.js font aliases',()=>{
    const service:any=new PdfContentAnalysisService();
    expect(service.sameSourceFace({fontName:'g_d0_f1',sourceFontName:'ABCDEF+Calibri'},
      {fontName:'g_d0_f2',sourceFontName:'UVWXYZ+Calibri'})).toBe(true);
    expect(service.sameSourceFace({fontName:'g_d0_f1',sourceFontName:'ABCDEF+Calibri'},
      {fontName:'g_d0_f2',sourceFontName:'UVWXYZ+Calibri-Bold'})).toBe(false);
  });
  it('keeps the full bounds of an indented paragraph and clears obsolete first-line runs', async () => {
    const blocks = await analyze([item('Indented first',52,680,110),item('Continuation',40,664,140)]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].baselineXPdf).toBe(40);
    expect(blocks[0].textWidthPdf).toBeCloseTo(140);
    expect(blocks[0].sourceRuns).toBeUndefined();
    expect(blocks[0].sourceLines![0].transform[4]).toBe(52);
  });
});
