/** Read only qpdf's bounded page/image inventory; never decoded image buffers. */
export function imageShapes(json: unknown, maxImagePixels: number): string[] {
  const pages = (json as {pages?: unknown[]})?.pages;
  if (!Array.isArray(pages)) throw new Error('Image inspection was unavailable.');
  return pages.map((page: any) => {
    if (!Array.isArray(page.images)) throw new Error('Image inspection was incomplete.');
    return page.images.map((image: any) => {
      const { width, height } = image;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > maxImagePixels) {
        throw new Error('An image exceeds the image-processing budget for this device.');
      }
      return `${width}x${height}`;
    }).sort().join(',');
  });
}
