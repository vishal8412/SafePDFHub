import {Component, OnInit, ChangeDetectorRef, OnDestroy, Inject, PLATFORM_ID, ViewChild, ElementRef, HostListener} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { TOOLS, Tool } from '../../config/tools.config';
import { LoaderService } from '../../shared/services/loader.service';
import { ToastService } from '../../shared/services/toast.service';
import { MergeEngine } from '../../core/engines/merge.engine';
import { CompressEngine } from '../../core/engines/compress.engine';
import { WorkflowService } from '../../core/services/workflow.service';
import { PreviewService } from '../../core/services/preview.service';
import { DialogComponent } from '../../shared/components/dialog/dialog.component';
import { BottomSheetComponent } from '../../shared/components/bottom-sheet/bottom-sheet.component';
import { ActionPanelComponent } from '../../shared/components/action-panel/action-panel.component';
import { AppIcons } from '../../shared/icons';
import { CompressWorkspaceComponent } from '../../features/tools/compress/compress-workspace/compress-workspace.component';
import { MergeWorkspaceComponent } from '../../features/tools/merge/merge-workspace/merge-workspace.component';
import { SplitRequest, SplitWorkspaceComponent } from '../../features/tools/split/split-workspace/split-workspace.component';
import { WorkspaceStateService } from '../../core/services/workspace-state.service';
import { WorkspaceOperationsService } from '../../core/services/workspace-operations.service';
import { NgZone } from '@angular/core';
import { TOOL_BEHAVIORS, ToolBehavior } from '../../config/tool-behavior.config';
import { SplitEngine } from '../../core/engines/split.engine';
import { SplitGroup } from '../../core/split/split.types';
import { SplitExportService } from '../../core/split/split-export.service';
import { SplitZipService } from '../../core/split/split-zip.service';

type WorkflowStep = 'merge' | 'compress' | 'split';

@Component({
  selector: 'app-tool',
  standalone: true,
  imports: [CommonModule, MergeWorkspaceComponent, CompressWorkspaceComponent, SplitWorkspaceComponent, DialogComponent, BottomSheetComponent, ActionPanelComponent],
  templateUrl: './tool.component.html',
  styleUrls: ['./tool.component.scss']
})

export class ToolComponent implements OnInit, OnDestroy {

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild(MergeWorkspaceComponent) mergeWorkspace!: MergeWorkspaceComponent;

  tool!: Tool;
  behavior!: ToolBehavior;
  recommendedTools: Tool[] = [];
  suggestions: { label: string; action: () => void }[] = [];
  suggestionTitle = 'Suggested for you';
  workflowSteps: WorkflowStep[] = [];

  showClearDialog = false;
  showFileSheet = false;
  selectedFileIndex = -1;

  MAX_FILE_MB = 50;
  MAX_TOTAL_MB = 200;

  showViewer = false;
  viewerPages: string[] = [];
  viewerLoading = false;
  zoom = 1;
  
  viewerFile: File | null = null;

  // Compress PDF
  compressionLevel: 'light' | 'recommended' | 'strong' = 'recommended';
  estimatedReduction = 0;
  estimatedFinalSize = 0;
  analyzedPdfType: 'text' | 'scanned' | 'mixed' | null = null;
  pdfInsights: any = null;
  compressing = false;
  compressionProgress = 0;
  showCompressResult = false;
  compressedFile: File | null = null;
  compressOriginalSize = 0;
  compressFinalSize = 0;
  compressReduction = 0;
  compressDuration = '';

  private analysisRequestId = 0;
  private lastPositions = new Map<number, DOMRect>();
  private isBrowser = false;

  // Split PDF
  splitResultFiles = 0;
  splitResultMode = '';
  splitResultDuration = '';
  showSplitResult = false;
  generatedSplitFiles: File[] = [];

  lastZipBlob: Blob | null = null;
  lastZipName = '';

  compressionStage:
  | 'idle'
  | 'analysis'
  | 'optimization'
  | 'rebuild'
  | 'finalizing'
  | 'complete'
  = 'idle';
  
