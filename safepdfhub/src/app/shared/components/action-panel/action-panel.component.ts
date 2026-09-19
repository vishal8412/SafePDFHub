import {
  Component,
  Input,
  Output,
  EventEmitter
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

export interface ActionPanelAction {
  id: string;
  icon: any;
  title: string;
  desc: string;
  primary?: boolean;
}

export interface ActionPanelTrustItem {
  icon: 'local' | 'speed' | 'device';
  title: string;
}

@Component({
  selector: 'app-action-panel',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './action-panel.component.html',
  styleUrls: ['./action-panel.component.scss']
})
export class ActionPanelComponent {

  trackByActionId(_: number, action: ActionPanelAction): string {
    return action.id;
  }

  trackByTrustIcon(_: number, item: ActionPanelTrustItem): string {
    return item.icon;
  }

  @Input() title = '';

  @Input() subtitle = '';

  @Input() trustItems: ActionPanelTrustItem[] = [];

  @Input() actions: ActionPanelAction[] = [];

  @Input() viewAllLabel = 'View all PDF tools';

  @Output() actionClick = new EventEmitter<string>();

  @Output() viewAllClick = new EventEmitter<void>();

}