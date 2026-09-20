import {
  Component,
  Input,
  inject,
  Output,
  EventEmitter
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { RouterModule } from '@angular/router';
import { HomeSectionNavigationService } from '../../services/home-section-navigation.service';

export interface ActionPanelAction {
  id: string;
  /** Lucide icon definition consumed by <lucide-icon [img]> */
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
  imports: [CommonModule, LucideAngularModule, RouterModule],
  templateUrl: './action-panel.component.html',
  styleUrls: ['./action-panel.component.scss']
})
export class ActionPanelComponent {

  private readonly homeSectionNavigation = inject(HomeSectionNavigationService);

  navigateToHomeSection(event: Event, fragment: string): void {
    this.homeSectionNavigation.navigateToSection(event, fragment);
  }

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