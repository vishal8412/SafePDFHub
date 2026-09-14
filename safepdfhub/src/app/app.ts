import { Component, DestroyRef, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { HeaderComponent } from './shared/header/header.component';
import { FooterComponent } from './shared/footer/footer.component';
import { LoaderComponent } from './shared/components/loader/loader.component';
import { ToastComponent } from './shared/components/toast/toast.component';

@Component({
  selector: 'app-root',
  imports: [HeaderComponent, FooterComponent, RouterOutlet, LoaderComponent, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('pdfsnapkit');

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private pendingImperativeNavigation = false;

  constructor() {
    if (!this.isBrowser) {
      return;
    }

    const navigationStartSubscription = this.router.events
      .pipe(filter((event): event is NavigationStart => event instanceof NavigationStart))
      .subscribe(event => {
        // Only force the top for normal link/programmatic navigation.
        // Browser back/forward navigation keeps Angular's saved scroll position.
        this.pendingImperativeNavigation = event.navigationTrigger === 'imperative';
      });

    const navigationEndSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => {
        if (!this.pendingImperativeNavigation || event.urlAfterRedirects.includes('#')) {
          return;
        }

        this.scrollToTopAfterRouteRender();
        this.pendingImperativeNavigation = false;
      });

    this.destroyRef.onDestroy(() => {
      navigationStartSubscription.unsubscribe();
      navigationEndSubscription.unsubscribe();
    });
  }

  /**
   * Angular's in-memory scroller can run before a lazy route has finished
   * rendering. The browser can then preserve/anchor the old viewport while
   * the new page is inserted into <router-outlet>. Run after the route has
   * rendered so the final viewport is definitely at the top.
   */
  private scrollToTopAfterRouteRender(): void {
    const scrollToTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

      // Keep both common document scroll roots in sync.
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    requestAnimationFrame(() => {
      scrollToTop();

      // A second frame covers lazy-component/template layout that completes
      // immediately after the first paint.
      requestAnimationFrame(scrollToTop);
    });
  }
}