  get isWorkspaceMode(): boolean { return this.workspace.files.length > 0; }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private title: Title,
    private meta: Meta,
    private cd: ChangeDetectorRef,
    private loader: LoaderService,
    private toast: ToastService,
    private mergeEngine: MergeEngine,
    private compressEngine: CompressEngine,
    private splitEngine: SplitEngine,
    private splitExportService: SplitExportService,
    private splitZipService: SplitZipService,
    private workflowService: WorkflowService,
    private previewService: PreviewService,
    public workspace: WorkspaceStateService,
    private workspaceOps: WorkspaceOperationsService,
    private ngZone: NgZone,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

ngOnInit() {
  this.isBrowser = isPlatformBrowser(this.platformId);
  this.workspaceUploadFileCapacity();
  this.route.paramMap.subscribe(params => {
    const slug = params.get('slug');
    const match = TOOLS.find(t => t.slug === slug);
    if (!match) {
      this.router.navigate(['/']);
      return;
    }

    // READ NAVIGATION STATE
    const navigation = this.isBrowser? window.history.state: {};
    const filesFromState = navigation?.files;
    const autoAction = navigation?.autoAction;
    const shouldPreserve = Array.isArray(filesFromState) && filesFromState.length > 0;

    // ALWAYS RESET FIRST
    this.resetWorkspaceState();

    // SET TOOL
    this.tool = match;
    this.behavior = TOOL_BEHAVIORS.find(b => b.slug === this.tool.slug)!;
    
    this.setRecommendations();
  
    this.title.setTitle(this.tool.title);
    this.meta.updateTag({
      name: 'description',
      content: this.tool.description
    });

    // RESTORE FILES IF PROVIDED
    if (shouldPreserve) {
      this.onFileSelect({
        target: {
          files: filesFromState
        }
      });
      if (autoAction === 'compress') {
        setTimeout(() => {
          this.compressPdf();
        }, 300);
      }
      if (autoAction === 'merge') {
        setTimeout(() => {
          this.mergePdf();
        }, 300);
      }
    }
  });
}

get isMergeTool(): boolean {
  return this.tool?.slug === 'merge-pdf';
}

get isSplitTool(): boolean {
  return this.tool?.slug === 'split-pdf';
}

private resetWorkspaceState() {

  // cleanup previews
  this.workspace.previews.forEach(p => {

    if (p) {
      URL.revokeObjectURL(p);
    }

  });

  // cleanup merged file
  if (this.workspace.lastMergedUrl) {

    URL.revokeObjectURL(
      this.workspace.lastMergedUrl
    );

  }

  // clear workspace
  this.workspaceOps.clear();

  // reset ui state
  this.workspace.activeIndex = -1;

  this.workspace.hasMerged = false;

  this.workspace.lastMergedUrl = null;

  this.workspace.dragIndex = null;

  this.workspace.hoverIndex = null;

  this.workspace.isDragging = false;

  // viewer reset
  this.viewerPages = [];

  this.viewerFile = null;

  this.showViewer = false;

}

workspaceUploadFileCapacity() {
  if (!this.isBrowser) return;
  const width = window.innerWidth;
  if (width < 768) {
    this.MAX_FILE_MB = 40;
    this.MAX_TOTAL_MB = 120;
  } else if (width < 1024) {
    this.MAX_FILE_MB = 80;
    this.MAX_TOTAL_MB = 250;
  } else {
    this.MAX_FILE_MB = 100;
    this.MAX_TOTAL_MB = 400;
  }
}

  private setRecommendations() {
    if (!this.tool?.nextTools) return;
    this.recommendedTools = TOOLS.filter(t =>
      this.tool.nextTools?.includes(t.slug)
    );
  }

goToTool(
  slug: string,
  autoAction?: string,
  preserveFiles = false
) {

  const navigationState =
    preserveFiles
      ? {
          files: this.workspace.files,
          autoAction
        }
      : undefined;

  this.router.navigate(
    ['/tool', slug],
    {
      state: navigationState
    }
  );

}

  private updateWorkflow() {
    this.workflowSteps = this.workflowService.detectWorkflow(
      this.workspace.files,
      this.workspace.pageCounts
    );
  }

