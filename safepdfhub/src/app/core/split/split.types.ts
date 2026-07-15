export type SplitMode =
  | 'range'
  | 'every-page'
  | 'every-n'
  | 'extract';

export interface SplitRequest {
  mode:SplitMode;
  pageRanges?:string;
  everyN?:number;
  selectedPages?:number[];
}

export interface SplitGroup {
  pages:number[];
  label?: string;
}

export interface SplitOutput {
  files: File[];
}

export interface SplitOptions {
  pageRanges?: string;
  everyN?: number;
  selectedPages?: number[];
  totalPages: number;
}