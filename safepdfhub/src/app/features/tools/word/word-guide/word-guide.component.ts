import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { ToolGuide } from '../../../../config/tool-guides.config';

@Component({
  selector: 'app-word-guide',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './word-guide.component.html',
  styleUrl: './word-guide.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WordGuideComponent {
  @Input({ required: true }) guide!: ToolGuide;
}
