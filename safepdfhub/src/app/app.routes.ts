import { isDevMode } from '@angular/core';
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '__dev/qpdf-benchmark',
    canMatch: [() => isDevMode()],
    loadComponent: () =>
      import('./pages/dev/qpdf-benchmark/qpdf-benchmark.component')
        .then(m => m.QpdfBenchmarkComponent)
  },
  {
    path: '__dev/large-pdf-security-benchmark',
    canMatch: [() => isDevMode()],
    loadComponent: () =>
      import('./pages/dev/large-pdf-security-benchmark/large-pdf-security-benchmark.component')
        .then(m => m.LargePdfSecurityBenchmarkComponent)
  },
  {
    path: '__dev/sign-pdf-benchmark',
    canMatch: [() => isDevMode()],
    loadComponent: () =>
      import('./pages/dev/sign-pdf-benchmark/sign-pdf-benchmark.component')
        .then(m => m.SignPdfBenchmarkComponent)
  },
  {
    path: '__dev/qpdf-smoke',
    canMatch: [() => isDevMode()],
    loadComponent: () =>
      import('./pages/dev/qpdf-smoke/qpdf-smoke.component')
        .then(m => m.QpdfSmokeComponent)
  },
  {
    path: '',
    loadComponent: () =>
      import('./features/pages/home/home.component')
        .then(m => m.HomeComponent)
  },
  {
    path: 'support',
    loadComponent: () =>
      import('./features/pages/support/support.component')
        .then(m => m.SupportComponent)
  },
  {
    path: 'about',
    loadComponent: () =>
      import('./features/pages/about/about.component')
        .then(m => m.AboutComponent)
  },
  {
    path: 'contact',
    loadComponent: () =>
      import('./features/pages/contact/contact.component')
        .then(m => m.ContactComponent)
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('./features/pages/privacy/privacy.component')
        .then(m => m.PrivacyComponent)
  },
  {
    path: 'terms',
    loadComponent: () =>
      import('./features/pages/terms/terms.component')
        .then(m => m.TermsComponent)
  },
  {
    path: 'donate',
    redirectTo: 'support',
    pathMatch: 'full'
  },
  {
    path: 'remove-password',
    redirectTo: 'tools/unlock-pdf',
    pathMatch: 'full'
  },
  {
    path: 'studio',
    loadChildren: () =>
      import('./features/studio/studio.routes')
        .then(r => r.STUDIO_ROUTES)
  },

  // Canonical SEO tool URLs.
  {
    path: 'tools/:slug',
    loadComponent: () =>
      import('./pages/tool/tool.component')
        .then(m => m.ToolComponent)
  },

  // Legacy internal route used by earlier navigation code.
  {
    path: 'tool/:slug',
    redirectTo: 'tools/:slug',
    pathMatch: 'full'
  },

  // Legacy public tool URLs. The SSR server also returns HTTP 301 for these.
  {
    path: 'compress-pdf',
    redirectTo: 'tools/compress-pdf',
    pathMatch: 'full'
  },
  {
    path: 'merge-pdf',
    redirectTo: 'tools/merge-pdf',
    pathMatch: 'full'
  },
  {
    path: 'split-pdf',
    redirectTo: 'tools/split-pdf',
    pathMatch: 'full'
  },
  {
    path: 'protect-pdf',
    redirectTo: 'tools/protect-pdf',
    pathMatch: 'full'
  },
  { path: 'sign-pdf', redirectTo: 'tools/sign-pdf', pathMatch: 'full' },
  {
    path: 'unlock-pdf',
    redirectTo: 'tools/unlock-pdf',
    pathMatch: 'full'
  },
  // Reserved legacy URL for a not-yet-implemented tool. Keep it out of the
  // public SEO inventory instead of rendering an incomplete tool page.
  {
    path: 'pdf-to-word',
    redirectTo: '',
    pathMatch: 'full'
  },

  // Keep the existing fallback behavior for unknown slugs.
  {
    path: ':slug',
    loadComponent: () =>
      import('./pages/tool/tool.component')
        .then(m => m.ToolComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
