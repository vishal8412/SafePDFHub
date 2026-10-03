import { TOOLS } from './config/tools.config';
import { Component, DestroyRef, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { HeaderComponent } from './shared/header/header.component';
import { FooterComponent } from './shared/footer/footer.component';
import { LoaderComponent } from './shared/components/loader/loader.component';
import { ToastComponent } from './shared/components/toast/toast.component';
import { SeoService } from './core/services/seo.service';

@Component({
  selector: 'app-root',
  imports: [HeaderComponent, FooterComponent, RouterOutlet, LoaderComponent, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly seo = inject(SeoService);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Angular's in-memory scrolling is configured globally, but a client-side
   * navigation from a long Home-page section can retain the previous document
   * offset during hydration/rendering. Explicitly normalize non-fragment route
   * navigations after the new view has had two browser frames to render.
   *
   * Fragment navigation is deliberately excluded because HomeSectionNavigationService
   * owns those destinations and calculates the header offset itself.
   */
  private restoreRouteScrollPosition(url: string): void {
    if (!isPlatformBrowser(this.platformId) || url.includes('#')) {
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      });
    });
  }


  constructor() {
    this.seo.updateSiteDefaults();

    // Run on both SSR and the browser so public static pages receive their
    // page-specific metadata in the server-rendered HTML as well as after
    // client-side navigation. ToolComponent owns tool-specific SEO.
    const navigationEndSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => {
        const url = event.urlAfterRedirects;

        if (!TOOLS.some(tool => url.split(/[?#]/)[0].replace(/\/+$/, '') === `/tools/${tool.slug}`)) {
          this.seo.updateForUrl(url);
        }

        this.restoreRouteScrollPosition(url);
      });

    this.destroyRef.onDestroy(() => {
      navigationEndSubscription.unsubscribe();
    });

  }


}
