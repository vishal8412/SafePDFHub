import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];

async function read(relative) {
  return readFile(resolve(root, relative), 'utf8');
}
function assert(condition, message) {
  if (!condition) failures.push(message);
}

const tools = await read('src/app/config/tools.config.ts');
const behavior = await read('src/app/config/tool-behavior.config.ts');
const routes = await read('src/app/app.routes.ts');
const toolTs = await read('src/app/pages/tool/tool.component.ts');
const toolHtml = await read('src/app/pages/tool/tool.component.html');
const service = await read('src/app/core/watermark/pdf-watermark.service.ts');
const metrics = await read('src/app/core/watermark/pdf-watermark-metrics.service.ts');
const types = await read('src/app/core/watermark/pdf-watermark.types.ts');
const workspaceTs = await read('src/app/features/tools/watermark/watermark-workspace/watermark-workspace.component.ts');
const workspaceHtml = await read('src/app/features/tools/watermark/watermark-workspace/watermark-workspace.component.html');
const controls = await read('src/app/features/tools/watermark/watermark-controls.component.ts');
const controlsHtml = await read('src/app/features/tools/watermark/watermark-controls.component.html');
const studioModel = await read('src/app/features/studio/models/studio-tool.model.ts');
const studioToolbar = await read('src/app/features/studio/toolbar/studio-toolbar/studio-toolbar.ts');
const studioToolbarHtml = await read('src/app/features/studio/toolbar/studio-toolbar/studio-toolbar.html');
const studioShell = await read('src/app/features/studio/shell/studioShell/studio-shell.component.ts');
const studioShellHtml = await read('src/app/features/studio/shell/studioShell/studio-shell.component.html');
const studioWorkspaceHtml = await read('src/app/features/studio/workspace/studio-workspace/studio-workspace.html');
const studioFacade = await read('src/app/features/studio/facade/studio.facade.ts');
const studioSidebar = await read('src/app/features/studio/right-sidebar/studio-right-sidebar/studio-right-sidebar.ts');
const studioSidebarHtml = await read('src/app/features/studio/right-sidebar/studio-right-sidebar/studio-right-sidebar.html');
const home = await read('src/app/features/pages/home/home.component.ts');
const resultComponent = await read('src/app/shared/components/operation-result/operation-result.component.ts');
const audit = await read('scripts/watermark-audit.mjs');

