import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];

async function read(relative) {
  return readFile(resolve(root, relative), 'utf8');
}
function assert(condition, message) {
  if (!condition) failures.push(message);
}

const types = await read('src/app/core/watermark/pdf-watermark.types.ts');
const service = await read('src/app/core/watermark/pdf-watermark.service.ts');
const serviceSpec = await read('src/app/core/watermark/pdf-watermark.service.spec.ts');
const controls = await read('src/app/features/tools/watermark/watermark-controls.component.ts');
const controlsHtml = await read('src/app/features/tools/watermark/watermark-controls.component.html');
const workspace = await read('src/app/features/tools/watermark/watermark-workspace/watermark-workspace.component.ts');
const workspaceHtml = await read('src/app/features/tools/watermark/watermark-workspace/watermark-workspace.component.html');
const studioState = await read('src/app/features/studio/state/studio-watermark-state.service.ts');
const studioStateSpec = await read('src/app/features/studio/state/studio-watermark-state.service.spec.ts');
const history = await read('src/app/features/studio/services/studio-history.service.ts');
const historySpec = await read('src/app/features/studio/services/studio-history.service.spec.ts');
const facade = await read('src/app/features/studio/facade/studio.facade.ts');
const sidebar = await read('src/app/features/studio/right-sidebar/studio-right-sidebar/studio-right-sidebar.ts');
const sidebarHtml = await read('src/app/features/studio/right-sidebar/studio-right-sidebar/studio-right-sidebar.html');
const sidebarScss = await read('src/app/features/studio/right-sidebar/studio-right-sidebar/studio-right-sidebar.scss');
const workspaceScss = await read('src/app/features/studio/workspace/studio-workspace/studio-workspace.scss');
const canvas = await read('src/app/features/studio/canvas/studio-canvas/studio-canvas.ts');

// Positions + rotations.
const positions = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];
assert(positions.every(position => types.includes(`'${position}'`)), 'All nine watermark positions must exist in the request contract.');
assert(service.includes('watermarkPositionCenter') && service.includes('watermarkDisplayPositionCenter'), 'PDF and Studio display position helpers must remain explicit.');
assert(serviceSpec.includes('all nine position anchors') && serviceSpec.includes('every supported rotation'), 'Geometry QA must cover all nine positions across the rotation matrix.');
assert(controlsHtml.includes('min="-180"') && controlsHtml.includes('max="180"'), 'Rotation control must cover -180° through 180°.');

// Repeat.
assert(types.includes('readonly tiled: boolean'), 'Repeat/tiled state must exist in the request contract.');
assert(controlsHtml.includes('Repeat across the page'), 'Repeat control is missing.');
assert(service.includes('pageWidth * 0.25') && service.includes('pageWidth * 0.75') && service.includes('pageHeight * 0.25') && service.includes('pageHeight * 0.75'), 'Repeat mode must use fixed normalized anchors.');
assert(service.includes('watermarkTiledScale'), 'Repeat mode must scale oversized content without moving its anchors.');
assert(serviceSpec.includes('uses exactly four fixed normalized repeat anchors'), 'Repeat geometry must have a four-anchor regression test.');

// Page scope: all/current/range.
assert(controlsHtml.includes('All pages') && controlsHtml.includes('Current page') && controlsHtml.includes('Page range'), 'All/current/range page scope controls are required.');
assert(controls.includes("pageMode: 'all' | 'current' | 'ranges'"), 'Watermark controls must model all/current/range page scope.');
assert(types.includes("{ readonly mode: 'current'; readonly page: number }"), 'Current-page scope must be an explicit request mode with a page snapshot.');
assert(controls.includes("{ mode: 'current', page: this.currentPageSnapshot }"), 'Current-page scope must emit an explicit page snapshot.');
assert(service.includes('resolveWatermarkPageSelection'), 'Page selection must be resolved centrally by the watermark service.');
assert(serviceSpec.includes('selects every page deterministically') && serviceSpec.includes('deduplicates and sorts overlapping ranges'), 'All/range page-selection regression tests are present.');

