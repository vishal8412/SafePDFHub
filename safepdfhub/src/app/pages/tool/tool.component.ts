import { Component, OnInit, ChangeDetectorRef, OnDestroy, Inject, PLATFORM_ID, ViewChild, ElementRef, HostListener } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
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
import type { ActionPanelAction, ActionPanelTrustItem } from '../../shared/components/action-panel/action-panel.component';
import { SplitEngine } from '../../core/engines/split.engine';
import { SplitGroup } from '../../core/split/split.types';
import { SplitExportService } from '../../core/split/split-export.service';
import { SplitZipService } from '../../core/split/split-zip.service';
import { CompressionState } from '../../core/compression/compression.state';
import { CompressionFacade } from '../../core/compression/compress.facade';
import { WorkspaceOutputService } from '../../core/workflow/workspace-output.service';
import { WorkspaceUploadService } from '../../core/workflow/workspace-upload.service';
import { LocalProcessingCapabilityService } from '../../core/capacity/local-processing-capability.service';
import { PdfValidationService } from '../../core/capacity/pdf-validation.service';
import { PdfWorkloadAnalyzerService } from '../../core/capacity/pdf-workload-analyzer.service';
import { LocalProcessingCapability, WorkloadAssessment } from '../../core/capacity/local-processing-capability.model';
import { SecurityWorkspaceComponent } from '../../features/tools/security/security-workspace/security-workspace.component';
import { SignPdfWorkspaceComponent } from '../../features/tools/sign/sign-pdf-workspace/sign-pdf-workspace.component';
import { WatermarkWorkspaceComponent } from '../../features/tools/watermark/watermark-workspace/watermark-workspace.component';
import { PdfSecurityService } from '../../core/security/pdf-security.service';
import { SeoService } from '../../core/services/seo.service';
import { HomeSectionNavigationService } from '../../shared/services/home-section-navigation.service';
import { LargePdfSecurityCapabilityService } from '../../core/security/large-file/large-pdf-security-capability.service';
import type { PdfSecurityMode, PdfSecurityRequest, PdfSecurityResult } from '../../core/security/pdf-security.types';
import { PdfWatermarkService } from '../../core/watermark/pdf-watermark.service';
import type { PdfWatermarkRequest, PdfWatermarkResult } from '../../core/watermark/pdf-watermark.types';

type WorkflowStep = 'merge' | 'compress' | 'split';

@Component({
  selector: 'app-tool',
  standalone: true,
  imports: [CommonModule, MergeWorkspaceComponent, CompressWorkspaceComponent, SplitWorkspaceComponent, SecurityWorkspaceComponent, SignPdfWorkspaceComponent, WatermarkWorkspaceComponent,
    DialogComponent, BottomSheetComponent, ActionPanelComponent, RouterModule],
  templateUrl: './tool.component.html',
  styleUrls: ['./tool.component.scss']
})

export class ToolComponent implements OnInit, OnDestroy {

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('uploadDropZone') uploadDropZone!: ElementRef<HTMLElement>;
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
  /** Stable input for the Sign PDF workspace; avoids a getter-backed array changing during a check. */
  signWorkspaceFile: File | null = null;

  private unregisterLoaderCancellation: (() => void) | null = null;

  // Compress PDF
  private analysisRequestId = 0;
  private lastPositions = new Map<number, DOMRect>();
  private isBrowser = false;
  isDragOver = false;
  private dragDepth = 0;

