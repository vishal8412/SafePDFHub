import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';

@Injectable({
  providedIn: 'root'
})
export class MergeEngine {

  private CHUNK_SIZE = 25;

async merge(
  files: File[],
  onProgress?: (p: number) => void
): Promise<File> {

  const CHUNK_SIZE = 25;

  const merged = await PDFDocument.create();

  // let totalPages = 0;
  // let processedPages = 0;
  let processedFiles = 0;

for (const file of files) {

  const buffer =
    await file.arrayBuffer();

  const src =
    await PDFDocument.load(buffer);

  const pageIndices =
    src.getPageIndices();

  for (
    let i = 0;
    i < pageIndices.length;
    i += this.CHUNK_SIZE
  ) {

    const chunk =
      pageIndices.slice(
        i,
        i + this.CHUNK_SIZE
      );

    const pages =
      await merged.copyPages(
        src,
        chunk
      );

    pages.forEach(p =>
      merged.addPage(p)
    );

    await new Promise(r =>
      setTimeout(r, 0)
    );
  }

  processedFiles++;

  onProgress?.(
    Math.round(
      (processedFiles / files.length) * 100
    )
  );

  // cleanup
  // @ts-ignore
  src.context = null;

  await new Promise(r =>
    setTimeout(r, 0)
  );
}

  const bytes =
    await merged.save();

  return new File(
    [new Uint8Array(bytes)],
    'merged.pdf',
    {
      type: 'application/pdf'
    }
  );
}

}