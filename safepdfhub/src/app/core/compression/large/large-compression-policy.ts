/** Disk routing and image-quality policy are separate; sizes are decimal MB. */
export const LARGE_COMPRESSION_THRESHOLD = 32_000_000;
export const LOSSLESS_ONLY_THRESHOLD = 200_000_000;
export const MAX_COMPRESSION_BYTES = 500_000_000;
export type CompressionDevice = 'desktop' | 'tablet' | 'mobile';
export interface CompressionDeviceBudget {
  maxFileBytes: number;
  memoryMiB: number;
  maxPages: number;
  maxImagePixels: number;
  inspectionBytes: number;
}
export function compressionBudget(memoryGiB: number | null, device: CompressionDevice, diskWorker: boolean): CompressionDeviceBudget {
  const memory = memoryGiB !== null && Number.isFinite(memoryGiB) && memoryGiB > 0 ? memoryGiB : null;
  let mb: number, heap: number;
  if (!diskWorker || (memory !== null && memory <= 1)) { mb = 32; heap = 128; }
  else if (memory === null) {
    mb = device === 'desktop' ? 150 : device === 'tablet' ? 100 : 75; heap = 192;
  } else if (memory < 4) {
    mb = device === 'desktop' ? 100 : device === 'tablet' ? 75 : 50; heap = 128;
  } else if (memory < 8) {
    mb = device === 'desktop' ? 300 : device === 'tablet' ? 200 : 150;
    heap = device === 'desktop' ? 384 : device === 'tablet' ? 256 : 192;
  } else {
    mb = device === 'desktop' ? 500 : device === 'tablet' ? 300 : 200;
    heap = device === 'desktop' ? 512 : device === 'tablet' ? 384 : 256;
  }
  return { maxFileBytes: mb * 1_000_000, memoryMiB: heap,
    maxPages: device === 'desktop' ? 40_000 : device === 'tablet' ? 15_000 : 8_000,
    maxImagePixels: (heap === 128 ? 2 : heap === 192 ? 4 : heap === 256 ? 8 : heap === 384 ? 12 : 16) * 1_000_000,
    inspectionBytes: device === 'desktop' ? 8_000_000 : 2_000_000 };
}
export function compressionDevice(ua: string, platform: string, touchPoints: number, mobileHint: boolean | undefined, detected: string): CompressionDevice {
  if (/iPad/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/iPhone|Mobile/i.test(ua) || mobileHint === true || detected === 'mobile') return 'mobile';
  return detected === 'tablet' ? 'tablet' : 'desktop';
}
export function imageQualities(fileBytes: number, level: 'light' | 'recommended' | 'strong', losslessBytes: number, targetBytes?: number): number[] {
  if (fileBytes > LOSSLESS_ONLY_THRESHOLD || (targetBytes !== undefined && losslessBytes <= targetBytes)) return [];
  if (targetBytes !== undefined) {
    const gap = 1 - targetBytes / losslessBytes;
    return gap >= 0.4 ? [45, 20] : gap >= 0.2 ? [65, 45, 20] : [82, 65, 45];
  }
  return level === 'light' ? [] : [level === 'recommended' ? 82 : 55];
}
export function requiredScratchBytes(inputBytes: number, imageSearch = false): number {
  return Math.ceil(inputBytes * (imageSearch ? 22 : 11) / 10) + 32_000_000;
}

/** Only known higher-memory devices may parse a whole PDF in the native worker. */
export function nativeCompressionLimit(budget: CompressionDeviceBudget): number {
  return budget.memoryMiB >= 512 ? LOSSLESS_ONLY_THRESHOLD : budget.memoryMiB >= 384 ? 64_000_000 : 0;
}
