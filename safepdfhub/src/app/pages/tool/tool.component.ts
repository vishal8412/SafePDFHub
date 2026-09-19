import { Component, OnInit, ChangeDetectorRef, OnDestroy, Inject, PLATFORM_ID, ViewChild, ElementRef, HostListener } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { TOOLS, Tool } from '../../config/tools.config';
import { LoaderService } from '../../shared/services/loader.service';
import { ToastService } from '../../shared/services/toast.service';
import { QpdfProductionMergeRouterService } from '../../core/qpdf/qpdf-production-merge-router.service';
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
import { CompressionState } from '../../core/compression/compression.state';
import { CompressionFacade } from '../../core/compression/compress.facade';
import { WorkspaceOutputService } from '../../core/workflow/workspace-output.service';
import { WorkspaceUploadService } from '../../core/workflow/workspace-upload.service';
import { PdfFileTransferService } from '../../core/services/pdf-file-transfer.service';
import { LocalProcessingCapabilityService } from '../../core/capacity/local-processing-capability.service';
import { PdfValidationService } from '../../core/capacity/pdf-validation.service';
import type { PdfEncryptionHint } from '../../core/capacity/pdf-validation.service';
import { PdfWorkloadAnalyzerService } from '../../core/capacity/pdf-workload-analyzer.service';
import { LocalProcessingCapability, WorkloadAssessment } from '../../core/capacity/local-processing-capability.model';
import { SecurityWorkspaceComponent } from '../../features/tools/security/security-workspace/security-workspace.component';
import { PdfSecurityService } from '../../core/security/pdf-security.service';
import { LargePdfSecurityCapabilityService } from '../../core/security/large-file/large-pdf-security-capability.service';
import type { PdfSecurityMode, PdfSecurityRequest, PdfSecurityResult } from '../../core/security/pdf-security.types';

type WorkflowStep = 'merge' | 'compress' | 'split';