assert(tools.includes("slug: 'watermark-pdf'"), 'Watermark tool metadata is missing.');
assert(behavior.includes("slug: 'watermark-pdf'"), 'Watermark ToolBehavior is missing.');
assert(routes.includes("path: 'tools/:slug'"), 'Canonical tool route is missing.');
assert(toolTs.includes('PdfWatermarkService'), 'Tool page must integrate PdfWatermarkService.');
assert(toolTs.includes('isWatermarkTool'), 'Tool page must expose watermark workflow state.');
assert(toolHtml.includes('<app-watermark-workspace'), 'Tool page must render the watermark workspace.');
assert(existsSync(resolve(root, 'src/app/core/watermark/pdf-watermark.service.ts')), 'Watermark service is missing.');
assert(existsSync(resolve(root, 'src/app/core/watermark/pdf-watermark.types.ts')), 'Watermark types are missing.');
assert(existsSync(resolve(root, 'src/app/core/watermark/pdf-watermark-preview.service.ts')), 'Multi-page watermark preview service is missing.');
assert(existsSync(resolve(root, 'src/app/core/watermark/pdf-watermark-metrics.service.ts')), 'Shared PDF-font metrics service is missing.');
assert(existsSync(resolve(root, 'src/app/features/tools/watermark/watermark-controls.component.ts')), 'Shared watermark controls component is missing.');
assert(existsSync(resolve(root, 'src/app/features/tools/watermark/watermark-workspace/watermark-workspace.component.ts')), 'Watermark workspace component is missing.');
assert(existsSync(resolve(root, 'src/app/features/tools/watermark/watermark-workspace/watermark-workspace.component.html')), 'Watermark workspace template is missing.');
assert(existsSync(resolve(root, 'src/app/features/tools/watermark/watermark-workspace/watermark-workspace.component.scss')), 'Watermark workspace styles are missing.');
assert(existsSync(resolve(root, 'src/app/core/watermark/pdf-watermark.service.spec.ts')), 'Watermark geometry tests are missing.');
assert(service.includes('PDFDocument.load'), 'Watermarking must operate on a parsed PDF.');
assert(service.includes('embedPng') && service.includes('embedJpg'), 'PNG/JPEG image watermark embedding is missing.');
assert(service.includes('createImageBitmap') && service.includes('webp'), 'WebP must be converted locally instead of uploaded.');
assert(service.includes('resolveWatermarkPageSelection'), 'Deterministic page-selection validation is missing.');
assert(types.includes("mode: 'current'; readonly page: number"), 'Current-page selection must be explicit in the request contract.');
assert(controls.includes("{ mode: 'current', page: this.currentPageSnapshot }"), 'Current-page controls must emit an explicit page snapshot.');
assert(metrics.includes('PDFDocument.create') && metrics.includes('widthOfTextAtSize'), 'Shared PDF-font metrics must use pdf-lib metrics.');
assert(service.includes('page.getRotation().angle'), 'Page rotation must be considered during watermark placement.');
assert(service.includes('validateOutput'), 'Watermark output validation is missing.');
assert(service.includes('this.cancelled'), 'Watermark cancellation boundary is missing.');
assert(!/fetch\s*\(/.test(service) && !/XMLHttpRequest/.test(service), 'Watermark service must not add network transport.');
assert(!/localStorage|sessionStorage|indexedDB/i.test(service), 'Watermark service must not persist user PDF data.');
assert(types.includes("'text' | 'image'"), 'Text/image watermark modes are missing.');
assert(controls.includes('requestChange') && controls.includes('applyWatermark'), 'Shared watermark controls must expose one common request contract.');
assert(workspaceHtml.includes('Preview every page') && workspaceHtml.includes('previousPage') && workspaceHtml.includes('nextPage'), 'Watermark preview must navigate every page.');
assert(controlsHtml.includes('All pages') && controlsHtml.includes('Current page') && controlsHtml.includes('Page range'), 'All/current/range page-scope controls are missing.');
assert(controlsHtml.includes('Repeat across the page'), 'Tiled watermark control is missing.');
assert(workspaceHtml.includes('app-operation-result'), 'Watermark result must use the shared OperationResult component.');
assert(workspaceTs.includes('URL.revokeObjectURL'), 'Watermark image preview cleanup is missing.');
assert(home.includes("route: '/tools/watermark-pdf'"), 'Landing toolbox must expose the Watermark PDF tool.');
assert(studioModel.includes("| 'watermark'"), 'Studio tool model must expose Watermark.');
assert(studioToolbar.includes("id: 'watermark'"), 'Studio toolbar must expose Watermark.');
assert(studioToolbarHtml.includes("@case ('watermark')"), 'Studio Watermark icon is missing.');
assert(studioShell.includes("case 'watermark'"), 'Studio shell must handle the Watermark action.');
assert(studioSidebar.includes('WatermarkControlsComponent'), 'Studio right sidebar must reuse the shared Watermark controls.');
assert(studioSidebar.includes('applyWatermark'), 'Studio right sidebar must expose Add/Update Watermark handling.');
assert(studioSidebar.includes('removeWatermark'), 'Studio right sidebar must expose Remove Watermark handling.');
assert(studioSidebarHtml.includes('app-watermark-controls'), 'Studio right sidebar must render the shared Watermark controls.');
assert(studioSidebarHtml.includes("watermark.committed() ? 'Update Watermark' : 'Add Watermark'"), 'Studio Watermark Add/Update labels are missing.');
assert(studioShell.includes("case 'watermark'"), 'Studio shell must open the Watermark inspector.');
assert(studioShell.includes('watermark.open()'), 'Studio shell must open the Watermark state.');
assert(studioWorkspaceHtml.includes('<app-studio-right-sidebar'), 'Studio right sidebar is not wired into the workspace.');
assert(studioFacade.includes('exportCurrentDocumentFile'), 'Studio must export current Studio changes before watermarking.');
assert(studioFacade.includes('pdfWatermark.apply(file, committedWatermark)'), 'Studio export must apply the committed watermark after Studio edits.');
assert(studioSidebar.includes('commitWatermark') && studioSidebar.includes('removeWatermark'), 'Studio Watermark mutations must route through the Facade history boundary.');
assert(resultComponent.includes("selector: 'app-operation-result'"), 'Shared operation result component is missing.');
assert(audit.includes('Shared watermark controls'), 'Audit self-check is incomplete.');
assert(audit.includes('Studio right sidebar'), 'Audit must validate the current Studio sidebar architecture.');

if (failures.length) {
  console.error('Watermark architecture audit: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Watermark architecture audit: PASS');
console.log('- Standalone /tools/watermark-pdf workflow integrated.');
console.log('- Shared watermark controls reused by Tool and Studio.');
console.log('- Multi-page preview navigation and all/current/range page scope detected.');
console.log('- Landing toolbox and Studio toolbar Watermark entries detected.');
console.log('- Shared OperationResult component detected.');
console.log('- No persistence/network transport detected in watermark service.');
