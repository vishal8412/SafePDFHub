import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { SignatureBuilderComponent } from '../../signing/signature-builder/signature-builder.component';
import type { SigningAsset, SigningAssetKind, SigningFieldKind } from '../../../core/signing/models/signing.models';

@Component({
  selector: 'app-studio-signing-dialog',
  standalone: true,
  imports: [SignatureBuilderComponent],
  templateUrl: './studio-signing-dialog.component.html',
  styleUrl: './studio-signing-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudioSigningDialogComponent {
  @Input() kind: SigningAssetKind = 'signature';
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly signed = new EventEmitter<SigningAsset>();
  @Output() readonly fieldSelected = new EventEmitter<SigningFieldKind>();

  showBuilder = false;
  builderKind: SigningAssetKind = 'signature';
  readonly fieldItems: readonly { kind: SigningFieldKind; label: string; description: string; icon: string }[] = [
    { kind: 'signature', label: 'Signature', description: 'Your full signing mark', icon: '✍' },
    { kind: 'initials', label: 'Initials', description: 'Short mark for initialing', icon: 'AB' },
    { kind: 'text', label: 'Text', description: 'Add custom text', icon: 'T' },
    { kind: 'date', label: 'Date', description: 'Add a signing date', icon: '▣' },
    { kind: 'checkbox', label: 'Checkbox', description: 'Add a check field', icon: '☑' },
  ];

  choose(kind: SigningFieldKind): void {
    if (kind === 'signature' || kind === 'initials') {
      this.builderKind = kind;
      this.showBuilder = true;
      return;
    }
    this.fieldSelected.emit(kind);
  }

  created(asset: SigningAsset): void {
    this.signed.emit(asset);
  }
}
