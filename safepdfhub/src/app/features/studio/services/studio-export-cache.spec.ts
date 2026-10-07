import { StudioExportCache } from './studio-export-cache';
import { vi } from 'vitest';

describe('Studio prepared export cache', () => {
  it('shares in-flight work and reuses a completed PDF without serialization', async () => {
    const cache=new StudioExportCache(), file=new File(['pdf'],'edited.pdf');
    const build=vi.fn(async()=>file);
    const one=cache.get('version-1',build),two=cache.get('version-1',build);
    expect(one).toBe(two);expect(await one).toBe(file);
    expect(await cache.get('version-1',build)).toBe(file);expect(build).toHaveBeenCalledTimes(1);
  });
  it('rebuilds after edits and document replacement', async () => {
    const cache=new StudioExportCache(),build=vi.fn(async()=>new File(['pdf'],'edited.pdf'));
    const one=await cache.get('document-1:edit-1',build);
    expect(await cache.get('document-1:edit-2',build)).not.toBe(one);
    cache.clear();await cache.get('document-1:edit-2',build);expect(build).toHaveBeenCalledTimes(3);
  });
  it('allows retry after a failure without discarding a newer request', async () => {
    const cache=new StudioExportCache();let reject!:(e:Error)=>void;
    const old=cache.get('old',()=>new Promise((_,r)=>reject=r));await Promise.resolve();
    const file=new File(['ok'],'new.pdf');const next=cache.get('new',async()=>file);
    reject(new Error('Failed'));await expect(old).rejects.toThrow('Failed');await next;
    const build=vi.fn(async()=>file);expect(await cache.get('new',build)).toBe(file);expect(build).not.toHaveBeenCalled();
    const failed=vi.fn(async()=>{throw new Error('Retry')});await expect(cache.get('bad',failed)).rejects.toThrow();
    expect(await cache.get('bad',async()=>file)).toBe(file);
  });
});
