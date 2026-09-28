/// <reference lib="webworker" />

addEventListener('message', async ({ data }) => {
  const { id, imageBitmap, width, height, quality } = data ?? {};

  try {
    if (!imageBitmap || !Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error('Invalid compression worker payload.');
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context failed.');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imageBitmap, 0, 0, width, height);
    imageBitmap.close?.();

    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: Math.min(1, Math.max(0, quality)),
    });
    const buffer = await blob.arrayBuffer();

    postMessage({ success: true, id, bytes: buffer }, [buffer]);
  } catch (error) {
    imageBitmap?.close?.();
    postMessage({
      success: false,
      id,
      error: error instanceof Error ? error.message : 'Worker compression failed.',
    });
  }
});
