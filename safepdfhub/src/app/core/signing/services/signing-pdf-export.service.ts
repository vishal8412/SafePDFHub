import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PDFDocument, degrees, rgb, type PDFImage, type PDFPage } from 'pdf-lib';
import { saveAs } from 'file-saver';
import type { SigningField } from '../models/signing.models';

@Injectable({ providedIn: 'root' })
export class SigningPdfExportService {
  private readonly platformId = inject(PLATFORM_ID);

  async export(sourceFile: File, fields: readonly SigningField[], outputName?: string): Promise<Blob> {
    if (!isPlatformBrowser(this.platformId)) throw new Error('PDF export is available only in the browser.');
    const pdf = await PDFDocument.load(new Uint8Array(await sourceFile.arrayBuffer()));
    const pages = pdf.getPages();
    const images = new Map<string, PDFImage>();

    for (const field of fields) {
      const page = pages[field.pageNumber - 1];
      if (!page) continue;
      const rotation = ((page.getRotation().angle % 360) + 360) % 360 as 0 | 90 | 180 | 270;
      const width = rotation === 90 || rotation === 270 ? page.getHeight() : page.getWidth();
      const height = rotation === 90 || rotation === 270 ? page.getWidth() : page.getHeight();
      const box = this.displayBox(field, width, height, rotation);

      if (field.kind === 'checkbox') {
        this.drawCheckbox(page, box, field.checked ?? true, field.color ?? '#0b6c5f', field.opacity ?? 1);
        continue;
      }
      if (field.kind === 'text' || field.kind === 'date') {
        const text = field.value ?? (field.kind === 'date' ? new Date().toLocaleDateString() : '');
        if (!text) continue;
        const png = await this.renderTextField(text, field, box);
        const textImage = await pdf.embedPng(png);
        page.drawImage(textImage, { x: box.x, y: box.y, width: box.width, height: box.height, opacity: 1 });
        continue;
      }
      const asset = field.asset;
      if (!asset) continue;
      let image = images.get(asset.id);
      if (!image) {
        image = asset.mimeType === 'image/jpeg'
          ? await pdf.embedJpg(this.dataUrlToBytes(asset.dataUrl))
          : await pdf.embedPng(this.dataUrlToBytes(asset.dataUrl));
        images.set(asset.id, image);
      }
      this.drawImage(page, image, box, rotation, field.opacity ?? 1);
    }

    const bytes = await pdf.save({ useObjectStreams: true });
    // TS 5.9 may infer Uint8Array<ArrayBufferLike> here, while BlobPart
    // requires an ArrayBuffer-backed view. Create a concrete ArrayBuffer copy
    // so this remains type-safe across SharedArrayBuffer lib definitions.
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    const blob = new Blob([blobBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    if (outputName) saveAs(blob, outputName);
    return blob;
  }

  async exportAndDownload(sourceFile: File, fields: readonly SigningField[]): Promise<void> {
    const base = sourceFile.name.replace(/\.pdf$/i, '') || 'document';
    await this.export(sourceFile, fields, `${base}_signed.pdf`);
  }

  private displayBox(field: SigningField, displayWidth: number, displayHeight: number, rotation: 0 | 90 | 180 | 270) {
    const b = field.bounds;
    const x = b.x * displayWidth;
    const yTop = b.y * displayHeight;
    const w = b.width * displayWidth;
    const h = b.height * displayHeight;
    switch (rotation) {
      case 90: return { x: yTop, y: x, width: h, height: w };
      case 180: return { x: displayWidth - x - w, y: yTop, width: w, height: h };
      case 270: return { x: displayHeight - yTop - h, y: displayWidth - x - w, width: h, height: w };
      default: return { x, y: displayHeight - yTop - h, width: w, height: h };
    }
  }

  private drawImage(page: PDFPage, image: PDFImage, box: {x:number;y:number;width:number;height:number}, rotation: number, opacity: number): void {
    const options = { x: box.x, y: box.y, width: box.width, height: box.height, opacity: Math.max(0, Math.min(1, opacity)) };
    if (rotation === 90) page.drawImage(image, { ...options, x: box.x + box.width, y: box.y, width: box.height, height: box.width, rotate: degrees(90) });
    else if (rotation === 180) page.drawImage(image, { ...options, rotate: degrees(180) });
    else if (rotation === 270) page.drawImage(image, { ...options, x: box.x, y: box.y + box.height, width: box.height, height: box.width, rotate: degrees(270) });
    else page.drawImage(image, options);
  }

  private drawCheckbox(
    page: PDFPage,
    box: { x: number; y: number; width: number; height: number },
    checked: boolean,
    color: string,
    opacity: number,
  ): void {
    const c = this.hexToRgb(color);
    const alpha = Math.max(0.05, Math.min(1, opacity));
    page.drawRectangle({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      borderWidth: 1,
      borderColor: rgb(c.r, c.g, c.b),
      color: rgb(1, 1, 1),
      opacity: Math.min(0.92, alpha),
    });

    // Never use the Unicode ✓ glyph here. Standard PDF fonts use WinAnsi and
    // cannot encode that character reliably. A vector checkmark is portable.
    if (checked) {
      page.drawLine({
        start: { x: box.x + box.width * 0.18, y: box.y + box.height * 0.50 },
        end: { x: box.x + box.width * 0.42, y: box.y + box.height * 0.24 },
        thickness: Math.max(0.9, box.width * 0.075),
        color: rgb(c.r, c.g, c.b),
        opacity: alpha,
      });
      page.drawLine({
        start: { x: box.x + box.width * 0.42, y: box.y + box.height * 0.24 },
        end: { x: box.x + box.width * 0.84, y: box.y + box.height * 0.76 },
        thickness: Math.max(0.9, box.width * 0.075),
        color: rgb(c.r, c.g, c.b),
        opacity: alpha,
      });
    }
  }

  private async renderTextField(
    text: string,
    field: SigningField,
    box: { x: number; y: number; width: number; height: number },
  ): Promise<Uint8Array> {
    if (typeof document === 'undefined') {
      throw new Error('Text rendering is available only in the browser.');
    }

    const scale = 3;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(32, Math.ceil(box.width * scale));
    canvas.height = Math.max(24, Math.ceil(box.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create the text rendering canvas.');

    const color = field.color ?? '#121923';
    const opacity = Math.max(0.05, Math.min(1, field.opacity ?? 1));
    const family = field.fontFamily ?? (field.kind === 'date'
      ? '"Segoe Script", "Brush Script MT", "Segoe Print", cursive'
      : 'Inter, Arial, sans-serif');
    const style = field.fontStyle === 'italic' ? 'italic ' : '';
    const targetSize = Math.max(8, Math.min(96, field.fontSize ?? 16)) * scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    let fontSize = targetSize;
    const horizontalPadding = 4 * scale;
    const maxWidth = Math.max(8, canvas.width - horizontalPadding * 2);
    for (let i = 0; i < 12; i += 1) {
      ctx.font = `${style}${fontSize}px ${family}`;
      if (ctx.measureText(text).width <= maxWidth || fontSize <= 8 * scale) break;
      fontSize *= 0.9;
    }

    ctx.fillText(text, horizontalPadding, canvas.height / 2);
    ctx.globalAlpha = 1;

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not rasterize the signing text.');
    return new Uint8Array(await blob.arrayBuffer());
  }


  private hexToRgb(value: string): { r: number; g: number; b: number } {
    const hex = value.replace('#', '').trim();
    const normalized = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex;
    const parsed = Number.parseInt(normalized, 16);
    if (!Number.isFinite(parsed)) return { r: 0.07, g: 0.10, b: 0.14 };
    return { r: ((parsed >> 16) & 255) / 255, g: ((parsed >> 8) & 255) / 255, b: (parsed & 255) / 255 };
  }

  private dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.split(',')[1] ?? '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    return bytes;
  }
}
