import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class HomeSectionNavigationService {
  private readonly router = inject(Router);

  /**
   * Navigate to a Home-page section and place that section directly below
   * the sticky site header. Native Angular anchor scrolling is intentionally
   * disabled for this application; this service owns the complete operation
   * so lazy-route rendering and layout shifts cannot move the viewport after
   * we calculate the destination.
   */
  navigateToSection(event: Event, fragment: string): void {
    event.preventDefault();

    const currentPath = this.router.url.split('#')[0].split('?')[0] || '/';
    const navigation = currentPath === '/'
      ? this.router.navigate([], { fragment })
      : this.router.navigate(['/'], { fragment });

    void navigation.then(() => this.waitForStableTarget(fragment));
  }

  private async waitForStableTarget(fragment: string): Promise<void> {
    const target = await this.waitForTarget(fragment);

    if (!target) {
      return;
    }

    // Fonts can change text metrics after the route has painted. Waiting for
    // them prevents the section from shifting after we calculate its position.
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // Font loading failure should never block section navigation.
      }
    }

    // Let Angular, the browser, and any lazy Home content finish their layout
    // work. Three consecutive frames also gives us a stable measurement point.
    await this.nextFrame();
    await this.nextFrame();
    await this.nextFrame();

    this.scrollToTarget(target);
  }

  private waitForTarget(fragment: string): Promise<HTMLElement | null> {
    const maxAttempts = 80;
    let attempts = 0;

    return new Promise(resolve => {
      const check = () => {
        const target = document.getElementById(fragment);

        if (target) {
          resolve(target);
          return;
        }

        attempts += 1;
        if (attempts >= maxAttempts) {
          resolve(null);
          return;
        }

        window.setTimeout(check, 25);
      };

      check();
    });
  }

  private nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  private scrollToTarget(target: HTMLElement): void {
    const header = document.querySelector<HTMLElement>('.site-header');
    const headerHeight = header?.getBoundingClientRect().height ?? 72;
    const topGap = 12;
    const targetTop = target.getBoundingClientRect().top + window.scrollY;
    const destination = Math.max(0, targetTop - headerHeight - topGap);

    window.scrollTo({
      top: destination,
      left: 0,
      behavior: 'auto'
    });

    document.documentElement.scrollTop = destination;
    document.body.scrollTop = destination;
  }
}
