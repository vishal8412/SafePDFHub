import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SignatureAssetService } from './signature-asset.service';
import { SigningStateService } from './signing-state.service';
import type { SigningAsset } from '../models/signing.models';

@Component({
  standalone: true,
  template: '',
  providers: [SigningStateService, SignatureAssetService],
})
class SigningSessionHost {}

const asset: SigningAsset = {
  id: 'scoped-asset',
  kind: 'signature',
  source: 'drawn',
  dataUrl: 'data:image/png;base64,AA==',
  mimeType: 'image/png',
  naturalWidth: 100,
  naturalHeight: 40,
  createdAt: 1,
};

describe('Signing session DI scope', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('creates a separate signing state for each workflow host', async () => {
    await TestBed.configureTestingModule({}).compileComponents();

    const first = TestBed.createComponent(SigningSessionHost);
    const second = TestBed.createComponent(SigningSessionHost);

    const firstState = first.componentRef.injector.get(SigningStateService);
    const secondState = second.componentRef.injector.get(SigningStateService);

    expect(firstState).not.toBe(secondState);

    firstState.addAsset(asset);

    expect(firstState.assets()).toHaveLength(1);
    expect(secondState.assets()).toHaveLength(0);
  });

  it('creates a separate signature asset service per workflow host', async () => {
    await TestBed.configureTestingModule({}).compileComponents();

    const first = TestBed.createComponent(SigningSessionHost);
    const second = TestBed.createComponent(SigningSessionHost);

    const firstAssets = first.componentRef.injector.get(SignatureAssetService);
    const secondAssets = second.componentRef.injector.get(SignatureAssetService);

    expect(firstAssets).not.toBe(secondAssets);
  });
});
