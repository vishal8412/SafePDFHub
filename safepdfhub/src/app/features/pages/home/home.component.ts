import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface HomeTool {
  name: string;
  mark: string;
  route: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})

export class HomeComponent {
  readonly tools: HomeTool[] = [
    { name: 'Compress PDF', mark: 'C', route: '/compress-pdf' },
    { name: 'Merge PDF', mark: 'M', route: '/merge-pdf' },
    { name: 'Split PDF', mark: 'S', route: '/split-pdf' }
  ];
}
