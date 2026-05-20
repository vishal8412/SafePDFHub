import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/pages/home/home.component')
        .then(m => m.HomeComponent)
  },
  // {
  //   path: 'compress-pdf',
  //   loadComponent: () =>
  //     import('./features/tools/compress-pdf/compress-pdf.component')
  //       .then(m => m.CompressPdfComponent)
  // },
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