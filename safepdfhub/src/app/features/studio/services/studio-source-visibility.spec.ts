import { visibleStudioSources, studioDisplayBounds } from './studio-source-visibility';
import type { StudioObject } from '../models/studio-selection.model';
describe('replaced source region selection',()=>{
  it('hides old labels at their original position, retains new annotations and the moved replacement',()=>{
    const objects=[
      {id:'chart',pageNumber:1,bounds:{x:.5,y:.5,width:.3,height:.3},pdfImage:{replaced:true,sourceBounds:{x:.1,y:.1,width:.3,height:.3}}},
      {id:'label',pageNumber:1,bounds:{x:.15,y:.15,width:.1,height:.03},pdfText:{edited:true}},
      {id:'new',pageNumber:1,bounds:{x:.15,y:.15,width:.1,height:.03}},
      {id:'other-page',pageNumber:2,bounds:{x:.15,y:.15,width:.1,height:.03},pdfText:{}},
    ] as StudioObject[];
    expect(visibleStudioSources(objects).map(o=>o.id)).toEqual(['chart','new','other-page']);
  });

  it('keeps drag movement while applying the last completed paragraph-flow offset',()=>{
    const snapshot={x:.2,y:.3,width:.4,height:.2};
    const rendered={...snapshot,y:.35};
    const current={...snapshot,x:.1,y:.32};
    const displayed=studioDisplayBounds(current,rendered,snapshot);
    expect(displayed.x).toBeCloseTo(.1);
    expect(displayed.y).toBeCloseTo(.37);
    expect(studioDisplayBounds(current)).toEqual(current);
  });
});
