import { Injectable } from '@angular/core';
import JSZip from 'jszip';

@Injectable({
  providedIn: 'root'
})
export class SplitZipService {

async createZip(files: File[]): Promise<Blob> {
  const zip = new JSZip();
  files.forEach(file => {
    zip.file(file.name,file);
  });

  return zip.generateAsync({type: 'blob'});

}

downloadZip(blob: Blob,fileName = 'split-pdf.zip') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 3000);

}

}