import { vi } from 'vitest';
import { PdfPageRendererService } from './pdf-page-renderer.service';

describe('PDF canvas render queue', () => {
  it('releases stale queued requests so rapid zoom/page changes cannot deadlock', async () => {
    const service = new PdfPageRendererService();
    const canvas = {style:{},getContext:()=>({setTransform:vi.fn(),clearRect:vi.fn(),fillRect:vi.fn()})} as unknown as HTMLCanvasElement;
    const pdf = {numPages:1,getPage:vi.fn()};
    const results = await Promise.allSettled([
      service.renderPage(pdf as any,1,canvas,1),
      service.renderBlankPage(canvas,600,800,1),
      service.renderBlankPage(canvas,600,800,2),
    ]);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({status:'fulfilled',value:{width:1200,height:1600,scale:2}});
    expect(pdf.getPage).not.toHaveBeenCalled();
  });
});