  buildWorkflowLabel(steps: WorkflowStep[]) {
    return steps
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' + ');
  }

  async runWorkflow() {
    if (!this.workspace.files.length || this.workspace.loading) return;
    setTimeout(() => {
      this.loader.show();
      this.loader.setText('Optimizing PDF...');
    });
    this.loader.setProgress?.(0);
    this.workspace.loading = true;
    try {
      const result = await this.workflowService.runWorkflow(
        this.workspace.files,
        this.workspace.pageCounts,
        (p, step) => {
          this.loader.setProgress?.(p);
          this.loader.setText(`${step.toUpperCase()}...`);
        }
      );
      this.downloadFile(result);

      // 🔥 FIX memory leak
      if (this.workspace.lastMergedUrl) {
        URL.revokeObjectURL(this.workspace.lastMergedUrl);
      }

      this.workspace.lastMergedUrl = URL.createObjectURL(result);
      const mergedId = crypto.randomUUID();
      this.workspaceOps.replaceAll([
        {
          id: mergedId,
          file: result,
          preview: '',
          pageCount: 0,
          previewLoading: true,
          previewProgress: 0,
          previewError: false,
          previewQueued: false
        }
      ]);

      await this.generatePreview(
        result,
        mergedId
      );

      this.workspace.hasMerged = true;

      this.loader.setText('Done ✨');

      setTimeout(() => {
        this.loader.hide();
        this.toast.show('Workflow completed', 'success');
      }, 400);

    } catch (e) {
      console.error(e);
      this.loader.hide();
      this.toast.show('Workflow failed', 'error');
    } finally {
      this.workspace.loading = false;
      this.cd.markForCheck();
    }
  }

  private downloadFile(file: File) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  // =====================
  // FILE INPUT
  // =====================
  onFileSelect(event: any) {
    if (this.behavior.replaceOnUpload) {
     this.workspaceOps.clear();
     this.workspace.activeIndex = -1;
    }
    const selected = this.validateFiles(
      Array.from(event.target.files || []) as File[]
    );
    if (!selected.length) return;
    if (this.workspace.files.length && this.workspace.activeIndex === -1) {
      this.workspace.activeIndex = 0;
    }


    const startIndex = this.workspace.files.length;
    this.toast.show(`${event.target.files.length} files added`, 'success');

    // 🔥 extend arrays (IMPORTANT)
    const items = selected.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: '',
      pageCount: 0,
      previewLoading: false,
      previewProgress: 0,
      previewError: false,
      previewQueued: false
    }));
    this.workspaceOps.addFiles(items);
    this.updateWorkflow();

// 🔥 generate preview only for new files
const immediatePreviewCount = 5;

const end =
  Math.min(
    startIndex + immediatePreviewCount,
    this.workspace.workspaceFiles.length
  );

for (let i = startIndex; i < end; i++) {

  const item =
    this.workspace.workspaceFiles[i];

  this.queuePreview(
    item.file,
    item.id
  );
}

    this.generateSuggestions();

    if (this.isCompressTool) {
      Promise.resolve().then(() => {
        this.analyzeCompression();
      });
    }
    
    const isFirstUpload = startIndex === 0;
    if (isFirstUpload) {
    // FIRST upload
    this.workspace.activeIndex = 0;
    } else {
    // ADD MORE files
    const latestIndex = this.workspace.files.length - 1;
    this.workspace.activeIndex = latestIndex;
    this.cd.detectChanges();
    const sub = this.ngZone.onStable.subscribe(() => { 
      setTimeout(() => {
        this.mergeWorkspace?.scrollToIndex(latestIndex);
        sub.unsubscribe();
    }, 0);
    });
    }
    event.target.value = '';
  }

  onDropFiles(event: DragEvent) {
    event.preventDefault();
    if (this.behavior.replaceOnUpload) {
     this.workspaceOps.clear();
     this.workspace.activeIndex = -1;
    }
    const dropped = this.validateFiles(
      Array.from(event.dataTransfer?.files || []) as File[]
    );
    if (!dropped.length) return;
    if (this.workspace.files.length && this.workspace.activeIndex === -1) {
      this.workspace.activeIndex = 0;
    }
    const startIndex = this.workspace.files.length;
    const items = dropped.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: '',
      pageCount: 0,
      previewLoading: false,
      previewProgress: 0,
      previewError: false,
      previewQueued: false
    }));
    this.workspaceOps.addFiles(items);
    this.updateWorkflow();

// 🔥 generate preview only for new files
const immediatePreviewCount = 5;

const end =
  Math.min(
    startIndex + immediatePreviewCount,
    this.workspace.workspaceFiles.length
  );

