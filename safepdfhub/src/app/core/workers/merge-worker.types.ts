export type MergeWorkerStage =
  | 'reading'
  | 'parsing'
  | 'copying'
  | 'serializing'
  | 'finalizing';

export type MergeWorkerMainMessage =
  | MergeWorkerStartMessage
  | MergeWorkerCancelMessage;

export interface MergeWorkerStartMessage {
  type: 'START';
  files: MergeWorkerInputFile[];
  budget: MergeWorkerBudget;
  totalKnownPages: number;
}

export interface MergeWorkerCancelMessage {
  type: 'CANCEL';
}

export interface MergeWorkerInputFile {
  name: string;
  type: string;
  buffer: ArrayBuffer;
}

export interface MergeWorkerBudget {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  maxPages: number;
}

export type MergeWorkerMessage =
  | MergeWorkerProgressMessage
  | MergeWorkerStageMessage
  | MergeWorkerErrorMessage
  | MergeWorkerCompleteMessage
  | MergeWorkerCancelledMessage;

export interface MergeWorkerProgressMessage {
  type: 'PROGRESS';
  progress: number;
}

export interface MergeWorkerStageMessage {
  type: 'STAGE';
  stage: MergeWorkerStage;
  message: string;
}

export interface MergeWorkerErrorMessage {
  type: 'ERROR';
  message: string;
  code?: MergeWorkerErrorCode;
}

export interface MergeWorkerCompleteMessage {
  type: 'COMPLETE';
  name: string;
  typeHint: string;
  buffer: ArrayBuffer;
}

export interface MergeWorkerCancelledMessage {
  type: 'CANCELLED';
}

export type MergeWorkerErrorCode =
  | 'CAPACITY'
  | 'INVALID_PDF'
  | 'WORKER'
  | 'UNKNOWN';
