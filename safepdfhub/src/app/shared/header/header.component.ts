import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { HomeSectionNavigationService } from '../services/home-section-navigation.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterModule, CommonModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  mobileMenuOpen = false;
  private readonly homeSectionNavigation = inject(HomeSectionNavigationService);

  navigateToHomeSection(event: Event, fragment: string): void {
    this.homeSectionNavigation.navigateToSection(event, fragment);
    this.mobileMenuOpen = false;
  }

}