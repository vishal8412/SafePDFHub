import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class HomeSectionNavigationService {
  private readonly router = inject(Router);
  private navigationRequestId = 0;

  /**
   * Navigate to a Home-page section and place that section directly below
   * the sticky site header.
   *
   * This deliberately owns the whole operation instead of relying on native
   * hash scrolling. A navigation from a long tool page can otherwise carry
   * the previous document scroll offset into the newly rendered Home page.
   */
  navigateToSection(event: Event, fragment: string): void {
    event.preventDefault();

    const requestId = ++this.navigationRequestId;
    const currentPath = this.router.url.split('#')[0].split('?')[0] || '/';

    // Clear the previous route's scroll position before replacing its content.
    // This prevents the browser/router from carrying a tool-page offset into
    // the Home page while the lazy Home component is being rendered.
    this.resetScrollPosition();

    const navigation = currentPath === '/'
      ? this.router.navigate([], { fragment })
      : this.router.navigate(['/'], { fragment });

    void navigation.then(success => {
      if (!success || requestId !== this.navigationRequestId) {
        return;
      }

      void this.waitForStableTarget(fragment, requestId);
    });
  }

  private async waitForStableTarget(
    fragment: string,
    requestId: number
  ): Promise<void> {
    const target = await this.waitForTarget(fragment, requestId);

    if (!target || requestId !== this.navigationRequestId) {
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

    // Allow Angular, the browser, and lazy Home content to complete layout.
    await this.nextFrame();
    await this.nextFrame();
    await this.nextFrame();

    if (requestId !== this.navigationRequestId) {
      return;
    }

    this.scrollToTarget(target);
  }

  private waitForTarget(
    fragment: string,
    requestId: number
  ): Promise<HTMLElement | null> {
    const maxAttempts = 120;
    let attempts = 0;

    return new Promise(resolve => {
      const check = () => {
        if (requestId !== this.navigationRequestId) {
          resolve(null);
          return;
        }

        const target = document.getElementById(fragment);

        if (target && target.isConnected) {
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

  private resetScrollPosition(): void {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'auto'
    });

    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
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
