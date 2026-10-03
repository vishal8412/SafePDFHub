export type PdfResourceKind =
  | 'image'
  | 'font'
  | 'form-xobject'
  | 'pattern'
  | 'shading'
  | 'unknown';

export interface PdfForensicImageResource {
  key: string;
  width: number | null;
  height: number | null;
  filter: string | null;
  bytes: number;
  references: number;
  sampled: boolean;
}

export interface PdfForensicDuplicateGroup {
  fingerprint: string;
  objectCount: number;
  totalBytes: number;
  duplicateBytes: number;
}


export interface PdfForensicPageObservation {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  imageOperatorCount: number;
  imageAreaRatio: number;
  textItemCount: number;
  vectorOperatorCount: number;
}

export interface PdfForensicPageSummary {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  contentStreamCount: number;
  contentStreamBytes: number;
  imageOperatorCount: number;
  imageAreaRatio: number;
  textItemCount: number;
  vectorOperatorCount: number;
}

export interface PdfForensicAnalysis {
  version: 1;
  fileSize: number;
  pdfHeader: string | null;
  pageCount: number;
  sampledPageCount: number;

  objectCount: number;
  streamObjectCount: number;
  streamBytes: number;
  uniqueStreamCount: number;
  duplicateStreamGroupCount: number;
  duplicateStreamBytes: number;

  pageContentStreamCount: number;
  pageContentStreamBytes: number;
  uniquePageContentStreamCount: number;
  duplicatePageContentStreamGroupCount: number;
  duplicatePageContentBytes: number;

  imageResourceCount: number;
  uniqueImageResourceCount: number;
  imageBytes: number;
  imageReferenceCount: number;
  imageOperatorCount: number;
  imagePages: number;
  sampledImageAreaRatio: number;

  fontResourceCount: number;
  formXObjectCount: number;
  patternResourceCount: number;
  shadingResourceCount: number;

  duplicateStreams: PdfForensicDuplicateGroup[];
  duplicatePageContentStreams: PdfForensicDuplicateGroup[];
  imageResources: PdfForensicImageResource[];
  sampledPages: PdfForensicPageSummary[];

  metadata: {
    title: string | null;
    author: string | null;
    subject: string | null;
    creator: string | null;
    producer: string | null;
  };

  /** True when the low-level object inspection could not be completed. */
  partial: boolean;
}
