import { unsavedWorkGuard } from '../../core/guards/unsaved-work.service';
import { Routes } from '@angular/router';

export const STUDIO_ROUTES: Routes = [
  {
    path: '',
    canDeactivate: [unsavedWorkGuard],
    loadComponent: () =>
      import('./shell/studioShell/studio-shell.component')
        .then(m => m.StudioShellComponent)
  }
];