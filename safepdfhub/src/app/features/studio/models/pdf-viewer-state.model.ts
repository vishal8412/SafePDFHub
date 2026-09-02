import { StudioViewMode } from "../state/studio-state.service";
import { StudioSelection } from "./studio-selection.model";

import type {
  StudioToolId
} from './studio-tool.model';

export type PdfViewerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error';

export interface PdfViewerState {
  status: PdfViewerStatus;
  currentPage: number;
  pageCount: number;
  zoom: number;
  viewMode: StudioViewMode;
  activeTool: StudioToolId;

  selectedObjectId: string | null;
  selection: StudioSelection | null;

  error: string | null;
}