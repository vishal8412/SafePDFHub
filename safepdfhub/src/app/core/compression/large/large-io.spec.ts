import { describe, it, expect } from 'vitest';
import { bufferedHandle } from './buffered-handle';
import { StreamedInventory } from './streamed-inventory';
import { compressionBudget, nativeCompressionLimit } from './large-compression-policy';
import { cacheWorkerInput } from './cached-input';
describe('bounded large-file IO', () => {
  it('coalesces writes and invalidates cached reads after overwrite', () => {
    const data = new Uint8Array(200000); let size = 0, writes = 0;
    const h = bufferedHandle({ getSize: () => size, truncate: (n: number) => { size = n; },
      write: (b: Uint8Array, {at}: any) => { writes++; const n = Math.min(10000,b.length); data.set(b.subarray(0,n),at);size=Math.max(size,at+n);return n; },
      read: (b: Uint8Array, {at}: any) => { const n=Math.max(0,Math.min(b.length,size-at));b.set(data.subarray(at,at+n));return n; } });
    for(let i=0;i<1000;i++)h.write(new Uint8Array([i%256]),{at:i});
    expect(writes).toBe(0);expect(h.getSize()).toBe(1000);
    const read = new Uint8Array(1000);expect(h.read(read,{at:0})).toBe(1000);expect(writes).toBe(1);expect(read[999]).toBe(231);
    h.write(new Uint8Array([42]),{at:7});h.read(read,{at:0});expect(read[7]).toBe(42);
    h.truncate(0);expect(h.read(read,{at:0})).toBe(0);
  });
  it('streams large JSON inventories one page at a time', () => {
    const sink = new StreamedInventory(10000,1000,100000);
    const enc = new TextEncoder();let at=0;
    const push=(text:string)=>{const b=enc.encode(text);sink.write(b,{at});at+=b.length;};
    push('{"pages":[');
    for(let i=0;i<100;i++)push((i?',':'')+JSON.stringify({images:[{width:10,height:20}],other:'é " ] }'.repeat(16000)}));
    push(']}');expect(at).toBeGreaterThan(8_000_000);expect(sink.finish()).toEqual(Array(100).fill('10x20'));
  });
  it('rejects incomplete inventories and device-ineligible whole-file parsing', () => {
    expect(()=>new StreamedInventory(100,10,1000).finish()).toThrow(/Incomplete/);
    expect(nativeCompressionLimit(compressionBudget(8,'desktop',true))).toBe(200000000);
    expect(nativeCompressionLimit(compressionBudget(4,'desktop',true))).toBe(64000000);
    expect(nativeCompressionLimit(compressionBudget(8,'mobile',true))).toBe(0);
    expect(nativeCompressionLimit(compressionBudget(null,'desktop',true))).toBe(0);
  });
  it('reuses input blocks and handles cross-block reads and EOF', () => {
    const bytes = Uint8Array.from({length:100000},(_,i)=>i%251);let reads=0;
    const fs:any={stream_ops:{read:(_:any,b:Uint8Array,o:number,n:number,p:number)=>{reads++;const count=Math.max(0,Math.min(n,bytes.length-p));b.set(bytes.subarray(p,p+count),o);return count;}}};
    cacheWorkerInput(fs);const out=new Uint8Array(100);
    expect(fs.stream_ops.read({},out,0,100,65500)).toBe(100);expect(out).toEqual(bytes.slice(65500,65600));
    fs.stream_ops.read({},out,0,100,65500);expect(reads).toBe(2);
    expect(fs.stream_ops.read({},out,0,100,99990)).toBe(10);
  });
});
