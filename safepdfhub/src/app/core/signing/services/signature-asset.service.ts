import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  MAX_SIGNATURE_UPLOAD_BYTES,
  SIGNATURE_MIME_TYPES,
  MAX_SIGNATURE_IMAGE_PIXELS,
  MAX_SIGNATURE_IMAGE_DIMENSION,
  type SigningAsset,
  type SigningAssetKind,
  type SigningAssetSource,
} from '../models/signing.models';
import { SigningStateService } from './signing-state.service';

export interface TypedSignatureOptions {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  opacity?: number;
  italic?: boolean;
  letterSpacing?: number;
}

@Injectable()
export class SignatureAssetService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly state = inject(SigningStateService);

  async createDrawnAsset(
    canvas: HTMLCanvasElement,
    kind: SigningAssetKind = 'signature',
  ): Promise<SigningAsset> {
    this.assertBrowser();
    const trimmed = this.trimCanvas(canvas);
    if (!trimmed) throw new Error('Please draw a signature first.');
    return this.createFromCanvas(trimmed, kind, 'drawn', 'Drawn signature');
  }

  async createTypedAsset(
    text: string,
    kind: SigningAssetKind,
    options: TypedSignatureOptions = {},
  ): Promise<SigningAsset> {
    this.assertBrowser();
    const value = text.trim();
    if (!value) throw new Error('Enter a signature or initials first.');

    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 500;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not create the signature canvas.');

    const fontSize = Math.max(72, Math.min(280, options.fontSize ?? 190));
    const fontFamily = options.fontFamily ?? 'cursive';
    const color = options.color ?? '#111827';
    const opacity = Math.max(0.05, Math.min(1, options.opacity ?? 1));
    const letterSpacing = Math.max(-10, Math.min(30, options.letterSpacing ?? 0));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.textBaseline = 'middle';
    ctx.font = `${options.italic === false ? '' : 'italic '} ${fontSize}px ${fontFamily}`.trim();

    // Canvas has no portable letter-spacing API. Drawing character-by-character
    // gives us a predictable cross-browser result for the signature preview.
    if (letterSpacing === 0) {
      ctx.fillText(value, 70, canvas.height / 2);
    } else {
      let x = 70;
      for (const char of value) {
        ctx.fillText(char, x, canvas.height / 2);
        x += ctx.measureText(char).width + letterSpacing;
      }
    }

    ctx.globalAlpha = 1;
    // Typed signatures use the same tight transparent crop as drawn signatures.
    // This prevents large transparent margins from making the artwork look
    // faint/small when it is placed in Studio or Sign PDF.
    const trimmed = this.trimCanvas(canvas) ?? canvas;
    return this.createFromCanvas(trimmed, kind, 'typed', value);
  }

  async createUploadedAsset(file: File, kind: SigningAssetKind, options: { cleanupBackground?: boolean } = {}): Promise<SigningAsset> {
    this.assertBrowser();
    if (!file.type.startsWith('image/') || (!options.cleanupBackground && !SIGNATURE_MIME_TYPES.includes(file.type as typeof SIGNATURE_MIME_TYPES[number]))) {
      throw new Error('Upload a PNG or JPEG image for your signature.');
    }
    if (file.size > MAX_SIGNATURE_UPLOAD_BYTES) {
      throw new Error('Signature image must be 5 MB or smaller.');
    }
    const rawDataUrl = await this.readAsDataUrl(file);
    const rawDimensions = await this.readImageDimensions(rawDataUrl);
    this.assertSafeImageDimensions(rawDimensions.width, rawDimensions.height);
    const dataUrl = options.cleanupBackground ? await this.removeLightBackground(rawDataUrl, rawDimensions) : rawDataUrl;
    const dimensions = options.cleanupBackground ? await this.readImageDimensions(dataUrl) : rawDimensions;
    this.assertSafeImageDimensions(dimensions.width, dimensions.height);
    const asset: SigningAsset = {
      id: this.id(),
      kind,
      source: 'uploaded',
      dataUrl,
      mimeType: options.cleanupBackground ? 'image/png' : file.type as 'image/png' | 'image/jpeg',
      naturalWidth: dimensions.width,
      naturalHeight: dimensions.height,
      createdAt: Date.now(),
      label: file.name,
    };
    this.state.addAsset(asset);
    return asset;
  }

  setActive(asset: SigningAsset | null): void { this.state.setActiveAsset(asset); }

  private async createFromCanvas(canvas: HTMLCanvasElement, kind: SigningAssetKind, source: SigningAssetSource, label?: string): Promise<SigningAsset> {
    const dataUrl = canvas.toDataURL('image/png');
    const asset: SigningAsset = {
      id: this.id(),
      kind,
      source,
      dataUrl,
      mimeType: 'image/png',
      naturalWidth: canvas.width,
      naturalHeight: canvas.height,
      createdAt: Date.now(),
      label,
    };
    this.state.addAsset(asset);
    return asset;
  }


  private removeLightBackground(dataUrl: string, dimensions: { width: number; height: number }): Promise<string> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const cleanupImage = (): void => {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
      };

      image.onload = () => {
        let canvas: HTMLCanvasElement | null = null;
        try {
          this.assertSafeImageDimensions(dimensions.width, dimensions.height);
          canvas = document.createElement('canvas');
          canvas.width = dimensions.width;
          canvas.height = dimensions.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          for (let i = 0; i < pixels.data.length; i += 4) {
            const r = pixels.data[i];
            const g = pixels.data[i + 1];
            const b = pixels.data[i + 2];
            if (r > 242 && g > 242 && b > 242) pixels.data[i + 3] = 0;
          }
          ctx.putImageData(pixels, 0, 0);
          const result = canvas.toDataURL('image/png');
          resolve(result);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('The signature image could not be processed.'));
        } finally {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
          cleanupImage();
        }
      };
      image.onerror = () => {
        cleanupImage();
        reject(new Error('The signature image could not be processed.'));
      };
      image.src = dataUrl;
    });
  }

  private trimCanvas(source: HTMLCanvasElement): HTMLCanvasElement | null {
    const ctx = source.getContext('2d');
    if (!ctx || source.width === 0 || source.height === 0) return null;
    const pixels = ctx.getImageData(0, 0, source.width, source.height);
    let minX = source.width, minY = source.height, maxX = -1, maxY = -1;
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        if (pixels.data[(y * source.width + x) * 4 + 3] > 12) {
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < minX || maxY < minY) return null;
    const pad = 18;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropRight = Math.min(source.width, maxX + 1 + pad);
    const cropBottom = Math.min(source.height, maxY + 1 + pad);
    const cropWidth = Math.max(1, cropRight - cropX);
    const cropHeight = Math.max(1, cropBottom - cropY);

    const out = document.createElement('canvas');
    out.width = cropWidth;
    out.height = cropHeight;
    out.getContext('2d')!.drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    return out;
  }

  private readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read the signature image.'));
      reader.readAsDataURL(file);
    });
  }

  private assertSafeImageDimensions(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('The signature image has invalid dimensions.');
    }
    if (width > MAX_SIGNATURE_IMAGE_DIMENSION || height > MAX_SIGNATURE_IMAGE_DIMENSION) {
      throw new Error(`Signature image dimensions must be ${MAX_SIGNATURE_IMAGE_DIMENSION}px or smaller on each side.`);
    }
    if (width * height > MAX_SIGNATURE_IMAGE_PIXELS) {
      throw new Error(`Signature image is too large after decoding. Use an image with ${MAX_SIGNATURE_IMAGE_PIXELS.toLocaleString()} pixels or fewer.`);
    }
  }

  private readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
        resolve(dimensions);
      };
      image.onerror = () => {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
        reject(new Error('The uploaded signature image could not be decoded.'));
      };
      image.src = dataUrl;
    });
  }

  private assertBrowser(): void {
    if (!isPlatformBrowser(this.platformId)) throw new Error('Signature creation is available only in the browser.');
  }

  private id(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `sign-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
