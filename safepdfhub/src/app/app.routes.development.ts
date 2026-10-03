import { isDevMode } from '@angular/core';
import { Routes } from '@angular/router';

export const developmentRoutes: Routes = [
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
    path: '__dev/qpdf-runtime-investigation',
    canMatch: [() => isDevMode()],
    loadComponent: () =>
      import('./pages/dev/qpdf-runtime-investigation/qpdf-runtime-investigation.component')
        .then(m => m.QpdfRuntimeInvestigationComponent)
  },
];