for (let i = startIndex; i < end; i++) {

  const item =
    this.workspace.workspaceFiles[i];

  this.queuePreview(
    item.file,
    item.id
  );
}

    this.generateSuggestions();

    if (this.isCompressTool) {
      Promise.resolve().then(() => {
        this.analyzeCompression();
      });
    }
    
    const isFirstUpload = startIndex === 0;
    if (isFirstUpload) {
    // FIRST upload
    this.workspace.activeIndex = 0;
    } else {
    // ADD MORE files
    const latestIndex = this.workspace.files.length - 1;
    this.workspace.activeIndex = latestIndex;
    this.cd.detectChanges();
    const sub =
    this.ngZone.onStable.subscribe(() => {
      setTimeout(() => {
      this.mergeWorkspace?.scrollToIndex(latestIndex);
      sub.unsubscribe();
      }, 0);
    });
    }

  }

  allowDrop(event: DragEvent) {
    event.preventDefault();
  }

  addMoreFiles() {
    this.fileInput?.nativeElement.click();
  }

  private previewQueue: Promise<void> = Promise.resolve();

  private queuePreview(
  file: File,
  id: string
) {

  const item =
    this.workspace.workspaceFiles
      .find(x => x.id === id);

  if (!item) return;

  // already queued
  if (item.previewQueued) return;

  // already generated
  if (item.preview) return;

  item.previewQueued = true;

  this.previewQueue =
    this.previewQueue
      .then(() =>
        this.generatePreview(file, id)
      )
      .finally(() => {
        item.previewQueued = false;
      });

}

  // =====================
  //     VALIDATIONS
  // =====================
  private validateFiles(newFiles: File[]): File[] {
    const valid: File[] = [];
    let currentTotalMB = this.workspace.files.reduce((a, f) => a + f.size, 0) / (1024 * 1024);
    for (const file of newFiles) {
      // ❌ type check
      if (file.type !== 'application/pdf') {
        this.toast.show('Only PDF files are allowed', 'error');
        continue;
      }

      const fileMB = file.size / (1024 * 1024);

      // ❌ per file size
      // if (fileMB > this.MAX_FILE_MB) {
      //   this.toast.show(
      //     `${file.name} exceeds ${this.MAX_FILE_MB} MB limit`,
      //     'error'
      //   );
      //   continue;
      // }

      // // ❌ total size
      // if (currentTotalMB + fileMB > this.MAX_TOTAL_MB) {
      //   this.toast.show(
      //     `Total size cannot exceed ${this.MAX_TOTAL_MB} MB`,
      //     'error'
      //   );
      //   break;
      // }

      // ❌ duplicate
      const isDuplicate = this.workspace.files.some(
        f => f.name === file.name && f.size === file.size
      );

      if (isDuplicate) {
        this.toast.show(`${file.name} already added`, 'info');
        continue;
      }

      valid.push(file);
      currentTotalMB += fileMB;
    }

    return valid;
  }

 // =====================
 // UPLOAD
 // =====================  
  triggerUpload() {
   this.fileInput?.nativeElement?.click();
  }

 // =====================
 // SPLIT PDF
 // ===================== 
 async splitPdf(request: SplitRequest) {
  const startedAt = performance.now(); 
  const totalPages = this.workspace.pageCounts[0];
  let groups: SplitGroup[] = [];
  switch (request.mode) {
    case 'range': groups = this.splitEngine.splitByRanges(request.ranges!);
      break;
    case 'every-page': groups = this.splitEngine.splitEveryPage(totalPages);
      break;
    case 'every-n': groups = this.splitEngine.splitEveryN(totalPages,request.everyN!);
      break;
    case 'extract': groups = this.splitEngine.extractPages(request.pages!);
      break;
  }
  
  const MAX_OUTPUT_FILES = 100000;
  
  if (groups.length > MAX_OUTPUT_FILES) {
    this.toast.show(
      `Maximum ${MAX_OUTPUT_FILES} output PDFs allowed.`,
      'error'
    );
   return;
  }

  if (request.mode === 'every-page' && totalPages > 10000) {
     this.toast.show(
      'Every Page mode supports maximum 250 pages.',
      'error'
     );
   return;
  }
  
  try {
   this.loader.show();
   this.loader.setText('Splitting PDF...');
  //  this.loader.setText(`Generating PDF ${i + 1}/${groups.length}`);

   const output = await this.splitExportService.export(
    this.workspace.files[0], 
    groups, 
    p => {
      this.loader.setProgress?.(p);
      this.loader.setText(`Generating PDFs ${p}%`);
    });

   this.loader.setText('Creating ZIP...');

   const zipBlob = await this.splitZipService.createZip(output.files);
   const originalFileName = this.workspace.files[0].name;
   const baseName = originalFileName.replace(/\.pdf$/i, '');
  //  this.splitZipService.downloadZip(zipBlob,`${baseName}_split.zip`);
   this.lastZipBlob = zipBlob;
   this.lastZipName = `${baseName}_split.zip`;

  //  this.generatedSplitFiles = output.files;
   this.splitResultFiles = output.files.length;
   this.splitResultMode = request.mode;
   const duration = ((performance.now() - startedAt) / 1000).toFixed(1);
   this.splitResultDuration = `${duration}s`;
  
   await this.ngZone.run(async () => {
    this.generatedSplitFiles = [...output.files];
    this.splitResultFiles = output.files.length;
    this.splitResultMode = request.mode;
    this.splitResultDuration = `${duration}s`;
    this.showSplitResult = true;
    this.cd.markForCheck();
    this.cd.detectChanges();
    await new Promise(r => requestAnimationFrame(r));
   });

   window.scrollTo({
    top:0
   });

   await new Promise(r => setTimeout(r,150));
   this.splitZipService.downloadZip(zipBlob,`${baseName}_split.zip`);
   this.loader.hide();
  
   requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
  
   this.toast.show(
    `${output.files.length} PDFs created`,
    'success'
   );

  //  this.loader.hide();

  } catch(error) {
   this.loader.hide();
   this.toast.show('Split failed','error');
  } finally {
   this.loader.hide();
  }

 }

 downloadZipAgain() {
  if (!this.lastZipBlob) {
    return;
  }
  this.splitZipService.downloadZip(this.lastZipBlob,this.lastZipName);
}

