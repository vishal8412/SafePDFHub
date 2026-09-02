import { Routes } from '@angular/router';

export const STUDIO_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./shell/studioShell/studio-shell.component')
        .then(m => m.StudioShellComponent)
  }
];