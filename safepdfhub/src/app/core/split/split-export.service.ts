import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import {SplitGroup, SplitOutput} from './split.types';
import { SPLIT_FILE_PREFIX } from './split.constants';

@Injectable({
  providedIn: 'root'
})

export class SplitExportService {

  async export(source: File, groups: SplitGroup[], onProgress?: (progress: number) => void): Promise<SplitOutput> {

    const sourceBytes = await source.arrayBuffer();
    const sourceDoc = await PDFDocument.load(sourceBytes);
    const files: File[] = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const newDoc = await PDFDocument.create();
      const copiedPages = await newDoc.copyPages(sourceDoc, group.pages.map(page => page - 1));
      copiedPages.forEach(page => newDoc.addPage(page));
      const bytes = await newDoc.save();
      const fileName = group.label ? `${group.label}.pdf` : `${SPLIT_FILE_PREFIX}-${i + 1}.pdf`;
      const file = this.createPdfFile(bytes,fileName);

      files.push(file);
      
      onProgress?.(Math.round(((i + 1) / groups.length) * 100));
    }

    return {files};

  }

  private createPdfFile(bytes: Uint8Array,fileName: string): File {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new File([arrayBuffer], fileName, {type: 'application/pdf'});
  }

}