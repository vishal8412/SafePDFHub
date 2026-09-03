export type StudioPageKind = 'source' | 'blank';

export interface StudioPage {
  id: string;
  kind: StudioPageKind;
  sourcePageNumber: number | null;
  rotation: 0 | 90 | 180 | 270;
  blankWidth?: number;
  blankHeight?: number;
}
