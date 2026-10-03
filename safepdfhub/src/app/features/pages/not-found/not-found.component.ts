import { Component, inject, RESPONSE_INIT } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `<main><h1>Page not found</h1><p>This address does not match an available page or PDF tool.</p><a routerLink="/">Explore SafePDFHub PDF tools</a></main>`,
  styles: [`main { max-width: 800px; margin: 6rem auto; padding: 2rem; } h1 { font-size: 2.5rem; } p { margin: 1.5rem 0; }`]
})
export class NotFoundComponent {
  constructor() {
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) response.status = 404;
  }
}
