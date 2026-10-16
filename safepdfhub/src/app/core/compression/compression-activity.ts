/** Progress metadata only; contains no document content or identifiers. */
export interface CompressionActivity {
  stage: 'reading' | 'optimizing' | 'writing' | 'checking';
  current?: number;
  total?: number;
  pass?: number;
  passes?: number;
}
export type CompressionActivityObserver = (activity: CompressionActivity) => void;
