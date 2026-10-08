import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SignatureBuilderComponent } from './signature-builder.component';
import { SignatureAssetService } from '../../../core/signing/services/signature-asset.service';

describe('signature builder creation lifecycle',()=>{
 it('previews an import and emits it only after Use signature',async()=>{
   const asset={id:'one',kind:'signature',dataUrl:'data:image/png;base64,AA=='};
   TestBed.configureTestingModule({providers:[{provide:SignatureAssetService,useValue:{createUploadedAsset:async()=>asset}}]});
   const fixture=TestBed.createComponent(SignatureBuilderComponent),c=fixture.componentInstance;
   c.mode='upload';const emit=vi.spyOn(c.created,'emit');
   await c.onImageSelected({target:{files:[new File(['x'],'sign.png')],value:'x'}} as any);
   expect(c.importedAsset).toBe(asset);expect(emit).not.toHaveBeenCalled();expect(c.canUseSignature).toBe(true);
   await c.useSignature();expect(emit).toHaveBeenCalledWith(asset);
 });
 it('does not emit a late result after Cancel destroys the builder',async()=>{
   let resolve!: (v:any)=>void;
   TestBed.configureTestingModule({providers:[{provide:SignatureAssetService,useValue:{createTypedAsset:()=>new Promise(r=>resolve=r)}}]});
   const fixture=TestBed.createComponent(SignatureBuilderComponent),c=fixture.componentInstance;
   c.mode='type';c.typedValue='AB';const emit=vi.spyOn(c.created,'emit');
   const pending=c.useSignature();c.ngOnDestroy();resolve({id:'late'});await pending;expect(emit).not.toHaveBeenCalled();
 });
});
