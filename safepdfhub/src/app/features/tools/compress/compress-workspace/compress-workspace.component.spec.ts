import { describe, it, expect, vi } from 'vitest';
import { CompressWorkspaceComponent } from './compress-workspace.component';

describe('Compression workspace', () => {
  it('reports actual byte counts even when rounded MB would hide a missed target', () => {
    const ui = new CompressWorkspaceComponent();
    ui.resultFile = new File([new Uint8Array(1_000_001)], 'result.pdf');
    ui.compressionResult = { targetBytes: 1_000_000, targetMet: false } as never;
    expect(ui.resultDescription).toContain('Target not reached');
    expect(ui.resultDescription).toContain('1,000,001 bytes');
    expect(ui.formatFileSize(1_000_000)).toBe('1.00 MB');
  });
  it('explains decimal and binary sizes without changing the file byte count', () => {
    const ui = new CompressWorkspaceComponent();
    const file = new File(['pdf'], 'sample.pdf');
    Object.defineProperty(file, 'size', { value: 103022592 });
    ui.files = [file];
    expect(ui.formatFileSize(file.size)).toBe('103.02 MB');
    expect(ui.originalSizeDetails).toContain('103,022,592 bytes');
    expect(ui.originalSizeDetails).toContain('98.25 MiB');
  });
  it('blocks invalid targets and setting changes during a run', () => {
    const ui = new CompressWorkspaceComponent();
    const start = vi.spyOn(ui.compress, 'emit');
    ui.targetSizeMB = 0; ui.startCompress(); expect(start).not.toHaveBeenCalled();
    ui.targetSizeMB = 1; ui.compressing = true;
    const change = vi.spyOn(ui.compressionLevelChange, 'emit');
    ui.selectLevel('strong'); ui.startCompress();
    expect(change).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  });
});
