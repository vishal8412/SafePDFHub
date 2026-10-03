import { developmentRoutes } from './app.routes.development';
import { Routes } from '@angular/router';
import { TOOLS } from './config/tools.config';

export const routes: Routes = [
  ...developmentRoutes,
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
    canMatch: [(_route, segments) => TOOLS.some(tool => tool.slug === segments[1]?.path)],
    loadComponent: () =>
      import('./pages/tool/tool.component')
        .then(m => m.ToolComponent)
  },

  // Legacy internal route used by earlier navigation code.
  {
    path: 'tool/:slug',
    canMatch: [(_route, segments) => TOOLS.some(tool => tool.slug === segments[1]?.path)],
    loadComponent: () => import('./pages/tool/tool.component').then(m => m.ToolComponent),
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
  { path: 'watermark-pdf', redirectTo: 'tools/watermark-pdf', pathMatch: 'full' },
  {
    path: '**',
    loadComponent: () => import('./features/pages/not-found/not-found.component').then(m => m.NotFoundComponent)
  }
];
