import { parseStudioSigningPages } from './studio-signing-pages';
describe('signing page selection',()=>{
 it('sorts and deduplicates selected pages',()=>expect(parseStudioSigningPages('3, 1-3, 5',5)).toEqual([1,2,3,5]));
 it('rejects the whole selection instead of silently signing other pages',()=>{
   for(const text of ['','0','2, 99','4-2','1-99','1, nope','1,','1.5','-1']) expect(()=>parseStudioSigningPages(text,5)).toThrow();
 });
});
