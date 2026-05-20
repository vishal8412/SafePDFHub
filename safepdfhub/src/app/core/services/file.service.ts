import { Injectable } from '@angular/core';
import { saveAs } from 'file-saver';

@Injectable({ providedIn: 'root' })
export class FileService {

  downloadFile(data: Blob, filename: string) {
    saveAs(data, filename);
  }

  validatePDF(file: File): boolean {
    return file.type === 'application/pdf';
  }
}