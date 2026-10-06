import { readStudioImage } from './studio-image-import';

describe('consistent image import validation',()=>{
  it('rejects oversized images before allocating decode buffers',async()=>{
    await expect(readStudioImage({size:21*1024*1024} as File)).rejects.toThrow('20 MB');
  });
  it('rejects mislabeled non-image bytes before browser decoding',async()=>{
    const file={size:8,type:'image/png',slice:()=>({arrayBuffer:async()=>new Uint8Array(8).buffer})} as unknown as File;
    await expect(readStudioImage(file)).rejects.toThrow('valid PNG or JPEG');
  });
});
