import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { OperationResultComponent } from '../../../../shared/components/operation-result/operation-result.component';

@Component({
  selector: 'app-sign-pdf-result',
  standalone: true,
  imports: [OperationResultComponent],
  templateUrl: './sign-pdf-result.component.html',
  styleUrl: './sign-pdf-result.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignPdfResultComponent {
  @Input({ required: true }) file!: File;
  @Input() originalFileName = '';
  @Input() durationMs = 0;

  @Output() readonly download = new EventEmitter<void>();
  @Output() readonly processAnother = new EventEmitter<void>();
  @Output() readonly editAgain = new EventEmitter<void>();
}
