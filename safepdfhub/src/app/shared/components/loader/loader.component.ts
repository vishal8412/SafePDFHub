import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoaderService } from '../../services/loader.service';

@Component({
  selector: 'app-loader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loader.component.html',
  styleUrl: './loader.component.scss'
})
export class LoaderComponent {
  loader = inject(LoaderService);

//   hide() {
//    this._text.set('Done ✓');

//    setTimeout(() => {
//     this._loading.set(false);
//    }, 400);
//  }

}