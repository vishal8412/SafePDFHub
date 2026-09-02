import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/pages/home/home.component')
        .then(m => m.HomeComponent)
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