handleContinueTool(tool:string){
 switch(tool){
   case 'compress': this.goToTool('compress-pdf');
   break;
   case 'merge': this.goToTool('merge-pdf');
   break;
   case 'protect': this.goToTool('protect-pdf');
   break;
 }
}

 resetSplitWorkspace() {
  this.showSplitResult = false;
  this.generatedSplitFiles = [];
  this.splitResultFiles = 0;
  this.splitResultMode = '';
  this.splitResultDuration = '';
  this.workspaceOps.clear();
  this.workspace.activeIndex = -1;
}

splitPdfUpload() {
 this.resetSplitWorkspace();
 this.cd.detectChanges();
 setTimeout(() => {
   this.fileInput?.nativeElement?.click();
 },100);
}

  // =====================
  // SUGGESTIONS          
  // =====================

  get quickActions() {
  return [

    {
      id: 'merge',
      icon: '📄',
      title: 'Merge PDFs',
      desc: 'Combine multiple PDFs into one',
      active: this.isMergeTool
    },

    {
      id: 'compress',
      icon: '⚡',
      title: 'Compress',
      desc: 'Reduce file size',
      active: this.isCompressTool
    },

    {
      id: 'split',
      icon: '✂️',
      title: 'Split',
      desc: 'Extract pages',
      active: this.isSplitTool
    },

    {
      id: 'convert',
      icon: '📄➡️📝',
      title: 'Convert',
      desc: 'PDF to Word',
      active: false
    }
  ];
}

trustItems = [
  '🔒 100% Private',
  '⚡ Instant Processing',
  '☁️ No Upload'
];

