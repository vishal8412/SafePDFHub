/** Fixed row geometry keeps sidebar DOM/canvases bounded independently of PDF size. */
export function studioPageWindow(count: number, scrollTop: number, height: number, columns: number, rowHeight: number) {
  const totalRows = Math.ceil(count / columns);
  const visibleRows = Math.ceil(Math.max(1, height) / rowHeight);
  const first = Math.max(0, Math.min(Math.floor(scrollTop / rowHeight) - 2, totalRows - visibleRows - 4));
  const last = Math.min(totalRows, first + visibleRows + 4);
  return { start: first * columns, end: Math.min(count, last * columns), top: first * rowHeight,
    bottom: Math.max(0, (totalRows - last) * rowHeight) };
}
