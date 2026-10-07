import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfWatermarkService } from './pdf-watermark.service';
import type { PdfWatermarkRequest } from './pdf-watermark.types';

const request: PdfWatermarkRequest = {kind:'text',text:'CONFIDENTIAL',opacity:.3,rotation:0,position:'center',
  pageSelection:{mode:'all'},tiled:false,fontSize:24,font:'Helvetica',color:'#000000',imageScalePercent:30};
describe('watermark capacity ownership', () => {
  it('does not reject an already accepted Studio file based on its intermediate size', async () => {
    TestBed.configureTestingModule({providers:[{provide:PLATFORM_ID,useValue:'browser'}]});
    const service=TestBed.inject(PdfWatermarkService);
    const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();
    const input={name:'edited.pdf',size:375*1024*1024,arrayBuffer:async()=>bytes.slice().buffer} as File;
    // This unit test isolates the old size gate; real large-byte exports are
    // exercised separately by the browser regression.
    vi.spyOn(service as any,'validateOutput').mockResolvedValue(undefined);
    const result=await service.apply(input,request);
    expect(result.pageCount).toBe(1);expect(result.watermarkedPageCount).toBe(1);expect(result.file.size).toBeGreaterThan(0);
    await expect(service.apply(input,{...request,pageSelection:{mode:'current',page:2}})).rejects.toThrow('outside');
  });
});
