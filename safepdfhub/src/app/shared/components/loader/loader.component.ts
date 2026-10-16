import { Component, inject, ElementRef, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoaderService } from '../../services/loader.service';

@Component({
  selector: 'app-loader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loader.component.html',
  styleUrl: './loader.component.scss'
})
export class LoaderComponent {
  loader = inject(LoaderService);
  private previousFocus: HTMLElement | null = null;
  @ViewChild('panel') set panel(element: ElementRef<HTMLElement> | undefined) {
    if (element) {
      this.previousFocus = document.activeElement as HTMLElement;
      element.nativeElement.focus();
    } else if (this.previousFocus?.isConnected) {
      this.previousFocus.focus();
      this.previousFocus = null;
    }
  }
  @HostListener('document:keydown', ['$event'])
  containFocus(event: KeyboardEvent): void {
    if (!this.loader.loading() || event.key !== 'Tab') return;
    event.preventDefault();
    const panel = document.querySelector<HTMLElement>('.app-loader .loader-content');
    (panel?.querySelector<HTMLButtonElement>('button') ?? panel)?.focus();
  }

  get elapsedLabel(): string {
    const seconds = this.loader.elapsedSeconds();
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  }
}
