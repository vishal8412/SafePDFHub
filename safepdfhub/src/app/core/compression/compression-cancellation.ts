export class CompressionCancelledError extends Error {
  constructor(message = 'PDF compression was cancelled.') {
    super(message);
    this.name = 'CompressionCancelledError';
  }
}

export function throwIfCompressionCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CompressionCancelledError();
  }
}
