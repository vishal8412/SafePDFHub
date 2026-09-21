export type OperationResultIcon =
  | 'check'
  | 'signature'
  | 'protect'
  | 'unlock'
  | 'merge'
  | 'split'
  | 'compress';

export interface OperationResultAction {
  readonly label: string;
  readonly description: string;
}