@Component({
  selector: 'app-tool',
  standalone: true,
  imports: [CommonModule, MergeWorkspaceComponent, CompressWorkspaceComponent, SplitWorkspaceComponent, SecurityWorkspaceComponent,
    DialogComponent, BottomSheetComponent, ActionPanelComponent],
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

  localCapability!: LocalProcessingCapability;
  workloadAssessment!: WorkloadAssessment;

  showViewer = false;
  viewerPages: string[] = [];
  viewerLoading = false;
  zoom = 1;

  viewerFile: File | null = null;

  private unregisterLoaderCancellation: (() => void) | null = null;

  // Compress PDF
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
  securityProgress = 0;
  securityResult: PdfSecurityResult | null = null;
  securityErrorMessage: string | null = null;
  securityEncryptionStatus: PdfEncryptionHint = 'unknown';

  get isWorkspaceMode(): boolean { return this.workspace.files.length > 0; }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private title: Title,
    private meta: Meta,
    private cd: ChangeDetectorRef,
    private loader: LoaderService,
    private toast: ToastService,
    private mergeEngine: QpdfProductionMergeRouterService,
    public compressionState: CompressionState,
    private compressionFacade: CompressionFacade,
    private compressEngine: CompressEngine,
    private splitEngine: SplitEngine,
    private splitExportService: SplitExportService,
    private splitZipService: SplitZipService,
    private workflowService: WorkflowService,
    private previewService: PreviewService,
    private workspaceOutput: WorkspaceOutputService,
    public workspace: WorkspaceStateService,
    private workspaceOps: WorkspaceOperationsService,
    private workspaceUpload: WorkspaceUploadService,
    private pdfFileTransfer: PdfFileTransferService,
    private localProcessingCapability: LocalProcessingCapabilityService,
    private pdfValidation: PdfValidationService,
    private pdfWorkloadAnalyzer: PdfWorkloadAnalyzerService,
    private largePdfSecurityCapability: LargePdfSecurityCapabilityService,
    private pdfSecurity: PdfSecurityService,
    private ngZone: NgZone,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  ngOnInit() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.localCapability = this.localProcessingCapability.current;
    this.workloadAssessment = this.pdfWorkloadAnalyzer.assess([], []);
    this.workspaceUploadFileCapacity();
    this.route.paramMap.subscribe(params => {
      const slug = params.get('slug');
      const match = TOOLS.find(t => t.slug === slug);
      if (!match) {
        this.router.navigate(['/']);
        return;
      }

      // READ NAVIGATION STATE
      const navigation = this.isBrowser ? window.history.state : {};
      const transferId = navigation?.pdfFileTransferId;
      const legacyFilesFromState = navigation?.files;
      const legacyAutoAction = navigation?.autoAction;
      const hasTransfer = typeof transferId === 'string' && transferId.length > 0;
      const hasLegacyFiles = Array.isArray(legacyFilesFromState) && legacyFilesFromState.length > 0;

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

      // RESTORE FILES IF PROVIDED. Large File objects are transferred through
      // PdfFileTransferService rather than Router history state so navigation
      // never attempts to clone/serialize a 100+ MB PDF.
      if (hasTransfer) {
        void this.restoreTransferredFiles(transferId);
      } else if (hasLegacyFiles) {
        // Backward compatibility for an older in-flight navigation. New
        // navigations never use this path.
        void this.restoreTransferredFilesFromLegacyState(legacyFilesFromState, legacyAutoAction);
      }
    });
  }

  get isMergeTool(): boolean {
    return this.tool?.slug === 'merge-pdf';
  }

  get isSplitTool(): boolean {
    return this.tool?.slug === 'split-pdf';
  }

  get isSecurityTool(): boolean {
    return this.tool?.category === 'security';
  }

  get securityMode(): PdfSecurityMode {
    switch (this.tool?.slug) {
      case 'unlock-pdf': return 'unlock';
      case 'remove-password': return 'remove-password';
      default: return 'protect';
    }
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
      URL.revokeObjectURL(this.workspace.lastMergedUrl);
    }
    // clear workspace
    this.workspaceOps.clear();
    this.securityResult = null;
    this.securityErrorMessage = null;
    this.securityProgress = 0;
    this.securityEncryptionStatus = 'unknown';
    // reset ui state
    this.workspace.activeIndex = -1;
    this.workspace.hasMerged = false;
    this.workspace.lastMergedUrl = null;
    this.workspace.dragIndex = null;
    this.workspace.hoverIndex = null;
    this.workspace.isDragging = false;
    this.workloadAssessment = this.pdfWorkloadAnalyzer.assess([], []);
    // viewer reset
    this.viewerPages = [];
    this.viewerFile = null;
    this.showViewer = false;
  }

  workspaceUploadFileCapacity() {
    // Capacity is determined by browser/device capability, not viewport width.
    // The capability service already applies the current engine safety ceiling.
    this.localCapability = this.localProcessingCapability.current;
  }

  get maxFileMB(): number {
    if (this.isSecurityTool && this.largePdfSecurityCapability.supported) return 1024;
    return Math.round(this.localCapability.budget.maxFileBytes / (1024 * 1024));
  }

  get maxTotalMB(): number {
    if (this.isSecurityTool && this.largePdfSecurityCapability.supported) return 1024;
    return Math.round(this.localCapability.budget.maxTotalBytes / (1024 * 1024));
  }

  get maxFiles(): number {
    if (this.isSecurityTool && this.largePdfSecurityCapability.supported) return 1;
    return this.localCapability.budget.maxFiles;
  }

  get maxPages(): number {
    if (this.isSecurityTool && this.largePdfSecurityCapability.supported) return Number.MAX_SAFE_INTEGER;
    return this.localCapability.budget.maxPages;
  }

  get capacityTierLabel(): string {
    switch (this.localCapability.tier) {
      case 'maximum': return 'High-capacity device';
      case 'high': return 'High-capacity device';
      case 'standard': return 'Standard device';
      default: return 'Conservative device profile';
    }
  }

  get capacitySummary(): string {
    if (this.isSecurityTool && this.largePdfSecurityCapability.supported) {
      return 'Up to 1 GB per file • processed locally';
    }
    if (this.behavior?.allowMultiple) {
      return `Up to ${this.maxFileMB} MB per file • ${this.maxTotalMB} MB total`;
    }
    return `Up to ${this.maxFileMB} MB per file`;
  }

  get hasBlockedWorkload(): boolean {
    return this.workloadAssessment?.risk === 'blocked';
  }

  get hasInvalidFiles(): boolean {
    return this.workspace.workspaceFiles.some(file => file.validationState === 'blocked');
  }

  get canProcessWorkspace(): boolean {
    return !this.hasBlockedWorkload && !this.hasInvalidFiles && !this.workspace.loading;
  }

  get workloadIsLarge(): boolean {
    return this.workloadAssessment?.risk === 'large' || this.workloadAssessment?.risk === 'high-risk';
  }

  get workloadMessage(): string {
    const assessment = this.workloadAssessment;
    if (!assessment || !this.workspace.files.length) return '';
    if (this.isSecurityTool && !assessment.workload.knownPageCount) return 'Ready for local PDF security processing; large files use the dedicated browser engine.';
    if (!assessment.workload.knownPageCount) return 'Checking PDF workload; page limits will be verified before processing.';
    if (assessment.risk === 'blocked') return assessment.reasons[0] ?? 'This workload cannot be processed locally on this device.';
    if (assessment.risk === 'large' || assessment.risk === 'high-risk') {
      return this.isSecurityTool
        ? 'Large PDF workload. The dedicated local security engine is being used.'
        : 'Large PDF workload. Processing may use significant device memory.';
    }
    return 'Ready for local processing.';
  }

  private refreshWorkloadAssessment(): void {
    this.workloadAssessment = this.isSecurityTool
      ? this.pdfWorkloadAnalyzer.assessSecurity(this.workspace.files, this.workspace.pageCounts)
      : this.pdfWorkloadAnalyzer.assess(this.workspace.files, this.workspace.pageCounts);
    this.applyWorkspaceValidationState();
  }

  private applyWorkspaceValidationState(): void {
    const assessment = this.workloadAssessment;
    this.workspace.workspaceFiles = this.workspace.workspaceFiles.map((item, index) => {
      const pageCount = this.workspace.pageCounts[index] || 0;

      if (item.validationState === 'blocked' && item.validationCode && item.validationCode !== 'ok') {
        return item;
      }

      let state: 'checking' | 'ready' | 'large' | 'blocked' = 'checking';
      let message: string | undefined;
      let validationCode: import('../../core/capacity/local-processing-capability.model').PdfValidationCode | undefined;

      if (this.isSecurityTool) {
        state = 'ready';
      } else if (assessment.risk === 'blocked') {
        validationCode = 'file-too-large';
        state = 'blocked';
        message = assessment.reasons[0];
      } else if (pageCount > this.maxPages) {
        state = 'blocked';
        message = `This PDF exceeds the ${this.maxPages.toLocaleString()} page local-processing limit.`;
      } else if (!assessment.workload.knownPageCount) {
        state = 'checking';
        message = 'Page count is being checked locally.';
      } else if (assessment.risk === 'large' || assessment.risk === 'high-risk') {
        state = 'large';
        message = 'Large workload; processing may use significant device memory.';
      } else if (pageCount > 0) {
        state = 'ready';
      }

      return { ...item, validationState: state, validationMessage: message, validationCode };
    });
  }

  private setRecommendations() {
    if (!this.tool?.nextTools) return;
    this.recommendedTools = TOOLS.filter(t =>
      this.tool.nextTools?.includes(t.slug)
    );
  }

  goToTool(slug: string, autoAction?: string, preserveFiles = false) {
    if (preserveFiles && this.workspace.files.length) {
      this.goToToolWithFiles(slug, this.workspace.files, autoAction);
      return;
    }

    void this.router.navigate(['/', slug]);
  }

  private goToToolWithFiles(slug: string, files: readonly File[], autoAction?: string): void {
    if (!files.length) {
      void this.router.navigate(['/', slug]);
      return;
    }

    const transferId = this.pdfFileTransfer.put(files, autoAction);
    void this.router.navigate(['/', slug], {
      state: { pdfFileTransferId: transferId }
    });
  }

  private async restoreTransferredFiles(transferId: string): Promise<void> {
    const transfer = this.pdfFileTransfer.take(transferId);
    if (!transfer?.files.length) return;

    this.loader.show(
      transfer.files[0].size >= 100 * 1024 * 1024
        ? 'Opening your large PDF locally…'
        : 'Opening your PDF…'
    );
    this.loader.setProgress?.(10);

    try {
      await this.addFilesToWorkspace(transfer.files);
      this.loader.setProgress?.(100);
      this.loader.setText(
        this.workspace.files.length
          ? 'PDF ready ✓'
          : 'PDF could not be opened'
      );
    } catch (error) {
      console.error('Failed to restore transferred PDF', error);
      this.toast.show('The PDF could not be opened. Please select it again.', 'error');
      this.loader.setText('Could not open PDF');
    } finally {
      this.loader.hide();
      this.cd.markForCheck();
    }
  }

  private async restoreTransferredFilesFromLegacyState(
    files: unknown,
    autoAction?: string
  ): Promise<void> {
    if (!Array.isArray(files) || !files.length || !files.every(file => file instanceof File)) return;

    this.loader.show('Opening your PDF…');
    this.loader.setProgress?.(10);
    try {
      await this.addFilesToWorkspace(files as File[]);
      if (autoAction === 'compress') {
        setTimeout(() => void this.compressPdf(), 300);
      } else if (autoAction === 'merge') {
        setTimeout(() => void this.mergePdf(), 300);
      }
    } finally {
      this.loader.setProgress?.(100);
      this.loader.hide();
      this.cd.markForCheck();
    }
  }

  /** Route the currently selected PDF directly to Unlock PDF. */
  openUnlockForCurrentFile(): void {
    const file = this.workspace.files[0];
    if (!file) {
      this.goToTool('unlock-pdf');
      return;
    }
    this.goToToolWithFiles('unlock-pdf', [file]);
  }

  private updateWorkflow() {
    this.workflowSteps = this.workflowService.detectWorkflow(this.workspace.files, this.workspace.pageCounts);
  }

  buildWorkflowLabel(steps: WorkflowStep[]) {
    return steps.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' + ');
  }

  async runWorkflow() {
    if (!this.workspace.files.length || this.workspace.loading || this.hasInvalidFiles) {
      if (this.hasInvalidFiles) this.toast.show(this.workspace.workspaceFiles.find(f => f.validationState === 'blocked')?.validationMessage || 'One or more PDFs cannot be processed.', 'error');
      return;
    }
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

      await this.generatePreview(result, mergedId);
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
      this.unregisterLoaderCancellation?.();
      this.unregisterLoaderCancellation = null;
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

  private async prepareUpload(files: File[]): Promise<File[]> {
    if (this.behavior.replaceOnUpload) {
      this.workspaceOps.clear();
      this.workspace.activeIndex = -1;
    }

    if (this.isSecurityTool) {
      this.securityResult = null;
      this.securityErrorMessage = null;
      this.securityProgress = 0;
      this.securityEncryptionStatus = 'unknown';
    }

    const selected = await this.validateFiles(files);
    if (this.workspace.files.length && this.workspace.activeIndex === -1) {
      this.workspace.activeIndex = 0;
    }
    return selected;
  }

  private async addFilesToWorkspace(files: File[]): Promise<void> {
    if (this.isSecurityTool) {
      this.securityResult = null;
      this.securityErrorMessage = null;
      this.securityProgress = 0;
      this.securityEncryptionStatus = 'unknown';
    }

    const selected = await this.validateFiles(files);
    if (!selected.length) {
      return;
    }

    this.toast.show(`${selected.length} files added`,'success');

    const startIndex = this.workspaceUpload.addFiles(selected,this.behavior.replaceOnUpload);

    this.handlePostUploadProcessing();
    this.refreshWorkloadAssessment();
    if (!this.isSecurityTool) {
      this.queueInitialPreviews(startIndex);
    }
    this.updateActiveFileAfterUpload(startIndex);
  }

  async onFileSelect(event: any) {
    await this.addFilesToWorkspace(Array.from(event.target.files || []) as File[]);
    event.target.value = '';
  }

  async onDropFiles(event: DragEvent) {
    event.preventDefault();
    await this.addFilesToWorkspace(Array.from(event.dataTransfer?.files || []) as File[]);
  }

  allowDrop(event: DragEvent) {
    event.preventDefault();
  }

  addMoreFiles() {
    this.fileInput?.nativeElement.click();
  }

  private previewQueue: Promise<void> = Promise.resolve();

  private queuePreview(file: File, id: string) {
    const item = this.workspace.workspaceFiles.find(x => x.id === id);
    if (!item) return;
    // already queued
    if (item.previewQueued) return;
    // already generated
    if (item.preview) return;
    item.previewQueued = true;
    this.previewQueue = this.previewQueue
      .then(() => this.generatePreview(file, id))
      .finally(() => { item.previewQueued = false; });
  }

  private queueInitialPreviews(startIndex: number): void {
    const pendingFiles = this.workspace.workspaceFiles.slice(startIndex);
    const pendingBytes = pendingFiles.reduce((sum, item) => sum + item.file.size, 0);
    // Preview only what is needed for the first viewport. Large local workloads
    // should not pay the memory cost of rendering five PDFs before processing.
    const immediatePreviewCount = pendingBytes >= 150 * 1024 * 1024 ? 1 : Math.min(3, pendingFiles.length);
    const end = Math.min(startIndex + immediatePreviewCount, this.workspace.workspaceFiles.length);
    for (let i = startIndex; i < end; i++) {
      const item = this.workspace.workspaceFiles[i];
      this.queuePreview(item.file, item.id);
    }
  }

  private updateActiveFileAfterUpload(startIndex: number): void {
    const isFirstUpload = startIndex === 0;
    if (isFirstUpload) {
      this.workspace.activeIndex = 0;
      return;
    }
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

  private handlePostUploadProcessing(): void {
    this.updateWorkflow();
    this.generateSuggestions();
    if (this.isCompressTool) {
      Promise.resolve().then(() => {
        this.analyzeCompression();
      });
    }
  }

  // =====================
  //     VALIDATIONS
  // =====================
  private async validateFiles(newFiles: File[]): Promise<File[]> {
    const valid: File[] = [];
    const existing = [...this.workspace.files];

    for (const file of newFiles) {
      const result = this.isSecurityTool
        ? this.pdfValidation.validateSecuritySelection(file)
        : this.pdfValidation.validateSelection(
            file,
            [...existing, ...valid],
            this.behavior.allowMultiple
          );

      if (!result.valid) {
        const level = result.code === 'duplicate' ? 'info' : 'error';
        if (result.message) this.toast.show(result.message, level);
        continue;
      }

      // Upload admission must stay lightweight. Do not parse the complete PDF,
      // run qpdf --check, count pages, or validate stream structure here. Those
      // checks belong to the operation/preview engine. The only content read at
      // upload time is the small trailer tail needed to route password-protected
      // PDFs before they enter a tool that cannot process them.
      const header = await this.pdfValidation.validateUploadHeader(file);
      if (!header.valid) {
        if (header.message) this.toast.show(header.message, 'error');
        continue;
      }

      const encryptionStatus = await this.pdfValidation.inspectEncryptionHint(file);

      if (this.isSecurityTool) {
        this.securityEncryptionStatus = encryptionStatus;

        // Protect PDF has the same admission policy as Merge/Split/Compress:
        // an already-protected input is not added to the workspace. Give the
        // user a direct path to Unlock PDF and preserve the selected File.
        if (this.securityMode === 'protect' && encryptionStatus === 'encrypted') {
          this.toast.show(
            'This PDF is already password-protected. Unlock it first before using Protect PDF.',
            'error',
            7000,
            {
              actions: [{
                label: 'Unlock PDF',
                action: () => this.goToToolWithFiles('unlock-pdf', [file])
              }]
            }
          );
          continue;
        }
      } else if (encryptionStatus === 'encrypted') {
        this.toast.show(
          'This PDF is password-protected. Unlock it first before using this tool.',
          'error',
          7000,
          {
            actions: [{
              label: 'Unlock PDF',
              action: () => this.goToToolWithFiles('unlock-pdf', [file])
            }]
          }
        );
        continue;
      }

      valid.push(file);
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
    if (this.hasInvalidFiles || this.hasBlockedWorkload) {
      this.toast.show(this.workspace.workspaceFiles.find(f => f.validationState === 'blocked')?.validationMessage || this.workloadMessage || 'This PDF cannot be processed reliably.', 'error');
      return;
    }
    const totalPages = this.workspace.pageCounts[0];
    let groups: SplitGroup[] = [];
    switch (request.mode) {
      case 'range': groups = this.splitEngine.splitByRanges(request.ranges!);
        break;
      case 'every-page': groups = this.splitEngine.splitEveryPage(totalPages);
        break;
      case 'every-n': groups = this.splitEngine.splitEveryN(totalPages, request.everyN!);
        break;
      case 'extract': groups = this.splitEngine.extractPages(request.pages!);
        break;
    }

    const MAX_OUTPUT_FILES = 100000;

    if (groups.length > MAX_OUTPUT_FILES) {
      this.toast.show(`Maximum ${MAX_OUTPUT_FILES} output PDFs allowed.`, 'error');
      return;
    }

    if (request.mode === 'every-page' && totalPages > 10000) {
      this.toast.show('Every Page mode supports maximum 250 pages.', 'error');
      return;
    }

    try {
      this.loader.show();
      this.loader.setText('Splitting PDF...');
      //  this.loader.setText(`Generating PDF ${i + 1}/${groups.length}`);

      const output = await this.splitExportService.export(this.workspace.files[0], groups,
        p => {
          this.loader.setProgress?.(p);
          this.loader.setText(`Generating PDFs ${p}%`);
        });

      this.loader.setText('Creating ZIP...');

      const zipBlob = await this.splitZipService.createZip(output.files);
      const originalFileName = this.workspace.files[0].name;
      const baseName = originalFileName.replace(/\.pdf$/i, '');
      // this.splitZipService.downloadZip(zipBlob,`${baseName}_split.zip`);
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
        top: 0
      });

      await new Promise(r => setTimeout(r, 150));
      this.splitZipService.downloadZip(zipBlob, `${baseName}_split.zip`);
      this.loader.hide();

      requestAnimationFrame(() => {
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      });

      this.toast.show(`${output.files.length} PDFs created`, 'success');
      //  this.loader.hide();
    } catch (error) {
      this.loader.hide();
      this.toast.show('Split failed', 'error');
    } finally {
      this.loader.hide();
    }

  }

  downloadZipAgain() {
    if (!this.lastZipBlob) {
      return;
    }
    this.splitZipService.downloadZip(this.lastZipBlob, this.lastZipName);
  }

  handleContinueTool(tool: string) {
    switch (tool) {
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
    }, 100);
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
      await new Promise(r => requestAnimationFrame(r));
      const result = await this.previewService.generatePreview(file,
        (p) => {
          item.previewProgress = p;
          if (p === 100 || p % 25 === 0) {
            requestAnimationFrame(() => this.cd.markForCheck());
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
      this.refreshWorkloadAssessment();
      item.previewProgress = 100;
      this.updateWorkflow();
    } catch (e) {
      console.error(e);
      item.previewError = true;
      item.previewLoading = false;

      // Preview is a presentation enhancement, not the PDF-processing
      // authority. A CDN/rendering/worker problem must never make a valid PDF
      // look corrupt or block Merge/Split/Compress. Only errors that clearly
      // identify a PDF/password problem become a hard validation failure;
      // infrastructure/rendering failures leave processing available.
      const definitiveCode = this.classifyPreviewValidationError(e);
      if (this.isDefinitivePreviewFailure(e)) {
        item.validationState = 'blocked';
        item.validationCode = definitiveCode;
        item.validationMessage = this.previewValidationMessage(definitiveCode);
        this.toast.show(item.validationMessage, 'error');
      } else {
        item.validationState = 'ready';
        item.validationCode = undefined;
        item.validationMessage = 'Preview is unavailable, but the PDF can still be processed.';
        this.toast.show('PDF added. Preview is unavailable, but processing can continue.', 'info');
      }
    }

    this.cd.markForCheck();
  }

  private isDefinitivePreviewFailure(error: unknown): boolean {
    const name = error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name || '').toLowerCase()
      : '';
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    return name.includes('invalidpdfexception')
      || name.includes('missingpdfexception')
      || name.includes('passwordexception')
      || message.includes('invalid pdf')
      || message.includes('password')
      || message.includes('encrypted')
      || message.includes('unsupported pdf')
      || message.includes('not a pdf');
  }

  private classifyPreviewValidationError(error: unknown): import('../../core/capacity/local-processing-capability.model').PdfValidationCode {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('password') || message.includes('encrypted')) return 'encrypted';
    if (message.includes('not a pdf') || message.includes('invalid pdf') || message.includes('invalidpdf')) return 'invalid-pdf';
    if (message.includes('unsupported') || message.includes('not supported')) return 'unsupported-pdf';
    return 'damaged-pdf';
  }

  private previewValidationMessage(code: import('../../core/capacity/local-processing-capability.model').PdfValidationCode): string {
    switch (code) {
      case 'encrypted': return 'This PDF is password-protected and cannot be used by this tool without unlocking it first.';
      case 'unsupported-pdf': return 'This PDF uses a structure or feature that this browser tool cannot process reliably.';
      case 'invalid-pdf': return 'This file is not a valid PDF.';
      default: return 'This PDF appears damaged or malformed and cannot be processed reliably.';
    }
  }

  retryPreview(i: number) {
    const item = this.workspace.workspaceFiles[i];
    item.previewError = false;
    item.previewLoading = true;
    item.previewProgress = 0;
    this.generatePreview(item.file, item.id);
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
    this.refreshWorkloadAssessment();
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
      URL.revokeObjectURL(removedFile.preview);
    }

    this.workspaceOps.removeFile(i);
    this.refreshWorkloadAssessment();
    this.toast.show('File removed', 'info', 4000, {
      actions: [{ label: 'Undo', action: () => { this.workspaceOps.restoreFile(i, removedFile); } }]
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
        const oldPages = this.viewerPages.filter(p => !this.workspace.previews.includes(p));
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
    const oldPages = this.viewerPages.filter(p => !this.workspace.previews.includes(p));
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
    const url = URL.createObjectURL(this.viewerFile);
    window.open(url, '_blank');
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
    this.queuePreview(item.file, item.id);
  }

  // =====================
  // MERGE
  // =====================
  async mergePdf() {
    if (this.workspace.loading || this.hasInvalidFiles) {
      if (this.hasInvalidFiles) this.toast.show(this.workspace.workspaceFiles.find(f => f.validationState === 'blocked')?.validationMessage || 'One or more PDFs cannot be processed.', 'error');
      return;
    }
    if (this.workspace.files.length < 2) {
      this.toast.show('Please add at least 2 PDFs to merge', 'error');
      return;
    }
    this.refreshWorkloadAssessment();
    if (this.hasBlockedWorkload) {
      this.toast.show(this.workloadMessage, 'error');
      return;
    }
    this.workspace.loading = true;
    this.toast.show('Merging started...', 'info');
    this.loader.show();
    // Stop the loader's synthetic progress immediately; MergeEngine now reports
    // real Worker stage/progress boundaries.
    this.loader.setProgress?.(0);
    this.loader.setText('Merging PDFs...');
    this.unregisterLoaderCancellation?.();
    this.unregisterLoaderCancellation = this.loader.registerCancellationHandler(() => {
      this.loader.setText('Cancelling merge...');
      this.mergeEngine.cancel();
    });
    try {
      const result = await this.mergeEngine.merge(
        this.workspace.files,
        (p) => this.loader.setProgress?.(p),
        this.workspace.pageCounts,
        {
          onStage: (_stage, message) => this.loader.setText(message)
        }
      );
      this.downloadFile(result);
      await this.workspaceOutput.showResult({ file: result, previewGenerator: this.generatePreview.bind(this) });
      console.log('Merged Result Size:', result.size);

      this.loader.setText('Done ✨');
      setTimeout(() => {
        this.loader.hide();
        this.toast.show('Merged successfully', 'success');
      }, 400);
    } catch (e) {
      console.error(e);
      const message = e instanceof Error && e.message
        ? e.message
        : 'Merge failed. Please try again with a smaller workload.';
      this.loader.setText('Merge could not be completed');
      setTimeout(() => this.loader.hide(), 500);
      this.toast.show(message, 'error');
    } finally {
      this.unregisterLoaderCancellation?.();
      this.unregisterLoaderCancellation = null;
      this.workspace.loading = false;
      this.cd.markForCheck();
    }
  }

  async runSecurityOperation(request: PdfSecurityRequest): Promise<void> {
    if (this.workspace.loading || !this.workspace.files.length || !this.isSecurityTool) {
      return;
    }

    this.refreshWorkloadAssessment();
    if (this.hasBlockedWorkload) {
      this.toast.show(this.workloadMessage, 'error');
      return;
    }

    const file = this.workspace.files[0];
    if (this.securityMode === 'protect' && this.securityEncryptionStatus === 'encrypted') {
      const message = 'This PDF is already password-protected. Unlock it first, then protect the unlocked copy with a new password.';
      this.securityErrorMessage = message;
      this.toast.show(message, 'error');
      this.cd.markForCheck();
      return;
    }
    if ((this.securityMode === 'unlock' || this.securityMode === 'remove-password') && this.securityEncryptionStatus === 'not-encrypted') {
      const message = 'This PDF does not appear to be password-protected. Use Protect PDF if you want to add a password.';
      this.securityErrorMessage = message;
      this.toast.show(message, 'error');
      this.cd.markForCheck();
      return;
    }
    this.workspace.loading = true;
    this.loader.show();
    this.securityProgress = 0;
    this.securityErrorMessage = null;
    this.securityResult = null;
    this.loader.setProgress?.(0);
    this.loader.setText('Preparing PDF security operation...');

    this.unregisterLoaderCancellation?.();
    this.unregisterLoaderCancellation = this.loader.registerCancellationHandler(() => {
      this.loader.setText('Cancelling PDF security operation...');
      void this.pdfSecurity.cancel();
    });

    try {
      const result = request.mode === 'protect'
        ? await this.pdfSecurity.protect(
            file,
            {
              userPassword: request.password,
              permissions: request.permissions ?? {
                allowPrinting: true,
                allowCopying: true,
                allowModifying: false,
                allowAnnotations: true,
                allowForms: true,
                allowAssembly: false
              },
              bits: 256
            },
            progress => {
              this.securityProgress = progress;
              this.loader.setProgress?.(progress);
              this.loader.setText('Encrypting PDF locally...');
            }
          )
        : await this.pdfSecurity.removePassword(
            file,
            request.password,
            progress => {
              this.securityProgress = progress;
              this.loader.setProgress?.(progress);
              this.loader.setText('Removing PDF password locally...');
            },
            request.mode
          );

      this.securityResult = result;
      this.loader.setText('Done ✨');
      this.toast.show('PDF security operation completed.', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'PDF security operation failed. Please try again.';
      this.securityErrorMessage = message;
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'INPUT_ENCRYPTED') {
        this.securityEncryptionStatus = 'encrypted';
      }
      this.loader.setText('PDF security operation could not be completed');
      this.toast.show(message, 'error');
    } finally {
      this.unregisterLoaderCancellation?.();
      this.unregisterLoaderCancellation = null;
      this.workspace.loading = false;
      setTimeout(() => this.loader.hide(), 250);
      this.cd.markForCheck();
    }
  }

  downloadSecurityResult(): void {
    if (!this.securityResult) return;
    this.downloadFile(this.securityResult.file);
  }

  protectSecurityResult(): void {
    if (this.workspace.loading || !this.securityResult?.file) return;
    this.goToToolWithFiles('protect-pdf', [this.securityResult.file]);
  }

  processAnotherSecurityPdf(): void {
    if (this.workspace.loading) return;
    this.securityResult = null;
    this.securityErrorMessage = null;
    this.securityProgress = 0;
    this.securityEncryptionStatus = 'unknown';
    this.workspaceOps.clear();
    this.workspace.activeIndex = -1;
    this.workloadAssessment = this.pdfWorkloadAnalyzer.assess([], []);
    this.cd.markForCheck();
    setTimeout(() => this.triggerUpload());
  }


  resetAfterMerge() {
    this.workspaceOps.replaceAll([]);
    this.workspace.activeIndex = -1;
    this.workspace.hasMerged = false;
    this.workspace.lastMergedUrl = null;
    this.workloadAssessment = this.pdfWorkloadAnalyzer.assess([], []);
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
    await this.compressionFacade.analyze(file);
    
    console.log('ToolComponent');
    console.log(this.compressionState);

    if (requestId !== this.analysisRequestId) {
      return;
    }
    this.cd.markForCheck();

  }

  getTotalSize(): string {
    return (this.workspace.files.reduce((a, f) => a + f.size, 0) / (1024 * 1024)).toFixed(2) + ' MB';
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

  async compressPdf() {
    if (!this.workspace.files.length) {
      this.toast.show('Please add a PDF first', 'error');
      return;
    }
    if (this.hasInvalidFiles || this.hasBlockedWorkload) {
      this.toast.show(this.workspace.workspaceFiles.find(f => f.validationState === 'blocked')?.validationMessage || this.workloadMessage || 'This PDF cannot be processed reliably.', 'error');
      return;
    }

    this.loader.show();
    this.loader.setText('Optimizing PDF...');

    this.workspace.loading = true;
    try {
      const result = await this.compressionFacade.compress(this.workspace.files[0]);
      this.downloadFile(result);
      await this.workspaceOutput.showResult({
        file: result,
        previewGenerator: this.generatePreview.bind(this)
      });
      this.loader.setText('Done ✨');
      this.toast.show('Optimization completed', 'success');
      this.compressionState.showCompressResult = true;
    }
    catch (e) {
      console.error(e);
      this.loader.setText('Optimization failed');
      this.toast.show('Optimization failed', 'error');
    }
    finally {
      this.loader.hide();
      this.workspace.loading = false;
      this.cd.detectChanges();
    }
  }

  resetAfterCompression(): void {
    this.compressionState.reset();
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
    this.workloadAssessment = this.pdfWorkloadAnalyzer.assess([], []);
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
        action: () => this.goToTool('compress-pdf', 'compress', true)
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
    this.unregisterLoaderCancellation?.();
    this.unregisterLoaderCancellation = null;
    if (this.workspace.loading) {
      if (this.isSecurityTool) {
        void this.pdfSecurity.cancel();
      } else {
        this.mergeEngine.cancel();
      }
    }
    if (this.workspace.lastMergedUrl) {
      URL.revokeObjectURL(this.workspace.lastMergedUrl);
    }
    this.workspace.previews.forEach(p => {
      if (p) URL.revokeObjectURL(p);
    });
  }

}