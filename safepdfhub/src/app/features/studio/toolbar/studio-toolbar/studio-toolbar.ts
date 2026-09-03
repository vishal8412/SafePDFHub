import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';

import type {
  StudioToolId
} from '../../models/studio-tool.model';

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

@Component({
  selector: 'app-studio-toolbar',
  standalone: true,
  templateUrl: './studio-toolbar.html',
  styleUrl: './studio-toolbar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudioToolbar {

  /**
   * The active interaction tool is owned by
   * Studio state through the parent Shell.
   *
   * The Toolbar only displays this value.
   */
  @Input()
  activeTool: StudioToolId = 'select';

  /**
   * F5 — History state is owned by StudioFacade and rendered here so Undo/Redo
   * remain immediately available beside the editing tools.
   */
  @Input()
  canUndo = false;

  @Input()
  canRedo = false;

  @Output()
  readonly toolSelected =
    new EventEmitter<StudioToolId>();

  @Output()
  readonly undo =
    new EventEmitter<void>();

  @Output()
  readonly redo =
    new EventEmitter<void>();

  /**
   * Persistent interaction tools and one-shot actions.
   */
  readonly tools:
    readonly StudioTool[] = [

    {
      id: 'select',
      label: 'Select',
      shortcut: 'V',
      kind: 'interaction'
    },

    {
      id: 'hand',
      label: 'Hand',
      shortcut: 'H',
      kind: 'interaction'
    },

    {
      id: 'text',
      label: 'Text',
      shortcut: 'T',
      kind: 'interaction'
    },

    {
      id: 'image',
      label: 'Image',
      kind: 'interaction'
    },

    {
      id: 'draw',
      label: 'Draw',
      shortcut: 'D',
      kind: 'interaction'
    },

    {
      id: 'highlight',
      label: 'Highlight',
      kind: 'interaction'
    },

    {
      id: 'shape',
      label: 'Shape',
      kind: 'interaction'
    },

    {
      id: 'rotate',
      label: 'Rotate',
      kind: 'action'
    },

    {
      id: 'delete',
      label: 'Delete',
      destructive: true,
      kind: 'action'
    },

    {
      id: 'extract',
      label: 'Extract',
      kind: 'action'
    },

    {
      id: 'comment',
      label: 'Comment',
      kind: 'action'
    },

    {
      id: 'link',
      label: 'Link',
      kind: 'action'
    },

    {
      id: 'more',
      label: 'More',
      kind: 'action'
    }
  ];

  /**
   * Report the clicked tool to the parent.
   *
   * No local active state is maintained here.
   */
  selectTool(
    tool: StudioTool
  ): void {

    this.toolSelected.emit(
      tool.id
    );
  }

  /**
   * Only interaction tools can be shown
   * as the persistent active tool.
   */
  isActive(
    toolId: StudioToolId
  ): boolean {

    const tool =
      this.tools.find(
        item => item.id === toolId
      );

    if (
      !tool ||
      tool.kind !== 'interaction'
    ) {
      return false;
    }

    return (
      this.activeTool === toolId
    );
  }
}