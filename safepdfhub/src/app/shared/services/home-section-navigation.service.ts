import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class HomeSectionNavigationService {
  private readonly router = inject(Router);

  navigateToSection(event: Event, fragment: string): void {
    event.preventDefault();

    const currentPath = this.router.url.split('#')[0].split('?')[0] || '/';

    if (currentPath === '/') {
      // The Home component is already mounted. Do not rely on Angular's
      // anchor-scrolling timing; scroll after the browser has a stable layout.
      void this.router.navigate([], { fragment }).finally(() => {
        this.scheduleScroll(fragment);
      });
      return;
    }

    // Navigate to Home first. The Home component is lazy-loaded, so the
    // scroll is scheduled after navigation and again on the next frame.
    void this.router.navigate(['/'], { fragment }).finally(() => {
      this.scheduleScroll(fragment);
    });
  }

  private scheduleScroll(fragment: string): void {
    let attempts = 0;
    const tryScroll = () => {
      attempts += 1;
      const target = document.getElementById(fragment);

      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest'
        });
        return;
      }

      // The Home page is lazy-loaded. Give Angular a few frames to finish
      // inserting the section before giving up.
      if (attempts < 12) {
        requestAnimationFrame(tryScroll);
      }
    };

    requestAnimationFrame(() => requestAnimationFrame(tryScroll));
  }
}
