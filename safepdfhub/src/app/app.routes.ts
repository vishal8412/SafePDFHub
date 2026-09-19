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
    redirectTo: 'unlock-pdf',
    pathMatch: 'full'
  },
  // Studio routes
  {
    path: 'studio',
    loadChildren: () =>
        import('./features/studio/studio.routes')
            .then(r => r.STUDIO_ROUTES)
  },
  // 🔥 SEO ROUTE
  {
    path: ':slug',
    loadComponent: () =>
      import('./pages/tool/tool.component')
        .then(m => m.ToolComponent)
  },
  // fallback
  {
    path: '**',
    redirectTo: ''
  }
];