export interface StudioHeaderViewModel {
  fileName: string;
  isDirty: boolean;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  processingMode: 'browser' | 'cloud';
}