import { describe, it, expect, vi } from 'vitest';
import { PdfSecurityFormComponent } from './pdf-security-form.component';

describe('Optional password character mix', () => {
  for (const password of ['abcdefgh', '12345678', 'a long lowercase passphrase']) {
    it(`submits a matching single-category password of length ${password.length}`, () => {
      const form = new PdfSecurityFormComponent();
      form.password = password; form.confirmPassword = password; form.passwordTouched = true;
      expect(form.formValid).toBe(true);
      expect(form.passwordValidationMessage).toBeNull();
      const emit = vi.spyOn(form.submitted, 'emit'); form.submit();
      expect(emit).toHaveBeenCalledWith(expect.objectContaining({ password, confirmPassword: password }));
    });
  }
  it('still blocks short, control-character, whitespace-only and mismatched passwords', () => {
    const form = new PdfSecurityFormComponent();
    for (const password of ['short','        ','abcdefgh\n','a'.repeat(129)]) {
      form.password = password;form.confirmPassword = password;expect(form.formValid).toBe(false);
    }
    form.password='abcdefgh';form.confirmPassword='different';expect(form.formValid).toBe(false);
  });
  it('does not apply protect length rules when opening an existing PDF', () => {
    const form = new PdfSecurityFormComponent();form.mode='unlock';form.password='a';form.passwordTouched=true;
    expect(form.passwordValidationMessage).toBeNull();expect(form.formValid).toBe(true);
  });
});
