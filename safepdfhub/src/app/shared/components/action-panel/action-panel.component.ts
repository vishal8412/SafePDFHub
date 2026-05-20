import {
  Component,
  Input,
  Output,
  EventEmitter
} from '@angular/core';

import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-action-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './action-panel.component.html',
  styleUrls: ['./action-panel.component.scss']
})
export class ActionPanelComponent {

  @Input() title = '';

  @Input() subtitle = '';

  @Input() trustItems: string[] = [];

  @Input() actions: {
    id: string;
    icon: string;
    title: string;
    desc: string;
    primary?: boolean;
  }[] = [];

  @Output() actionClick =
    new EventEmitter<string>();

}