import { vi } from 'vitest';
import { PdfContentAnalysisService } from './pdf-content-analysis.service';
import { StudioObjectService } from './studio-object.service';
import type { StudioPdfDocument } from '../models/pdf-document.model';

vi.mock('pdfjs-dist', () => ({ OPS: { save: 1, restore: 2, transform: 3, paintFormXObjectBegin: 4, paintFormXObjectEnd: 5, paintImageXObject: 6, showText: 7, setFillRGBColor: 8 } }));
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
