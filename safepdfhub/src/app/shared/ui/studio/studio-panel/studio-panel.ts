import {
  ChangeDetectionStrategy,
  Component,
  input
} from '@angular/core';

@Component({
  selector: 'app-studio-panel',
  standalone: true,
  templateUrl: './studio-panel.html',
  styleUrls: ['./studio-panel.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudioPanelComponent {

  readonly title = input('');

}