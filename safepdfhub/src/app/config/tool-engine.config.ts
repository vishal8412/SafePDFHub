import { Type } from '@angular/core';
import { CompressWorkspaceComponent } from '../features/tools/compress/compress-workspace/compress-workspace.component';
import { MergeWorkspaceComponent } from '../features/tools/merge/merge-workspace/merge-workspace.component';


// ========================================
// TOOL ENGINE INTERFACE
// ========================================

export interface ToolEngineConfig {

  slug: string;

  // workspace component
  workspaceComponent: Type<any>;

  // engine key
  engine: string;

  // capabilities
  supportsPreview?: boolean;

  supportsBatch?: boolean;

  supportsRealtimeAnalysis?: boolean;

  supportsPageOperations?: boolean;

  supportsDownload?: boolean;
}


// ========================================
// TOOL ENGINE CONFIGS
// ========================================

export const TOOL_ENGINES: ToolEngineConfig[] = [

  // ========================================
  // MERGE PDF
  // ========================================

  {
    slug: 'merge-pdf',

    workspaceComponent: MergeWorkspaceComponent,

    engine: 'merge-engine',

    supportsPreview: true,

    supportsBatch: true,

    supportsRealtimeAnalysis: false,

    supportsPageOperations: true,

    supportsDownload: true
  },



  // ========================================
  // COMPRESS PDF
  // ========================================

  {
    slug: 'compress-pdf',

    workspaceComponent: CompressWorkspaceComponent,

    engine: 'compress-engine',

    supportsPreview: true,

    supportsBatch: false,

    supportsRealtimeAnalysis: true,

    supportsPageOperations: false,

    supportsDownload: true
  }

];