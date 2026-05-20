import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output
} from '@angular/core';

import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dialog.component.html',
  styleUrls: ['./dialog.component.scss']
})
export class DialogComponent {
@HostListener('document:keydown.escape')

  @Input() type:'danger' | 'info' | 'success' = 'info';

  @Input() open = false;

  @Input() title = '';

  @Input() message = '';

  @Input() confirmText = 'Confirm';

  @Input() cancelText = 'Cancel';

  @Input() danger = false;

  @Output() confirm = new EventEmitter<void>();

  @Output() close = new EventEmitter<void>();

  onEscape() {
    this.close.emit();
  }

}