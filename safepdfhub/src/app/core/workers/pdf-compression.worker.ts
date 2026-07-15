/// <reference lib="webworker" />

addEventListener('message', async ({ data }) => {

  const { imageData, width, height, quality } = data;

  try {

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Canvas context failed');
    }

    ctx.drawImage(imageData, 0, 0, width, height);

    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality
    });

    const buffer = await blob.arrayBuffer();

    postMessage(
      {
        success: true,
        bytes: buffer
      },
      [buffer]
    );

  } catch (e: any) {

    postMessage({
      success: false,
      error: e?.message
    });

  }

});
