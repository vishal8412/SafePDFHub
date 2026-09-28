import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

import { TOOLS } from '../../config/tools.config';
import { HomeSectionNavigationService } from '../services/home-section-navigation.service';
import { AppIcons } from '../icons';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    LucideAngularModule
  ],
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss']
})
export class FooterComponent {

  readonly icons = AppIcons;

  private readonly homeSectionNavigation =
    inject(HomeSectionNavigationService);

  navigateToHomeSection(
    event: Event,
    fragment: string
  ): void {
    this.homeSectionNavigation.navigateToSection(
      event,
      fragment
    );
  }

  readonly toolsSeo = TOOLS.map(tool => ({
    slug: tool.slug,
    label: tool.label
  }));
}