import { Injectable } from '@angular/core';

interface PendingPdfTransfer {
  files: File[];
  autoAction?: string;
  expiresAt: number;
}

/**
 * Transfers File objects between tool routes without placing the File bytes in
 * Angular Router history state. A large File can remain browser-backed while
 * the route state contains only a short token.
 */
@Injectable({ providedIn: 'root' })
export class PdfFileTransferService {
  private readonly ttlMs = 2 * 60 * 1000;
  private readonly pending = new Map<string, PendingPdfTransfer>();

  put(files: readonly File[], autoAction?: string): string {
    const token = crypto.randomUUID();
    this.pending.set(token, {
      files: [...files],
      autoAction,
      expiresAt: Date.now() + this.ttlMs
    });

    setTimeout(() => {
      const entry = this.pending.get(token);
      if (entry && entry.expiresAt <= Date.now()) {
        this.pending.delete(token);
      }
    }, this.ttlMs + 1000);

    return token;
  }

  take(token: string): PendingPdfTransfer | null {
    const entry = this.pending.get(token);
    if (!entry) return null;

    this.pending.delete(token);
    if (entry.expiresAt <= Date.now()) return null;
    return entry;
  }
}