handleQuickAction(action: string) {

  switch (action) {

    case 'merge':
      this.triggerUpload();
      break;

    case 'compress':
      this.goToTool('compress-pdf', 'compress', true);
      break;

    case 'split':
      this.goToTool('split-pdf');
      break;

    case 'convert':
      this.goToTool('pdf-to-word');
      break;
  }

}

  // =====================
  // PREVIEW
  // =====================
 private async generatePreview(file: File, id: string) {
    const item = this.workspace.workspaceFiles.find(x => x.id === id);
    if (!item) return;
    if (!this.isBrowser) return;
    try {
      item.previewLoading = true;
      item.previewError = false;
      item.previewProgress = 0;
      await new Promise(r =>requestAnimationFrame(r));
      const result = await this.previewService.generatePreview(file,
          (p) => {
            item.previewProgress = p;
            if (p === 100 || p % 25 === 0) {
              requestAnimationFrame(() =>
                this.cd.markForCheck()
              );
            }
          }
        );

      // cleanup old blob
      if (item.preview) {
        URL.revokeObjectURL(item.preview);
      }

      // ✅ FIXED
      item.preview = result.preview;
      item.pageCount = result.pages;
      item.previewLoading = false;
      item.previewProgress = 100;
      this.updateWorkflow();
    } catch (e) {
      console.error(e);
      item.previewError = true;
      item.previewLoading = false;
      this.toast.show(
        'Preview failed',
        'error'
      );
    }

    this.cd.markForCheck();
  }

  retryPreview(i: number) {
    const item = this.workspace.workspaceFiles[i];
    item.previewError = false;
    item.previewLoading = true;
    item.previewProgress = 0;
    this.generatePreview(
      item.file,
      item.id
    );
  }

  // =====================
  // ACTIVE CARD
  // =====================
  setActive(i: number) {
    this.workspace.activeIndex = i;
    // this.scrollToIndex(i);
  }

  @HostListener('window:keydown', ['$event'])
  handleKey(e: KeyboardEvent) {
    if (!this.workspace.files.length) return;
    if (e.key === 'ArrowRight') {
      this.setActive(Math.min(this.workspace.files.length - 1, this.workspace.activeIndex + 1));
    }
    if (e.key === 'ArrowLeft') {
      this.setActive(Math.max(0, this.workspace.activeIndex - 1));
    }
    // if (e.key === ' ') {
    //   e.preventDefault();
    //   if (this.workspace.activeIndex >= 0) {
    //     this.preview(this.workspace.files[this.workspace.activeIndex], this.workspace.activeIndex);
    //   }
    // }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.workspace.activeIndex >= 0) {
        this.preview(this.workspace.files[this.workspace.activeIndex], this.workspace.activeIndex);
      }
    }
  }

  // =====================
  // DRAG
  // =====================
  onDragStart(i: number) {
    this.workspace.dragIndex = i;
    this.workspace.isDragging = true;
  }

  onDragOver(e: DragEvent, i?: number) {
    e.preventDefault();
    this.workspace.hoverIndex = i ?? null;
  }

  onDropReorder(from: number, to: number) {
    if (from === to) return;
    this.capturePositions();
    this.workspaceOps.reorder(from, to);
    this.resetDrag();
    setTimeout(() => {
      this.animateReorder();
    }, 0);
  }

  onWorkspaceHover(i: number) {
    this.workspace.hoverIndex = i;
  }
  resetDrag() {
    this.workspace.dragIndex = null;
    this.workspace.isDragging = false;
    this.workspace.hoverIndex = null;
  }

  // =====================
  // REMOVE FILE
  // =====================  
  removeFile(i: number) {
    const removedFile = this.workspace.workspaceFiles[i];
    if (removedFile?.preview) {
      URL.revokeObjectURL(
        removedFile.preview
      );
    }

    this.workspaceOps.removeFile(i);

    this.toast.show('File removed','info',4000,
      {actions: [{
            label: 'Undo',
            action: () => {this.workspaceOps.restoreFile(i,removedFile);}
          }]
      });
  }

  private capturePositions() {
    this.lastPositions.clear();
    document.querySelectorAll('.file-card').forEach((el, i) => this.lastPositions.set(i, el.getBoundingClientRect()));
  }

  private animateReorder() {
    document.querySelectorAll('.file-card').forEach((el, i) => {
      const old = this.lastPositions.get(i);
      if (!old) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (dx || dy) {
        const e = el as HTMLElement;
        e.style.transition = 'none';
        e.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          e.style.transition = 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)';
          e.style.transform = '';
        });
      }
    });
  }

  // =====================
  // VIEWER
  // =====================
async preview(file: File, index: number) {
  this.workspace.activeIndex = index;
  this.viewerFile = file;
  if (!this.isBrowser) return;
  this.showViewer = true;
  this.viewerLoading = true;

  // 🔥 STEP 1: show existing preview instantly (blurred)
  const quickPreview = this.workspace.previews[index];

  if (quickPreview) {
    this.viewerPages = [quickPreview];
  } else {
    this.viewerPages = [];
  }

  try {
    // 🔥 STEP 2: generate real pages (sharp)
    const pages = await this.previewService.generateViewerPages(file);

    // 🔥 STEP 3: smooth replace (delay = visual polish)
    setTimeout(() => {

  const oldPages =
    this.viewerPages.filter(
      p => !this.workspace.previews.includes(p)
    );

  this.viewerLoading = false;

  this.viewerPages = pages;

  requestIdleCallback(() => {

    this.previewService.cleanupUrls(oldPages);

  });

  this.cd.markForCheck();

}, 300);

  } catch (e) {
    console.error(e);
    this.viewerLoading = false;
    this.toast.show('Preview failed', 'error');
  }
}

private safeCleanup(callback: () => void) {

  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(callback);
  } else {
    setTimeout(callback, 200);
  }

}

