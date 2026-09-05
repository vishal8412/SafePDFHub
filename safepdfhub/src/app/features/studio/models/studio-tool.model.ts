export type StudioToolId =
  | 'select'
  | 'hand'
  | 'text'
  | 'image'
  | 'draw'
  | 'highlight'
  | 'shape'
  | 'rotate'
  | 'delete'
  | 'extract'
  | 'comment'
  | 'link'
  | 'more';

export type StudioToolKind =
  | 'interaction'
  | 'action';  

export interface StudioTool {
  readonly id: StudioToolId;
  readonly label: string;
  readonly shortcut?: string;
  readonly destructive?: boolean;
  readonly kind: StudioToolKind;
}
  
export type StudioInteractionTool =
  | 'select'
  | 'hand'
  | 'text'
  | 'image'
  | 'draw'
  | 'highlight'
  | 'shape'
  | 'comment';

export const STUDIO_INTERACTION_TOOLS:
  readonly StudioInteractionTool[] = [
    'select',
    'hand',
    'text',
    'image',
    'draw',
    'highlight',
    'shape',
    'comment'
  ];