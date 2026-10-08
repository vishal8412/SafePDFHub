export function parseStudioSigningPages(value: string, count: number): number[] {
  const pages = new Set<number>();
  if (!value.trim()) throw new Error('Enter at least one page number.');
  for (const part of value.split(',')) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
    if (!match) throw new Error('Use page numbers or ranges, for example 1, 3, 5-8.');
    const first=Number(match[1]),last=Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first<1 || last<first || last>count)
      throw new Error(`Choose pages from 1 to ${count}. Ranges must run from a lower page to a higher page.`);
    for(let n=first;n<=last;n++) pages.add(n);
  }
  return [...pages].sort((a,b)=>a-b);
}
