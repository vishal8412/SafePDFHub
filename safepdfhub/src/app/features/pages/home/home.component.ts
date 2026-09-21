import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface HomeTool {
  name: string;
  description: string;
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
    { name: 'Compress PDF', description: 'Reduce PDF file size', mark: 'C', route: '/tools/compress-pdf' },
    { name: 'Merge PDF', description: 'Combine multiple PDFs', mark: 'M', route: '/tools/merge-pdf' },
    { name: 'Split PDF', description: 'Extract pages from a PDF', mark: 'S', route: '/tools/split-pdf' },
    { name: 'Protect PDF', description: 'Add password protection', mark: 'P', route: '/tools/protect-pdf' },
    { name: 'Unlock PDF', description: 'Remove password protection', mark: 'U', route: '/tools/unlock-pdf' },
    { name: 'Sign PDF', description: 'Add a signature and fill fields', mark: '✍', route: '/tools/sign-pdf' }
  ];
}
