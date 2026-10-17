/** Reserve PDF structure and a margin before allocating bytes to supported images. */
export function allocateImageBudgets(targetBytes: number, documentBytes: number, imageSizes: number[]): number[] | null {
  if (!Number.isFinite(targetBytes) || targetBytes <= 0 || !imageSizes.length) return null;
  const imageBytes = imageSizes.reduce((sum, size) => sum + size, 0);
  const overhead = Math.max(0, documentBytes - imageBytes) + 16_384;
  const available = Math.floor((targetBytes - overhead) * 0.96);
  if (available <= imageSizes.length * 512) return null;
  // Complex pages receive more space without allowing a few noisy scans to
  // consume the entire budget. Shared image resources are counted only once.
  const weights = imageSizes.map(size => Math.sqrt(Math.max(1, size)));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(weight => Math.floor(available * weight / total));
}

/** Search at one resolution; callers may lower resolution and try again. */
export async function encodeJpegWithinBudget(
  encode: (quality: number) => Promise<Blob>, budget: number, maximumQuality = 0.85, minimumQuality = 0.10,
): Promise<Blob> {
  const initial = await encode(maximumQuality);
  if (initial.size <= budget) return initial;
  let best = await encode(minimumQuality);
  if (best.size > budget) return best;
  let low = minimumQuality, high = maximumQuality;
  for (let attempt = 0; attempt < 4; attempt++) {
    const middle = (low + high) / 2;
    const candidate = await encode(middle);
    if (candidate.size <= budget) { best = candidate; low = middle; }
    else high = middle;
  }
  return best;
}
