import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { HomeSectionNavigationService } from '../services/home-section-navigation.service';
import { AppIcons } from '../icons';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterModule, CommonModule, LucideAngularModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  readonly icons = AppIcons;
  mobileMenuOpen = false;
  private readonly homeSectionNavigation = inject(HomeSectionNavigationService);

  navigateToHomeSection(event: Event, fragment: string): void {
    this.homeSectionNavigation.navigateToSection(event, fragment);
    this.mobileMenuOpen = false;
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }
}
