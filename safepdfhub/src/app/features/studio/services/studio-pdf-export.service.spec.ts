/// <reference types="node" />
import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { StudioPdfExportService } from './studio-pdf-export.service';
import { QpdfWasmPrototypeService } from '../../../core/qpdf/qpdf-wasm-prototype.service';
import { SigningPdfTextService } from '../../../core/signing/services/signing-pdf-text.service';

describe('Studio PDF export regressions', () => {
  let service: any;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: QpdfWasmPrototypeService, useValue: {} },
      { provide: SigningPdfTextService, useValue: {} },
    ] });
    service = TestBed.inject(StudioPdfExportService);
  });
  it('copies reordered, duplicated and blank pages with one shared resource copier', async () => {
    const source=await PDFDocument.create();source.addPage([300,400]);source.addPage([500,600]);
    const bytes=await source.save();const file={arrayBuffer:async()=>bytes.slice().buffer} as File;
    const spy=vi.spyOn(PDFDocument.prototype,'copyPages');
    const result=await service.exportTextObjects(file,[],[
      {id:'two',kind:'source',sourcePageNumber:2,rotation:90},
      {id:'blank',kind:'blank',sourcePageNumber:null,rotation:0,blankWidth:200,blankHeight:250},
      {id:'one',kind:'source',sourcePageNumber:1,rotation:0},
      {id:'copy',kind:'source',sourcePageNumber:2,rotation:0}]);
    expect(spy).toHaveBeenCalledTimes(1);expect(spy.mock.calls[0][1]).toEqual([1,0,1]);spy.mockRestore();
    const data=await new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(result)});
    const exported=await PDFDocument.load(data);expect(exported.getPages().map(p=>p.getSize())).toEqual([
      {width:500,height:600},{width:200,height:250},{width:300,height:400},{width:500,height:600}]);
    expect(exported.getPage(0).getRotation().angle).toBe(90);expect(exported.getPage(3).getRotation().angle).toBe(0);
  });
  it('paints highlights as one path so joints do not compound opacity', async () => {
    const doc=await PDFDocument.create(), page=doc.addPage([600,800]);
    const path=vi.spyOn(page,'drawSvgPath'), line=vi.spyOn(page,'drawLine');
    service.drawDrawingObject(page,{drawing:{points:[{x:.1,y:.2},{x:.2,y:.2},{x:.3,y:.2}],
      style:{strokeColor:'#00ff00',strokeWidth:.01,opacity:.3}}},600,800,0);
    expect(path).toHaveBeenCalledTimes(1);expect(line).not.toHaveBeenCalled();
    expect(path.mock.calls[0][0]).toBe('M 60 -640 L 120 -640 L 180 -640');
    expect(path.mock.calls[0][1]).toMatchObject({borderWidth:8,borderOpacity:.3,borderLineCap:1});
    expect((await doc.save()).length).toBeGreaterThan(0);
  });
  it('places rectangles and ellipses correctly on a rotated PDF', async () => {
    const doc=await PDFDocument.create(),page=doc.addPage([600,800]);
    const rectangle=vi.spyOn(page,'drawRectangle'),ellipse=vi.spyOn(page,'drawEllipse');
    const object:any={bounds:{x:.1,y:.2,width:.3,height:.1},shape:{kind:'rectangle',style:{strokeColor:'#ff0000',strokeWidth:.005,opacity:.5}}};
    service.drawShapeObject(page,object,800,600,90);
    expect(rectangle.mock.calls[0][0]).toMatchObject({x:120,y:80,width:60,height:240,rotate:{angle:0}});
    object.shape.kind='ellipse';service.drawShapeObject(page,object,800,600,90);
    expect(ellipse.mock.calls[0][0]).toMatchObject({x:150,y:200,xScale:30,yScale:120,rotate:{angle:0}});
  });
  it('uses chosen point size and font face in both the layout and drawing passes', async () => {
    const doc = await PDFDocument.create(); doc.addPage([600,800]).drawText('Original', {x:60,y:720,size:12});
    const bytes = await doc.save();
    const file = { arrayBuffer: async () => bytes.slice().buffer } as File;
    vi.spyOn(service, 'collectSourceFontBytes').mockResolvedValue(new Map());
    const fonts = vi.spyOn(service, 'getFont');
    const fits = vi.spyOn(service, 'resolveTextFit');
    const object: any = { id:'formatted',type:'text',pageNumber:1,text:'Bold replacement',
      bounds:{x:.1,y:.1,width:.7,height:.15},
      textStyle:{fontSize:18/800,fontWeight:700,fontStyle:'italic',fontFamily:'Helvetica',textAlign:'left',lineHeight:1.2,letterSpacing:0,color:'#000000'},
      pdfText:{originalText:'Original',fontName:'Helvetica',transform:[12,0,0,12,60,720],edited:true,
        pageWidthPdf:600,pageHeightPdf:800,fontSizePdf:12,textWidthPdf:420,textHeightPdf:120,lineHeightPdf:14.4,
        sourceFontFamily:'Helvetica',sourceFontWeight:400,sourceFontStyle:'normal',ascentPdf:10,descentPdf:-2,
        replacementFontSizePdf:18,replacementFontWeight:700,replacementFontStyle:'italic',fitMode:'original'} };
    const result = await service.exportTextObjects(file,[object],[{id:'one',kind:'source',sourcePageNumber:1,rotation:0}]);
    expect(result.size).toBeGreaterThan(0);
    expect(fonts.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const args of fonts.mock.calls) { expect(args[1]).toBe(700);expect(args[2]).toBe('italic');expect(args[5]).toBeNull(); }
    for (const args of fits.mock.calls) expect(args[2]).toBe(18);
    expect(service.resolveTextFit(object,await doc.embedFont('Helvetica-BoldOblique'),18,420,120,800).lineHeight).toBeCloseTo(21.6);
  });
  it('wraps long paragraphs at the chosen size instead of exporting an unwrapped line', async () => {
    const doc = await PDFDocument.create(), font = await doc.embedFont('Helvetica');
    const fit = service.resolveTextFit({text:'A paragraph with enough words to wrap across several lines.',pdfText:{fontSizePdf:12,lineHeightPdf:14.4,fitMode:'original'}},font,18,100,100,800);
    expect(fit.fontSize).toBe(18);expect(fit.lines.length).toBeGreaterThan(1);
    expect(fit.lines.join(' ')).toBe('A paragraph with enough words to wrap across several lines.');
  });
  it('anchors larger replacement text to the same top edge as the editor', () => {
    const drawText = vi.fn();
    const object: any = {textStyle:{textAlign:'left'},pdfText:{transform:[12,0,0,12,60,720],fontSizePdf:12,
      ascentPdf:10,textWidthPdf:300,replacementFontSizePdf:18}};
    service.drawEditedPdfTextFromSourceGeometry({drawText},object,['Larger'],{widthOfTextAtSize:()=>40},18,21.6);
    expect(drawText.mock.calls[0][1].y).toBe(715);
    expect(object.pdfText.transform[5]).toBe(720);
  });
  it('parses the immutable source once across distinct page previews', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([600,800]); pdf.addPage([300,400]);
    const bytes = await pdf.save();
    const arrayBuffer = vi.fn(async () => bytes.slice().buffer);
    const file = { arrayBuffer } as unknown as File;
    const read = (blob: Blob) => new Promise<ArrayBuffer>((resolve,reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject; reader.readAsArrayBuffer(blob);
    });
    const first = await service.createPreviewFile(file, {id:'one',kind:'source',sourcePageNumber:1,rotation:90});
    const second = await service.createPreviewFile(file, {id:'two',kind:'source',sourcePageNumber:2,rotation:0});
    const again = await service.createPreviewFile(file, {id:'one',kind:'source',sourcePageNumber:1,rotation:0});
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect((await PDFDocument.load(await read(first))).getPage(0).getRotation().angle).toBe(90);
    expect((await PDFDocument.load(await read(second))).getPage(0).getWidth()).toBe(300);
    expect((await PDFDocument.load(await read(again))).getPage(0).getRotation().angle).toBe(0);
  });
  it('preserves metadata and editable form fields for ordinary edits', async () => {
    const pdf = await PDFDocument.create(); const page = pdf.addPage([600,800]);
    pdf.setTitle('Keep my metadata');
    const field = pdf.getForm().createTextField('name'); field.setText('Original');
    field.addToPage(page, { x:20,y:20,width:100,height:20 });
    const bytes = await pdf.save();
    const file = { arrayBuffer: async () => bytes.slice().buffer } as File;
    const blob = await service.exportTextObjects(file, [], [{id:'one',kind:'source',sourcePageNumber:1,rotation:0}]);
    const outputBytes = await new Promise<ArrayBuffer>((resolve,reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
    });
    const result = await PDFDocument.load(outputBytes);
    expect(result.getTitle()).toBe('Keep my metadata');
    expect(result.getForm().getTextField('name').getText()).toBe('Original');
  });
  it('keeps replacement orientation and CropBox offsets on a rotated page', () => {
    const drawImage = vi.fn();
    service.drawImageObject({ drawImage, getCropBox: () => ({x:20,y:30}) }, {
      bounds: {x:370/740,y:30/550,width:120/740,height:240/550},
      pdfImage: {displayRotation:90,fitMode:'fit'},
    }, {width:240,height:120}, 740,550,90);
    const options = drawImage.mock.calls[0][1];
    expect(options.x).toBeCloseTo(50);
    expect(options.y).toBeCloseTo(400);
    expect(options.width).toBeCloseTo(240);
    expect(options.height).toBeCloseTo(120);
    expect(options.rotate.angle).toBe(0);
  });
  it('draws the whole replacement and progresses new lines downward using fitted spacing', () => {
    const drawText = vi.fn();
    const font = {widthOfTextAtSize: (t: string, size: number) => t.length * size / 2};
    service.drawEditedPdfTextFromSourceGeometry({drawText}, {
      textStyle: {}, pdfText: {transform:[18,0,0,18,50,680],fontSizePdf:18,lineHeightPdf:18,textWidthPdf:200}
    }, ['Longer replacement suffix', 'Second line'], font, 12, 14);
    expect(drawText.mock.calls[0][0]).toBe('Longer replacement suffix');
    expect(drawText.mock.calls[0][1].y).toBe(680);
    expect(drawText.mock.calls[1][1].y).toBe(666);
  });
  it('shrinks longer replacements to the source area and refuses text that cannot fit', () => {
    const font = { widthOfTextAtSize: (text: string, size: number) => text.length * size / 2 };
    const object = { text: 'A longer replacement sentence', textStyle: {}, pdfText: {fitMode:'auto',lineHeightPdf:18} };
    const fit = service.resolveTextFit(object, font, 18, 150, 18, 800);
    expect(fit.fontSize).toBeLessThan(18);
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(18 + fit.fontSize * .15);
    expect(() => service.resolveTextFit({...object,text:'word '.repeat(1000)},font,18,150,18,800)).toThrow('too long');
  });
  it('ignores line separators when checking font coverage', () => {
    expect(service.fontSupportsText({getCharacterSet:()=>[65,66]}, 'A\nB')).toBe(true);
    expect(service.fontSupportsText({getCharacterSet:()=>[65,66]}, 'AΩ')).toBe(false);
  });

  it('reflows paragraphs at the requested size and retains explicit blank lines', () => {
    const font={widthOfTextAtSize:(text:string,size:number)=>text.length*size/2};
    const object={text:'First line with more words\n\nLast line',textStyle:{},pdfText:{fitMode:'flow',lineHeightPdf:14}};
    const fit=service.resolveTextFit(object,font,10,60,10,800);
    expect(fit.fontSize).toBe(10);
    expect(fit.lineHeight).toBe(14);
    expect(fit.lines).toEqual(['First line','with more','words','','Last line']);
  });
  it('rejects an overflowing final paragraph even when no later objects move', async () => {
    const pdf=await PDFDocument.create();pdf.addPage([600,800]);
    const bytes=await pdf.save();
    const file={arrayBuffer:async()=>bytes.slice().buffer} as File;
    vi.spyOn(service,'collectSourceFontBytes').mockResolvedValue(new Map());
    const object={id:'last',type:'text',pageNumber:1,text:'One\nTwo\nThree',bounds:{x:.1,y:.94,width:.5,height:.015},textStyle:{},pdfText:{edited:true,fitMode:'flow',transform:[12,0,0,12,60,38],fontSizePdf:12,textWidthPdf:300,textHeightPdf:12,lineHeightPdf:18,ascentPdf:10,descentPdf:-2}};
    await expect(service.exportTextObjects(file,[object])).rejects.toThrow('exceed the available space');
  });

  it('prepares just the selected logical page and applies its rotation once', async () => {
    const pdf=await PDFDocument.create();pdf.addPage([600,800]);pdf.addPage([400,500]);
    const bytes=await pdf.save();
    const file={arrayBuffer:async()=>bytes.slice().buffer} as File;
    const preview=await service.createPreviewFile(file,{id:'two',kind:'source',sourcePageNumber:2,rotation:90});
    const output=await new Promise<ArrayBuffer>((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(preview);
    });
    const result=await PDFDocument.load(output);
    expect(result.getPageCount()).toBe(1);
    expect(result.getPage(0).getWidth()).toBe(400);
    expect(result.getPage(0).getRotation().angle).toBe(90);
  });
});

