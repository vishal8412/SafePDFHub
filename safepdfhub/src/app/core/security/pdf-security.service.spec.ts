import { describe, it, expect, vi } from 'vitest';
import { PdfSecurityService } from './pdf-security.service';
const permissions = {allowPrinting:true,allowCopying:true,allowModifying:false,allowAnnotations:true,allowForms:true,allowAssembly:false};
describe('Protect password policy at the service boundary', () => {
  it('allows lowercase and number-only passwords through to the protection engine', async () => {
    const file = new File(['fixture'], 'test.pdf');
    const protect = vi.fn(async()=>({file,mode:'protect',durationMs:1}));
    const service = new PdfSecurityService({} as never, { supported:true, protect } as never);
    for(const password of ['abcdefgh','12345678','a long lowercase passphrase']) {
      await service.protect(file,{userPassword:password,permissions});
      expect(protect).toHaveBeenLastCalledWith(file,expect.objectContaining({userPassword:password}),undefined);
    }
  });
  it('rejects invalid passwords before invoking the engine', async () => {
    const protect=vi.fn();const service=new PdfSecurityService({} as never,{supported:true,protect} as never);
    for(const password of ['short','        ','abcdefgh\n','a'.repeat(129)]) {
      await expect(service.protect(new File(['fixture'],'test.pdf'),{userPassword:password,permissions})).rejects.toMatchObject({code:'PASSWORD_INVALID'});
    }
    expect(protect).not.toHaveBeenCalled();
  });
});
