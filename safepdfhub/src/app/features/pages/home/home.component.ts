import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { TOOLS, type Tool } from '../../../config/tools.config';
import { AppIcons } from '../../../shared/icons';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule, LucideAngularModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {
  readonly icons = AppIcons;

  /**
   * The public tool registry is the single source of truth for homepage tools.
   * Presentation order/labels/descriptions/icons live with the tool metadata.
   */
  readonly tools: Tool[] = [...TOOLS]
    .filter(tool => tool.displayOrder !== undefined)
    .sort((a, b) => (a.displayOrder ?? Number.MAX_SAFE_INTEGER) - (b.displayOrder ?? Number.MAX_SAFE_INTEGER));

  trackByToolSlug(_: number, tool: Tool): string {
    return tool.slug;
  }
}
