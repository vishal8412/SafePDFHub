export type QpdfRuntimeErrorPhase =
  | 'runner-create'
  | 'runner-run'
  | 'runner-destroy';

export class QpdfRuntimeError extends Error {
  constructor(
    readonly phase: QpdfRuntimeErrorPhase,
    message: string,
    readonly causeError?: unknown,
    readonly cancelled = false,
  ) {
    super(message);
    this.name = 'QpdfRuntimeError';
  }
}

export function sanitizeQpdfRuntimeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw
    .replace(/[A-Za-z]:\\[^\r\n]*/g, '<path>')
    .replace(/(?:file|blob|https?):\/\/[^\s]+/gi, '<resource>')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return 'QPDF runtime failure.';
  return normalized.slice(0, 240);
}

export function qpdfRuntimeErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) {
    return error.name.slice(0, 80);
  }
  return typeof error;
}