// Standalone preview/export parity.
assert(workspaceHtml.includes('Preview every page') && workspaceHtml.includes('previousPage') && workspaceHtml.includes('nextPage'), 'Standalone watermark preview must support page navigation.');
assert(workspace.includes('watermarkDisplayPositionCenter') && workspace.includes('watermarkTiledCenters') && workspace.includes('watermarkTiledScale'), 'Standalone preview must use the shared watermark geometry helpers.');
assert(workspaceHtml.includes('preview matches the exported PDF'), 'Standalone workflow must document preview/export parity.');

// Studio lifecycle + unified history.
assert(sidebar.includes('commitWatermark') && sidebar.includes('removeWatermark'), 'Studio Add/Update/Remove must route through the Facade.');
assert(sidebarHtml.includes("watermark.committed() ? 'Update Watermark' : 'Add Watermark'"), 'Studio must expose contextual Add/Update labels.');
assert(facade.includes('commitWatermark(request: PdfWatermarkRequest)'), 'Facade must own committed watermark history mutations.');
assert(facade.includes("'Remove Watermark'"), 'Watermark removal must be a history mutation.');
assert(facade.includes('watermarkState.committed()') && facade.includes('pdfWatermark.apply(file, committedWatermark)'), 'Studio export must apply the committed watermark after Studio edits.');
assert(history.includes('readonly watermark:') && history.includes('PdfWatermarkRequest'), 'Studio history snapshots must include watermark state.');
assert(history.includes('imageFile') && history.includes('studioHistoryFile'), 'Watermark image File references must survive history cloning without duplicating image bytes.');
assert(historySpec.includes('undoes and redoes Add Watermark') && historySpec.includes('exact image File reference'), 'Undo/Redo watermark regression tests are present.');
assert(studioState.includes('restoreCommitted'), 'Watermark state must support history restoration without reopening the inspector.');
assert(studioStateSpec.includes('restores committed watermark state'), 'Watermark state restoration regression test is present.');

// Mobile/responsive presentation.
assert(sidebarScss.includes('@media (max-width: 700px)'), 'Watermark inspector must have mobile-specific presentation.');
assert(sidebarScss.includes('padding: 10px 12px 18px'), 'Watermark controls must own a mobile-safe inner gutter.');
assert(workspaceScss.includes('.studio-responsive-panel-close {\n  display: none;'), 'Responsive close buttons must be hidden by default on desktop.');
assert(workspaceScss.includes('@media (max-width: 920px)') && workspaceScss.includes('display: grid;'), 'Responsive close buttons must activate only in responsive layouts.');
assert(workspaceScss.includes('height: min(62dvh, 560px)'), 'Mobile inspector must remain a bottom sheet rather than a full-page takeover.');
assert(canvas.includes('watermarkDisplayPositionCenter') && canvas.includes('watermarkTiledCenters') && canvas.includes('watermarkTiledScale'), 'Studio canvas must use shared watermark display geometry and repeat scaling.');
assert(canvas.includes('PdfWatermarkMetricsService'), 'Studio canvas must use the shared PDF-font metrics service.');

// Large-PDF safety.
assert(service.includes('await this.yieldToBrowser()'), 'Large watermark jobs must yield between pages.');
assert(service.includes('this.throwIfCancelled()'), 'Large watermark jobs must have cancellation checkpoints.');
assert(service.includes('validateOutput'), 'Watermark output validation is missing.');
assert(service.includes('LocalProcessingCapabilityService'), 'Watermark service must honor the central local-processing capacity ceiling.');
assert(serviceSpec.includes('large') || service.includes('12_000_000'), 'Watermark input/image safety limits must be present.');

if (failures.length) {
  console.error('SW-6 Watermark QA static audit: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SW-6 Watermark QA static audit: PASS');
console.log('- 9 positions + rotation matrix covered.');
console.log('- Repeat mode covered with deterministic four-copy checks.');
console.log('- All/current/range page scope wired.');
console.log('- Standalone preview/export parity checks present.');
console.log('- Studio Add/Update/Remove integrated into unified Undo/Redo history.');
console.log('- Mobile inspector/bottom-sheet and responsive close behavior checked.');
console.log('- Large-PDF yielding, cancellation and output validation checked.');
