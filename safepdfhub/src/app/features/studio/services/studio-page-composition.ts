import { PDFDocument, PDFPage, PDFName, pushGraphicsState, popGraphicsState, rectangle, clip, clipEvenOdd, endPath } from 'pdf-lib';
export interface SourceRegion { x:number; y:number; width:number; height:number; }
export interface PageFlow { below:number; delta:number; }
/** Recompose original vector content in clipped bands. Source geometry never
 * follows a dragged replacement. This is visual editing, not redaction. */
export async function composeStudioPage(pdf:PDFDocument,page:PDFPage,holes:SourceRegion[],flow:PageFlow[]):Promise<void> {
  if (!holes.length && !flow.length) return;
  const media=page.getMediaBox();
  const original=await pdf.embedPage(page,{left:media.x,bottom:media.y,right:media.x+media.width,top:media.y+media.height});
  await original.embed(); // Capture original Contents before replacing the page.
  page.node.set(PDFName.of('Contents'),pdf.context.obj([]));
  const cuts=[media.y+media.height,...flow.map(f=>f.below).filter(y=>y>media.y&&y<media.y+media.height),media.y].sort((a,b)=>b-a);
  for(let i=0;i<cuts.length-1;i++) {
    const top=cuts[i],bottom=cuts[i+1];
    if(top-bottom<.001)continue;
    const shift=flow.filter(f=>f.below>=top-.001).reduce((n,f)=>n+f.delta,0);
    page.pushOperators(pushGraphicsState(),rectangle(media.x,bottom-shift,media.width,top-bottom),clip(),endPath());
    for(const h of holes) page.pushOperators(rectangle(media.x,media.y-shift,media.width,media.height),rectangle(h.x,h.y-shift,h.width,h.height),clipEvenOdd(),endPath());
    page.drawPage(original,{x:media.x,y:media.y-shift,width:media.width,height:media.height});
    page.pushOperators(popGraphicsState());
  }
}
