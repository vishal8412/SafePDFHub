import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { vi } from 'vitest';
import { StudioFacade } from '../facade/studio.facade';
import { StudioStateService } from '../state/studio-state.service';
import { StudioPageService } from './studio-page.service';
import { PdfPageRendererService } from './pdf-page-renderer.service';
import { STUDIO_CANVAS_PADDING } from './studio-view-layout';
import type { StudioPdfDocument } from '../models/pdf-document.model';

describe('Compact Studio viewport',()=>{
  it('uses the stage inset for both source-page fit modes and blank pages',async()=>{
    TestBed.configureTestingModule({providers:[provideHttpClient()]});
    const facade=TestBed.inject(StudioFacade), state=TestBed.inject(StudioStateService), pages=TestBed.inject(StudioPageService), renderer=TestBed.inject(PdfPageRendererService);
    state.setDocument({id:'layout',name:'test.pdf',size:0,type:'application/pdf',pageCount:1,file:new File([],'test.pdf'),pdf:{getPage:async()=>({rotate:0})}} as unknown as StudioPdfDocument);
    pages.initialize(1);
    const source=vi.spyOn(renderer,'renderPage').mockResolvedValue({width:507,height:676,scale:.845});
    const canvas={} as HTMLCanvasElement;
    await facade.renderCurrentPage(canvas,1000,700);
    expect(source.mock.calls[0][3]).toMatchObject({mode:'fit-page',padding:STUDIO_CANVAS_PADDING,viewportHeight:700});
    facade.setViewMode('fit-width');
    await facade.renderCurrentPage(canvas,1000,700);
    expect(source.mock.calls[1][3]).toMatchObject({mode:'fit-width',padding:STUDIO_CANVAS_PADDING});
    pages.restore([{id:'blank',kind:'blank',sourcePageNumber:null,rotation:0,blankWidth:600,blankHeight:800}]);
    facade.setViewMode('fit-page');
    const blank=vi.spyOn(renderer,'renderBlankPage').mockResolvedValue({width:507,height:676,scale:.845});
    await facade.renderCurrentPage(canvas,1000,700);
    expect(blank.mock.calls[0][3]).toBeCloseTo((700-2*STUDIO_CANVAS_PADDING)/800);
  });
});
