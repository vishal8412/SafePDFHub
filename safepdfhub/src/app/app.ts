import { Component, DestroyRef, inject, signal } from '@angular/core';
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
  protected readonly title = signal('pdfsnapkit');

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly seo = inject(SeoService);


  constructor() {
    this.seo.updateSiteDefaults();

    // Run on both SSR and the browser so public static pages receive their
    // page-specific metadata in the server-rendered HTML as well as after
    // client-side navigation. ToolComponent owns tool-specific SEO.
    const navigationEndSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => {
        const url = event.urlAfterRedirects;

        if (!url.startsWith('/tools/')) {
          this.seo.updateForUrl(url);
        }
      });

    this.destroyRef.onDestroy(() => {
      navigationEndSubscription.unsubscribe();
    });

  }


}