closeViewer() {

  const oldPages =
    this.viewerPages.filter(
      p => !this.workspace.previews.includes(p)
    );

  this.showViewer = false;
  this.viewerLoading = false;
  this.viewerFile = null;
  this.viewerPages = [];

  this.cd.detectChanges();

  setTimeout(() => {

    this.safeCleanup(() => {

      this.previewService.cleanupUrls(oldPages);

    });

  }, 0);

}

  zoomIn() { this.zoom += 0.2; }
  zoomOut() { if (this.zoom > 0.4) this.zoom -= 0.2; }

  openFullPdf() {

  if (!this.viewerFile) return;

  const url =
    URL.createObjectURL(
      this.viewerFile
    );

  window.open(
    url,
    '_blank'
  );

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60000);

}

  onVisiblePreview(index: number) {
    const item = this.workspace.workspaceFiles[index];
    if (!item) return;
    // already generated
    if (item.preview) {
     return;
    }
    // already loading
    if (item.previewLoading) {
     return;
    }
    this.queuePreview(item.file,item.id);
  }

  // =====================
  // MERGE
  // =====================
  async mergePdf() {
    if (this.workspace.loading) return;
    if (this.workspace.files.length < 2) {
      this.toast.show('Please add at least 2 PDFs to merge', 'error');
      return;
    }
    this.workspace.loading = true;
    this.toast.show('Merging started...', 'info');
    this.loader.show();
    this.loader.setText('Merging PDFs...');
    try {
      const result = await this.mergeEngine.merge(
        this.workspace.files,
        (p) => this.loader.setProgress?.(p)
      );

      this.downloadFile(result);
      const mergedId = crypto.randomUUID();
      this.workspaceOps.replaceAll([
        {
          id: mergedId,
          file: result,
          preview: '',
          pageCount: 0,
          previewLoading: true,
          previewProgress: 0,
          previewError: false,
          previewQueued: false
        }
      ]);
      await this.generatePreview(result,mergedId);
      console.log('Compressed Result Size:',result.size);

      this.workspace.hasMerged = true;
      this.workspace.lastMergedUrl = URL.createObjectURL(result);
      this.loader.setText('Done ✨');
      setTimeout(() => {
        this.loader.hide();
        this.toast.show('Merged successfully', 'success');
      }, 400);
    } catch (e) {
      console.error(e);
      this.loader.setText('Merge failed...');
      setTimeout(() => this.loader.hide(), 500);
      this.toast.show('Merge failed', 'error');
    } finally {
      this.workspace.loading = false;
      this.cd.markForCheck();
    }
  }

  async compressPdf() {
    if (!this.workspace.files.length) {
      this.toast.show('Please add a PDF first', 'error');
      return;
    }
    setTimeout(() => {
      this.loader.show();
      this.loader.setText('Optimizing PDF...');
    });
    this.workspace.loading = true;
    this.compressing = true;
    this.compressionProgress = 0;
    const startedAt = performance.now();
    try {
      this.compressionStage = 'analysis';
      const result = await this.compressEngine.compress(this.workspace.files[0],this.compressionLevel,
       (p) => {
        this.compressionProgress = p;
        this.cd.markForCheck();
       });

      this.compressedFile = result;
      this.compressOriginalSize = this.workspace.files[0].size;
      this.compressFinalSize = result.size;
      this.compressReduction = Math.max(0, Math.round(((this.compressOriginalSize - this.compressFinalSize) / this.compressOriginalSize) * 100));
      this.compressDuration = ((performance.now() - startedAt)/ 1000).toFixed(1) + 's';

      console.log('Result Size:',result.size);

      const originalSize = this.workspace.files[0].size;
      const compressedSize = result.size;
      this.estimatedFinalSize = compressedSize / 1024 / 1024;
      this.estimatedReduction = Math.max(0,Math.round(((originalSize - compressedSize) / originalSize) * 100));
      this.downloadFile(result);
      const mergedId = crypto.randomUUID();
      // setTimeout(async () => {
        this.workspaceOps.replaceAll([
          {
            id: mergedId,
            file: result,
            preview: '',
            pageCount: 0,
            previewLoading: true,
            previewProgress: 0,
            previewError: false,
            previewQueued: false
          }
        ]);

        await this.generatePreview(result,mergedId);
        this.cd.detectChanges();
      // });

      this.workspace.hasMerged = true;
      this.workspace.lastMergedUrl = URL.createObjectURL(result);
      this.loader.setText('Done ✨');
      setTimeout(() => {
        this.loader.hide();
        this.toast.show('Optimization completed', 'success');
        this.showCompressResult = true;
      }, 400);
    } catch (e) {
      console.error(e);
      this.loader.setText('Optimization failed...');
      setTimeout(() => this.loader.hide(), 500);
      this.toast.show('Optimization failed', 'error');
    } finally {
        this.compressing = false;
        this.compressionProgress = 100;
        setTimeout(() => {
          this.workspace.loading = false;
          this.cd.detectChanges();
        });
     }
  }

  resetAfterMerge() {
    this.workspaceOps.replaceAll([]);
    this.workspace.activeIndex = -1;
    this.workspace.hasMerged = false;
    this.workspace.lastMergedUrl = null;
  }

  // =====================
  // COMPRESS WORKSPACE                   
  // =====================

  get isCompressTool(): boolean {
    return this.tool?.slug === 'compress-pdf';
  }

 async analyzeCompression() {
  if (!this.workspace.files.length) {
    return;
  }
  
  const requestId = ++this.analysisRequestId;
  const file = this.workspace.files[0];
  const sizeMB = file.size / 1024 / 1024;
  const result = await this.compressEngine.analyzeFile(file);
  if (requestId !== this.analysisRequestId) {
    return;
  }
  this.analyzedPdfType = result.type;
  this.pdfInsights = result.analysis;
  const pages = result.pages;
  let reduction = 0;
  const imageRatio = result.analysis.imageRatio;
  const dpi = result.analysis.estimatedDpi;
  reduction = imageRatio * 50;
  if (dpi > 250) {
    reduction += 15;
  }
  if (result.analysis.largePages) {
    reduction += 10;
  }
  switch (this.compressionLevel) {
    case 'light':
      reduction *= 0.6;
      break;
    case 'recommended':
      reduction *= 1;
      break;
    case 'strong':
      reduction *= 1.4;
      break;
  }

  reduction = Math.min(Math.round(reduction),80);

  // very huge PDFs
  if (pages > 1000) {
    reduction = Math.min(reduction, 10);
  }

  this.ngZone.run(() => {
  this.estimatedReduction = reduction;
    this.estimatedFinalSize = sizeMB * (1 - reduction / 100);
    this.cd.markForCheck();
  });

}

  getTotalSize(): string {
    return (this.workspace.files.reduce((a, f) => a + f.size, 0) /(1024 * 1024)).toFixed(2) + ' MB';
  }

  // SMART SUGGESTIONS BASED ON FILES
  private generateSuggestions() {
    const totalSizeMB = this.workspace.files.reduce((a, f) => a + f.size, 0) / (1024 * 1024);
    const maxPages = Math.max(...this.workspace.pageCounts.filter(Boolean), 0);
    const suggestions: any[] = [];

    // reset title
    this.suggestionTitle = 'Suggested for you';

    // 🔥 PRIORITY SYSTEM (lower = stronger)
    if (maxPages > 300) {
      this.suggestionTitle = 'This file is very large';
      suggestions.push({
        label: 'Split large document',
        action: () => this.goToTool('split-pdf'),
        priority: 0
      });
    }

    if (totalSizeMB > 20) {
      this.suggestionTitle = 'Your file is large';
      suggestions.push({
        label: 'Compress to reduce size',
        action: () => this.goToTool('compress-pdf', 'compress', true),
        priority: 1
      });
    }

    if (this.workspace.files.length > 1) {
      suggestions.push({
        label: 'Merge all files',
        action: () => this.mergePdf(),
        priority: 2
      });
    }

    if (this.workspace.files.length === 1) {
      suggestions.push({
        label: 'Convert to Word',
        action: () => this.goToTool('pdf-to-word'),
        priority: 3
      });
    }

    // ✅ SORT + LIMIT (VERY IMPORTANT)
    this.suggestions = suggestions
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 3);
  }

  // =====================================
  // Mobile Side Bar (reorder + remove)
  // ======================================
  moveLeft(index: number) {
    if (index === 0) return;
    this.workspaceOps.reorder(index, index - 1);
  }

  moveRight(index: number) {
    if (index >= this.workspace.files.length - 1) return;
    this.workspaceOps.reorder(index, index + 1);
  }

  clearAll() {
    this.showClearDialog = true;
  }

  confirmClearAll() {
    this.workspace.previews.forEach(p => p && URL.revokeObjectURL(p));
    this.workspaceOps.clear();
    this.showClearDialog = false;
    this.toast.show(
      'All files removed',
      'info'
    );
  }

  //====================================
  // BOTTOM SHEET FILE ACTIONS (mobile)
  // =====================================  
  
  openFileActions(i: number) {
    this.selectedFileIndex = i;
    this.showFileSheet = true;
  }

  get fileActions() {
    const i = this.selectedFileIndex;
    return [
      {
        label: 'Preview',
        icon: AppIcons.Eye,
        action: () => this.preview(this.workspace.files[i], i)
      },
      {
        label: 'Compress',
        icon: AppIcons.Zap,
        action: () =>
          this.goToTool(
            'compress-pdf',
            'compress',
            true
          )
      },
      {
        label: 'Split',
        icon: AppIcons.Scissors,
        action: () => this.goToTool('split-pdf')
      },
      {
        label: 'Remove',
        icon: AppIcons.Trash2,
        danger: true,
        action: () => this.removeFile(i)
      }
    ];
  }

  ngOnDestroy() {
    if (this.workspace.lastMergedUrl) {
      URL.revokeObjectURL(this.workspace.lastMergedUrl);
    }
    this.workspace.previews.forEach(p => {
      if (p) URL.revokeObjectURL(p);
    });
  }

}