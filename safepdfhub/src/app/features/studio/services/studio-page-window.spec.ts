import { studioPageWindow } from './studio-page-window';

describe('large PDF sidebar window', () => {
  it('keeps 18,639 pages bounded, including the last partial grid row', () => {
    for (const columns of [1, 2, 7]) {
      for (const top of [0, 10000, 1e9]) {
        const w = studioPageWindow(18639, top, 600, columns, 176);
        expect(w.end - w.start).toBeLessThanOrEqual(8 * columns);
        expect(w.start % columns).toBe(0);
        expect(w.top + Math.ceil((w.end-w.start)/columns)*176 + w.bottom).toBe(Math.ceil(18639/columns)*176);
        expect(w.end).toBeLessThanOrEqual(18639);
      }
    }
  });
  it('clamps a stale scroll position when pages are deleted', () => {
    expect(studioPageWindow(205, 1e9, 600, 2, 176).end).toBe(205);
    expect(studioPageWindow(0, 0, 600, 1, 176)).toEqual({start:0,end:0,top:0,bottom:0});
  });
});
