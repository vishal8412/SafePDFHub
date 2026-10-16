import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { ToolGuide } from '../../../config/tool-guides.config';
import { GUIDE_PRESENTATION } from './tool-guide.presentation';
import { TOOL_DISCOVERY } from '../../../config/tool-discovery.config';
import { TOOLS } from '../../../config/tools.config';
import { KNOWLEDGE_GUIDES } from '../../../config/knowledge-guides.config';

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
  get discovery() { return TOOL_DISCOVERY[this.slug]; }
  get relatedGuides() {
    const guides = KNOWLEDGE_GUIDES.filter(guide => guide.tools.includes(this.slug));
    return guides.length ? guides.slice(0, 3) : KNOWLEDGE_GUIDES.filter(guide => guide.slug === 'private-pdf-tools');
  }
  get relatedTools() {
    const slugs = TOOLS.find(tool => tool.slug === this.slug)?.nextTools ?? [];
    return slugs.flatMap(slug => TOOLS.filter(tool => tool.slug === slug));
  }
}
