/** Keep lossless line art when compact, use JPEG for photographic/noisy pages.
 * Dimensions are unchanged. Work is bounded to one canvas and one page's encodings.
 */
export async function wordImage(
  canvas: HTMLCanvasElement,
  check: () => void,
): Promise<{ bytes: Uint8Array; format: "png" | "jpg" } | null> {
  check();
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to read the PDF page artwork.");
  let blank = true;
  // Read strips rather than allocating a second full-page RGBA buffer. Never
  // sample pixels: a small signature, rule or punctuation must not disappear.
  for (let y = 0; y < canvas.height && blank; y += 32) {
    check();
    const { data } = context.getImageData(
      0,
      y,
      canvas.width,
      Math.min(32, canvas.height - y),
    );
    for (let i = 0; i < data.length; i += 4) {
      if (
        data[i + 3] &&
        (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255)
      ) {
        blank = false;
        break;
      }
    }
  }
  if (blank) return null;
  const encode = (type: string, quality?: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          try {
            check();
            if (!blob?.size)
              throw new Error("Unable to encode the PDF page artwork.");
            resolve(blob);
          } catch (error) {
            reject(error);
          }
        },
        type,
        quality,
      );
    });
  const png = await encode("image/png");
  let jpeg: Blob | null = null;
  try {
    jpeg = await encode("image/jpeg", 0.88);
  } catch {
    // JPEG is an optimization. A working PNG must remain usable if a browser
    // cannot encode JPEG; cancellation still propagates immediately.
    check();
  }
  // Some browsers fall back to PNG for unsupported encoders. Trust the MIME
  // returned by the browser, not just the requested extension.
  const useJpeg = jpeg?.type === "image/jpeg" && jpeg.size < png.size * 0.85;
  const bytes = new Uint8Array(await (useJpeg ? jpeg! : png).arrayBuffer());
  check();
  return { bytes, format: useJpeg ? "jpg" : "png" };
}
