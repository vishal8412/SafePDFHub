export interface WorkspaceFile {
  id: string;
  file: File;
  preview?: string;
  pageCount?: number;
  previewLoading: boolean;
  previewProgress: number;
  previewError: boolean;
  selected?: boolean;
  processing?: boolean;
  resultUrl?: string;
  previewQueued: boolean;
  validationState?: 'checking' | 'ready' | 'large' | 'blocked';
  validationMessage?: string;
  validationCode?: import('../capacity/local-processing-capability.model').PdfValidationCode;
}