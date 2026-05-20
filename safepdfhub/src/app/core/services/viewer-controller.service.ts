import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ViewerControllerService {

  showViewer = false;

  viewerPages: string[] = [];

  viewerLoading = false;

  zoom = 1;

  open(
    pages: string[]
  ) {

    this.showViewer = true;

    this.viewerPages = pages;
  }

  close() {

    this.viewerPages.forEach(page => {

      if (page.startsWith('blob:')) {
        URL.revokeObjectURL(page);
      }

    });

    this.showViewer = false;
    this.viewerPages = [];
  }

  zoomIn() {
    this.zoom += 0.2;
  }

  zoomOut() {

    if (this.zoom > 0.4) {
      this.zoom -= 0.2;
    }
  }
}