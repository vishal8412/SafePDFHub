import { OperationResultComponent } from './operation-result.component';
describe('result file-size units', () => {
  it('matches the browser binary convention while retaining exact bytes', () => {
    const c = new OperationResultComponent();
    c.file = {size:11030000,name:'edited.pdf'} as File;
    c.sizeUnitSystem='binary';
    expect(c.sizeLabel).toBe('10.5 MB');
    expect(c.sizeTooltip).toBe('11,030,000 bytes · 1 MB = 1,048,576 bytes');
  });
  it('keeps decimal formatting for existing tools', () => {
    const c=new OperationResultComponent();c.file={size:11030000} as File;
    expect(c.sizeLabel).toBe('11.03 MB');
  });
  it('handles byte and KB boundaries without zero rounding', () => {
    const c=new OperationResultComponent();c.sizeUnitSystem='binary';
    c.file={size:1023} as File;expect(c.sizeLabel).toBe('1023 bytes');
    c.file={size:1024} as File;expect(c.sizeLabel).toBe('1.0 KB');
    c.file={size:1048576} as File;expect(c.sizeLabel).toBe('1.0 MB');
    c.file={size:0} as File;expect(c.sizeLabel).toBe('0 bytes');
  });
});
