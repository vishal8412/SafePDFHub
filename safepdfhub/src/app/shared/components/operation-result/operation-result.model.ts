export type OperationResultIcon =
  | 'check'
  | 'signature'
  | 'protect'
  | 'unlock'
  | 'merge'
  | 'split'
  | 'compress'
  | 'edit'
  | 'watermark'
  | 'watermark-complete';

export interface OperationResultAction {
  readonly label: string;
  readonly description: string;
}
