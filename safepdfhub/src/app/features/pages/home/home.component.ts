import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {

  tools = [
    { name: 'Compress PDF', icon: '📉', route: '/compress-pdf' },
    { name: 'Merge PDF', icon: '📎', route: '/merge-pdf' },
    { name: 'Split PDF', icon: '✂️', route: '/split-pdf' },
    { name: 'PDF to Word', icon: '📄', route: '/pdf-to-word' },
    { name: 'Word to PDF', icon: '📝', route: '/word-to-pdf' },
    { name: 'PDF to JPG', icon: '🖼️', route: '/pdf-to-jpg' },
    { name: 'JPG to PDF', icon: '📷', route: '/jpg-to-pdf' },
    { name: 'Rotate PDF', icon: '🔄', route: '/rotate-pdf' },
    { name: 'Add Watermark', icon: '💧', route: '/watermark' },
    { name: 'Unlock PDF', icon: '🔓', route: '/unlock-pdf' },
    { name: 'Protect PDF', icon: '🔐', route: '/protect-pdf' },
    { name: 'Sign PDF', icon: '✍️', route: '/sign-pdf' }
  ];
}