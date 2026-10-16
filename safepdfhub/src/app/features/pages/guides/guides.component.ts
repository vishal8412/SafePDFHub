import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { GUIDE_HUB, KNOWLEDGE_GUIDES } from '../../../config/knowledge-guides.config';
import { KNOWLEDGE_GUIDE_CONTENT } from '../../../config/knowledge-guide-content.config';
import { TOOLS } from '../../../config/tools.config';

@Component({
  selector: 'app-guides', standalone: true, imports: [CommonModule, RouterLink],
  templateUrl: './guides.component.html', styleUrl: './guides.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GuidesComponent {
  private readonly params = toSignal(inject(ActivatedRoute).paramMap);
  readonly guides = KNOWLEDGE_GUIDES;
  readonly hub = GUIDE_HUB;
  readonly guide = computed(() => this.guides.find(item => item.slug === this.params()?.get('slug')) ?? null);
  readonly content = computed(() => this.guide() ? KNOWLEDGE_GUIDE_CONTENT[this.guide()!.slug] : null);
  readonly tools = computed(() => (this.guide()?.tools ?? []).flatMap(slug => TOOLS.filter(tool => tool.slug === slug)));
  readonly related = computed(() => this.guides.filter(item => item.slug !== this.guide()?.slug && item.tools.some(slug => this.guide()?.tools.includes(slug))).slice(0, 3));
  readonly readMinutes = computed(() => {
    const content = this.content();
    const words = [this.guide()?.summary ?? '', ...(content?.steps ?? []), ...(content?.sections ?? []).flatMap(section => [section.title, ...section.paragraphs, ...(section.bullets ?? []), ...(section.table?.rows.flat() ?? [])])].join(' ').split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 220));
  });
}
