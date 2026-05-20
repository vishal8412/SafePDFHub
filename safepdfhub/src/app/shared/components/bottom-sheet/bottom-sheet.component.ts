import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output
} from '@angular/core';

import { CommonModule } from '@angular/common';

import {
  LucideAngularModule
} from 'lucide-angular';

@Component({
  selector: 'app-bottom-sheet',
  standalone: true,
  imports: [
    CommonModule,
    LucideAngularModule
  ],
  templateUrl: './bottom-sheet.component.html',
  styleUrls: ['./bottom-sheet.component.scss']
})
export class BottomSheetComponent {

  @Input() open = false;

  @Input() title = '';

  @Input() actions: {
    label: string;
    icon?: any;
    danger?: boolean;
    action: () => void;
  }[] = [];

  @Output() close =
    new EventEmitter<void>();

  startY = 0;
  currentY = 0;

  onTouchStart(event: TouchEvent) {
    this.startY = event.touches[0].clientY;
  }

  onTouchMove(event: TouchEvent) {
    this.currentY =
      event.touches[0].clientY;
  }

  onTouchEnd() {

    const diff =
      this.currentY - this.startY;

    if (diff > 90) {
      this.close.emit();
    }

    this.startY = 0;
    this.currentY = 0;
  }

  runAction(fn: () => void) {
    fn();
    this.close.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.close.emit();
  }
}