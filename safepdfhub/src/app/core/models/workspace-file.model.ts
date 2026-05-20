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
}