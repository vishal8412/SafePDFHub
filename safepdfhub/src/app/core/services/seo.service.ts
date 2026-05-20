import { Injectable } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';

@Injectable({ providedIn: 'root' })
export class SeoService {
  update(title: string, desc: string, keywords: string = '') {
    document.title = title;

    const metaTag = document.querySelector('meta[name="description"]');
    if (metaTag) {
      metaTag.setAttribute('content', desc);
    }

    if (keywords) {
      const keyTag = document.querySelector('meta[name="keywords"]');
      if (keyTag) keyTag.setAttribute('content', keywords);
    }
  }
}