import type { StudioImageData } from '../models/studio-selection.model';

/** One import path for the canvas and inspector. Decode orientation before
 * storing JPEG bytes, since PDF image embedding does not apply EXIF rotation. */
export async function readStudioImage(file: File): Promise<StudioImageData> {
  if (file.size > 20 * 1024 * 1024) throw new Error('The image exceeds the 20 MB limit. Choose a smaller image.');
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = [137,80,78,71,13,10,26,10].every((byte,index)=>header[index]===byte);
  const jpeg = header[0]===255 && header[1]===216 && header[2]===255;
  if (!png && !jpeg) throw new Error('Choose a valid PNG or JPEG image.');
  const mimeType = png ? 'image/png' : 'image/jpeg';
  const url = URL.createObjectURL(file);
  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    let source: CanvasImageSource;
    let width: number, height: number;
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      source = bitmap; width = bitmap.width; height = bitmap.height;
    } else {
      const image = new Image(); image.src = url; await image.decode();
      source = image; width = image.naturalWidth; height = image.naturalHeight;
    }
    if (!(width > 0 && height > 0) || width * height > 40_000_000) throw new Error('Choose an image smaller than 40 megapixels.');
    let dataUrl: string;
    if (jpeg) {
      canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Unable to decode this image.');
      context.drawImage(source, 0, 0);
      dataUrl = canvas.toDataURL(mimeType, .95);
    } else {
      dataUrl = await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>typeof reader.result==='string' ? resolve(reader.result) : reject(new Error('Unable to read this image.'));
        reader.onerror=()=>reject(new Error('Unable to read this image.'));
        reader.readAsDataURL(new Blob([file], {type:mimeType}));
      });
    }
    return {dataUrl,mimeType,naturalWidth:width,naturalHeight:height,aspectRatio:width/height};
  } finally {
    bitmap?.close(); URL.revokeObjectURL(url);
    if (canvas) canvas.width = canvas.height = 0;
  }
}