describe('PDF replacement layout edge cases', () => {
  let service:any;
  beforeEach(()=>{
    TestBed.configureTestingModule({providers:[{provide:PLATFORM_ID,useValue:'browser'},{provide:QpdfWasmPrototypeService,useValue:{}},{provide:SigningPdfTextService,useValue:{}}]});
    service=TestBed.inject(StudioPdfExportService);
  });
  const font={widthOfTextAtSize:(text:string,size:number)=>Array.from(text).length*size/2};
  it('wraps a long token after an existing word instead of letting it overflow',()=>{
    const lines=service.wrapText('Hi abcdefghijklmnopqrstuvwxyz',font,10,40);
    expect(lines.join('')).toBe('Hiabcdefghijklmnopqrstuvwxyz');
    expect(lines.every((line:string)=>font.widthOfTextAtSize(line,10)<=40)).toBe(true);
  });
  it('does not shrink a single line because another line has a distant baseline',()=>{
    const fit=service.resolveTextFit({text:'Hello',pdfText:{fitMode:'auto',lineHeightPdf:20}},font,10,100,10,800);
    expect(fit.fontSize).toBe(10);
  });
  it('falls back before a stripped embedded font can poison deferred PDF saving', async()=>{
    const bytes=new Uint8Array(readFileSync('src/assets/fonts/Carlito-Regular.ttf'));
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    // Simulate a valid PDF subset missing the optional TrueType post table.
    for(let n=0;n<view.getUint16(4);n++) {
      const offset=12+n*16;
      if(String.fromCharCode(...bytes.slice(offset,offset+4))==='post') bytes.set([120,120,120,120],offset);
    }
    const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
    const selected=await service.getFont(pdf,400,'normal','Helvetica',new Map(),bytes,'Visible replacement','Satoshi');
    pdf.addPage().drawText('Visible replacement',{font:selected});
    await expect(pdf.save()).resolves.toBeInstanceOf(Uint8Array);
    expect(selected.name).toBe('Helvetica');
  });
  it('fails closed when a font cannot report coverage',()=>{
    expect(service.fontSupportsText({getCharacterSet:()=>{throw new Error('invalid cmap')}},'Hello')).toBe(false);
  });
});