  @HostListener('document:dragover', ['$event'])
  preventBrowserFileNavigation(event: DragEvent): void {
    // Browsers navigate to a dropped file unless dragover is cancelled at the
    // document level. The upload zone still handles the actual drop below.
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault();
    }
  }

  @HostListener('document:drop', ['$event'])
  preventBrowserDropNavigation(event: DragEvent): void {
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault();
    }
  }

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
  watermarkProgress = 0;
  watermarkResult: PdfWatermarkResult | null = null;
  watermarkErrorMessage: string | null = null;

  get isWorkspaceMode(): boolean { return this.workspace.files.length > 0; }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private seo: SeoService,
    private homeSectionNavigation: HomeSectionNavigationService,
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
    private localProcessingCapability: LocalProcessingCapabilityService,
    private pdfValidation: PdfValidationService,
    private pdfWorkloadAnalyzer: PdfWorkloadAnalyzerService,
    private largePdfSecurityCapability: LargePdfSecurityCapabilityService,
    private pdfSecurity: PdfSecurityService,
    private pdfWatermark: PdfWatermarkService,
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
        void this.router.navigate(['/']);
        return;
      }

      // READ NAVIGATION STATE
      const navigation = this.isBrowser ? window.history.state : {};
      const filesFromState = navigation?.files;
      const autoAction = navigation?.autoAction;
      const shouldPreserve = Array.isArray(filesFromState) && filesFromState.length > 0;

      // ALWAYS RESET FIRST
      this.resetWorkspaceState();

      // SET TOOL
      this.tool = match;
      const behavior = TOOL_BEHAVIORS.find(b => b.slug === this.tool.slug);
      if (!behavior) {
        void this.router.navigate(['/']);
        return;
      }

      this.behavior = behavior;
      this.updateBreadcrumbLabel();

      this.setRecommendations();

      this.seo.updateTool(this.tool);

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

  /**
   * Human-readable label used by the visible breadcrumb.
   * Keep this as a concrete component property so Angular template type-checking
   * does not depend on a getter being present in an older local file.
   */
  breadcrumbLabel = 'PDF Tool';

  navigateToHomeSection(event: Event, fragment: string): void {
    this.homeSectionNavigation.navigateToSection(event, fragment);
  }

  private updateBreadcrumbLabel(): void {
    const labels: Record<string, string> = {
      'compress-pdf': 'Compress PDF',
      'merge-pdf': 'Merge PDF',
      'split-pdf': 'Split PDF',
      'protect-pdf': 'Protect PDF',
      'unlock-pdf': 'Unlock PDF',
      'sign-pdf': 'Sign PDF',
      'watermark-pdf': 'Watermark PDF',
    };

    this.breadcrumbLabel = labels[this.tool?.slug ?? ''] ?? 'PDF Tool';
  }

  get isMergeTool(): boolean {
    return this.tool?.slug === 'merge-pdf';
  }

  get isSplitTool(): boolean {
    return this.tool?.slug === 'split-pdf';
  }

  get isSignTool(): boolean { return this.tool?.slug === 'sign-pdf'; }

  get isWatermarkTool(): boolean { return this.tool?.slug === 'watermark-pdf'; }

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
    this.watermarkResult = null;
    this.watermarkErrorMessage = null;
    this.watermarkProgress = 0;
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
    this.signWorkspaceFile = null;
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
    if (this.behavior.allowMultiple) {
      return `Up to ${this.maxFileMB} MB per file • ${this.maxTotalMB} MB total`;
    }
    return `Up to ${this.maxFileMB} MB per file`;
  }

  get hasBlockedWorkload(): boolean {
    return this.workloadAssessment?.risk === 'blocked';
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
      let state: 'checking' | 'ready' | 'large' | 'blocked' = 'checking';
      let message: string | undefined;

      if (assessment.risk === 'blocked') {
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

      return { ...item, validationState: state, validationMessage: message };
    });
  }

  private setRecommendations() {
    if (!this.tool?.nextTools) return;
    this.recommendedTools = TOOLS.filter(t =>
      this.tool.nextTools?.includes(t.slug)
    );
  }

  goToTool(slug: string, autoAction?: string, preserveFiles = false) {
    const navigationState = preserveFiles ? { files: this.workspace.files, autoAction } : undefined;
    this.router.navigate(['/tools', slug], { state: navigationState });
  }

  private updateWorkflow() {
    this.workflowSteps = this.workflowService.detectWorkflow(this.workspace.files, this.workspace.pageCounts);
  }

  buildWorkflowLabel(steps: WorkflowStep[]) {
    return steps.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' + ');
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

  private prepareUpload(files: File[]): File[] {
    if (this.behavior.replaceOnUpload) {
      this.workspaceOps.clear();
      this.workspace.activeIndex = -1;
    }

    if (this.isSecurityTool) {
      this.securityResult = null;
      this.securityErrorMessage = null;
      this.securityProgress = 0;
    }
    if (this.isWatermarkTool) {
      this.watermarkResult = null;
      this.watermarkErrorMessage = null;
      this.watermarkProgress = 0;
    }

    const selected = this.validateFiles(files);
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
    }
    if (this.isWatermarkTool) {
      this.watermarkResult = null;
      this.watermarkErrorMessage = null;
      this.watermarkProgress = 0;
    }

    const selected = this.validateFiles(files);
    if (!selected.length) {
      return;
    }

    this.toast.show(`${selected.length} files added`,'success');

    // The Sign PDF workspace is single-file. Set its input before mutating the
    // workspace collection so Angular sees one stable input during the same
    // change-detection turn.
    if (this.isSignTool) {
      this.signWorkspaceFile = selected[0] ?? null;
    }

    const startIndex = this.workspaceUpload.addFiles(selected,this.behavior.replaceOnUpload);

    this.handlePostUploadProcessing();
    this.refreshWorkloadAssessment();
    if (!this.isSecurityTool && !this.isSignTool) {
      this.queueInitialPreviews(startIndex);
    }
    this.updateActiveFileAfterUpload(startIndex);
  }

  onFileSelect(event: any) {
    this.addFilesToWorkspace(Array.from(event.target.files || []) as File[]);
    event.target.value = '';
  }

  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (!event.dataTransfer?.types?.includes('Files')) return;

    this.dragDepth += 1;
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    // Moving between children of the drop zone can fire dragleave/dragenter
    // pairs. Ignore those internal transitions so the visual state does not
    // flicker while the user is positioning a file.
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && this.uploadDropZone?.nativeElement.contains(relatedTarget)) {
      return;
    }

    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) {
      this.isDragOver = false;
    }
  }

  onDropFiles(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const files = Array.from(event.dataTransfer?.files || []) as File[];

    this.dragDepth = 0;
    this.isDragOver = false;

    if (files.length) {
      void this.addFilesToWorkspace(files);
    }
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (event.dataTransfer?.types?.includes('Files')) {
      event.dataTransfer.dropEffect = 'copy';
      this.isDragOver = true;
    }
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
  private validateFiles(newFiles: File[]): File[] {
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

  get quickActions(): ActionPanelAction[] {
    const currentSlug = this.tool?.slug;

    const fallbackActions = [
      { id: 'merge-pdf', icon: AppIcons.Files, title: 'Merge PDFs', desc: 'Combine multiple PDFs into one' },
      { id: 'compress-pdf', icon: AppIcons.Zap, title: 'Compress PDF', desc: 'Reduce PDF file size' },
      { id: 'split-pdf', icon: AppIcons.Scissors, title: 'Split PDF', desc: 'Extract pages from a PDF' },
      { id: 'protect-pdf', icon: AppIcons.Shield, title: 'Protect PDF', desc: 'Add password protection' },
      { id: 'unlock-pdf', icon: AppIcons.Lock, title: 'Unlock PDF', desc: 'Remove password protection' },
      { id: 'watermark-pdf', icon: AppIcons.FileText, title: 'Watermark PDF', desc: 'Add text or image watermark' }
    ];

    const preferredSlugs = this.tool?.nextTools ?? [];
    const preferred = preferredSlugs
      .filter(slug => slug !== currentSlug)
      .map(slug => fallbackActions.find(action => action.id === slug))
      .filter((action): action is typeof fallbackActions[number] => !!action);

    const remaining = fallbackActions.filter(action =>
      action.id !== currentSlug && !preferred.some(item => item.id === action.id)
    );

    return [...preferred, ...remaining].slice(0, 4);
  }

  trustItems: ActionPanelTrustItem[] = [
    { icon: 'local', title: 'Local processing' },
    { icon: 'speed', title: 'Fast processing' },
    { icon: 'device', title: 'No server upload' }
  ];

  handleQuickAction(actionSlug: string) {
    if (!actionSlug || actionSlug === this.tool?.slug) {
      return;
    }

    if (actionSlug === 'compress-pdf') {
      this.goToTool('compress-pdf', 'compress', true);
      return;
    }

    this.goToTool(actionSlug);
  }

  openAllTools() {
    this.router.navigate(['/'], { fragment: 'tools' });
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
      this.toast.show('Preview failed', 'error');
    }

    this.cd.markForCheck();
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
    if (this.workspace.loading) return;
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

  processAnotherSecurityPdf(): void {
    if (this.workspace.loading) return;
    this.securityResult = null;
    this.securityErrorMessage = null;
    this.securityProgress = 0;
    this.workspaceOps.clear();
    this.workspace.activeIndex = -1;
    this.workloadAssessment = this.pdfWorkloadAnalyzer.assess([], []);
    this.cd.markForCheck();
    setTimeout(() => this.triggerUpload());
  }


  async runWatermarkOperation(request: PdfWatermarkRequest): Promise<void> {
    if (this.workspace.loading || !this.workspace.files.length || !this.isWatermarkTool) return;

    this.refreshWorkloadAssessment();
    if (this.hasBlockedWorkload) {
      this.toast.show(this.workloadMessage, 'error');
      return;
    }

    const file = this.workspace.files[0];
    this.workspace.loading = true;
    this.watermarkProgress = 0;
    this.watermarkErrorMessage = null;
    this.watermarkResult = null;
    this.loader.show();
    this.loader.setProgress?.(0);
    this.loader.setText('Preparing watermark operation...');

    this.unregisterLoaderCancellation?.();
    this.unregisterLoaderCancellation = this.loader.registerCancellationHandler(() => {
      this.pdfWatermark.cancel();
      this.loader.setText('Cancelling watermark operation...');
    });

    try {
      const result = await this.pdfWatermark.apply(file, request, progress => {
        this.watermarkProgress = progress;
        this.loader.setProgress?.(progress);
        this.loader.setText(progress >= 95 ? 'Finalizing watermarked PDF...' : `Applying watermark... ${progress}%`);
        this.cd.markForCheck();
      });

      this.watermarkResult = result;
      this.loader.setText('Done ✨');
      this.toast.show('PDF watermarked successfully.', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'PDF watermarking failed. Please try again.';
      this.watermarkErrorMessage = message;
      this.loader.setText('Watermark operation could not be completed');
      this.toast.show(message, 'error');
    } finally {
      this.unregisterLoaderCancellation?.();
      this.unregisterLoaderCancellation = null;
      this.workspace.loading = false;
      setTimeout(() => this.loader.hide(), 250);
      this.cd.markForCheck();
    }
  }

  downloadWatermarkResult(): void {
    if (!this.watermarkResult) return;
    this.downloadFile(this.watermarkResult.file);
  }

  editWatermarkAgain(): void {
    if (this.workspace.loading) return;
    this.watermarkResult = null;
    this.watermarkErrorMessage = null;
    this.watermarkProgress = 0;
    this.cd.markForCheck();
  }

  processAnotherWatermarkPdf(): void {
    if (this.workspace.loading) return;
    this.pdfWatermark.cancel();
    this.watermarkResult = null;
    this.watermarkErrorMessage = null;
    this.watermarkProgress = 0;
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
    this.dragDepth = 0;
    this.isDragOver = false;
    this.unregisterLoaderCancellation?.();
    this.unregisterLoaderCancellation = null;
    if (this.workspace.loading) {
      if (this.isSecurityTool) {
        void this.pdfSecurity.cancel();
      } else if (this.isWatermarkTool) {
        this.pdfWatermark.cancel();
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