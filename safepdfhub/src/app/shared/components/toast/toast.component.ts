import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast.component.html',
  styleUrls: ['./toast.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ToastComponent {

  private toastService = inject(ToastService);

  toasts = this.toastService.toasts;

  // track hover to pause animation
  hovered = signal<number | null>(null);

  remove(id: number) {
    this.toastService.remove(id);
  }

  trackById(index: number, item: any) {
    return item.id;
  }

  onEnter(id: number) {
  this.hovered.set(id);
  this.toastService.pause(id);   // ✅ ADD
}

onLeave() {
  const id = this.hovered();
  if (id) {
    this.toastService.resume(id); // ✅ ADD
  }
  this.hovered.set(null);
}

handleAction(event: MouseEvent, action: any, id: number) {
  event.stopPropagation(); // prevent remove on click
  action.action();
  this.remove(id);
}

}