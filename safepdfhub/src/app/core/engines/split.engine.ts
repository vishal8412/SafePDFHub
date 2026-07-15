import { Injectable } from '@angular/core';
import { PageRangeParserService } from '../split/page-range-parser.service';
import { SplitGroup } from '../split/split.types';

@Injectable({
  providedIn: 'root'
})

export class SplitEngine {

  constructor(private parser: PageRangeParserService) {}

  splitByRanges(ranges: string): SplitGroup[] {
    const parsedGroups = this.parser.parse(ranges);
    return parsedGroups.map(pages => ({
     pages,
     label: pages.length === 1 ? `Page_${pages[0]}` : `Pages_${pages[0]}-${pages[pages.length - 1]}`
    }));
  }

  splitEveryPage(totalPages: number): SplitGroup[] {
    if (totalPages <= 0) {
      return [];
    }
    return Array.from({ length: totalPages },(_, index) => ({
      pages: [index + 1],
      label: `Page_${index + 1}`
    }));
  }

  splitEveryN(totalPages: number,everyN: number): SplitGroup[] {

    if (totalPages <= 0 || everyN <= 0) {
      return [];
    }

    const groups: SplitGroup[] = [];
  
    for (let start = 1; start <= totalPages; start += everyN) {
      const pages: number[] = [];
      const end = Math.min(start + everyN - 1, totalPages);
      for (let page = start; page <= end; page++) {
        pages.push(page);
      }
      
      groups.push({
        pages,
        label: `Pages_${start}-${end}`
      });
    }

    return groups;
  }

  extractPages(pages: number[]): SplitGroup[] {
   if (!pages.length) {
     return [];
   }
   return [{
      pages,
      label:`Extract_${pages.join('_')}`
   }];
  }

}