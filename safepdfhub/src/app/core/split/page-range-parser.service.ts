import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})

export class PageRangeParserService {

  parse(input: string): number[][] {

    if (!input?.trim()) {
      return [];
    }

    const groups: number[][] = [];

    const segments = input
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);

    for (const segment of segments) {

      if (segment.includes('-')) {

        const [start,end] =
          segment
          .split('-')
          .map(Number);

        if (
          Number.isNaN(start) ||
          Number.isNaN(end)
        ) {

          continue;

        }

        const pages:number[] = [];

        for (
          let i=start;
          i<=end;
          i++
        ) {

          pages.push(i);

        }

        groups.push(pages);

      }

      else {

        groups.push([
          Number(segment)
        ]);

      }

    }

    return groups;
  }

}