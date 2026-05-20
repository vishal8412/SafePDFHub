import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SecurityService {

  sanitizeFileName(name: string): string {
    return name.replace(/[^a-z0-9\.]/gi, '_').toLowerCase();
  }

  isFileSizeValid(file: File, maxMB = 20): boolean {
    return file.size / 1024 / 1024 <= maxMB;
  }
}