import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { ToolGuide } from '../../../config/tool-guides.config';
import { GUIDE_PRESENTATION } from './tool-guide.presentation';

@Component({
  selector: 'app-tool-guide',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './tool-guide.component.html',
  styleUrl: './tool-guide.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolGuideComponent {
  @Input({ required: true }) guide!: ToolGuide;
  @Input({ required: true }) slug!: string;
  get presentation() { return GUIDE_PRESENTATION[this.slug] ?? GUIDE_PRESENTATION['compress-pdf']; }
}
