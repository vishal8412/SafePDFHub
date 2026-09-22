import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = {
  workspaceTs: 'src/app/features/tools/sign/sign-pdf-workspace/sign-pdf-workspace.component.ts',
  workspaceHtml: 'src/app/features/tools/sign/sign-pdf-workspace/sign-pdf-workspace.component.html',
  workspaceScss: 'src/app/features/tools/sign/sign-pdf-workspace/sign-pdf-workspace.component.scss',
  builderHtml: 'src/app/features/signing/signature-builder/signature-builder.component.html',
  builderScss: 'src/app/features/signing/signature-builder/signature-builder.component.scss',
};

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const source = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, read(value)]));

const checks = [
  ['Modal focus restoration', source.workspaceTs.includes('captureModalFocus') && source.workspaceTs.includes('restoreModalFocus')],
  ['Document scroll lock', source.workspaceTs.includes('document.body.style.overflow')],
  ['Retryable page-preview state', source.workspaceTs.includes('retryCurrentPage') && source.workspaceHtml.includes('Try again')],
  ['Toolbar accessibility', source.workspaceHtml.includes('role="toolbar"') && source.workspaceHtml.includes('aria-label="Signing tools"')],
  ['Page-navigation accessibility', source.workspaceHtml.includes('aria-label="Page navigation"')],
  ['Bulk dialog labelled heading', source.workspaceHtml.includes('aria-labelledby="bulk-dialog-title"') && source.workspaceHtml.includes('id="bulk-dialog-title"')],
  ['Signature-builder tab semantics', source.builderHtml.includes('role="tablist"') && source.builderHtml.includes('role="tab"') && source.builderHtml.includes('aria-selected')],
  ['Keyboard focus visibility', source.workspaceScss.includes(':focus-visible') && source.builderScss.includes(':focus-visible')],
  ['Coarse-pointer touch targets', source.workspaceScss.includes('min-width: 44px') && source.builderScss.includes('min-height: 44px')],
  ['Reduced-motion support', source.workspaceScss.includes('prefers-reduced-motion') && source.builderScss.includes('prefers-reduced-motion')],
  ['Safe-area support', source.workspaceScss.includes('safe-area-inset-bottom')],
  ['No private template property access', source.workspaceHtml.includes('hasSession') && !source.workspaceHtml.includes('{{ session') && !source.workspaceHtml.includes('@if (session)')],
];

const failed = checks.filter(([, ok]) => !ok);
console.log(`Sign PDF UX audit: ${failed.length ? 'FAIL' : 'PASS'}`);
for (const [name, ok] of checks) console.log(`- ${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) process.exitCode = 1;
