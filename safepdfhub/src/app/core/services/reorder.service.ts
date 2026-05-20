import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ReorderService {

  moveItem<T>(
    array: T[],
    from: number,
    to: number
  ): T[] {

    const cloned = [...array];

    const item = cloned.splice(from, 1)[0];

    cloned.splice(to, 0, item);

    return cloned;
  }

  swapItems<T>(
    array: T[],
    from: number,
    to: number
  ): T[] {

    const cloned = [...array];

    [cloned[from], cloned[to]] =
    [cloned[to], cloned[from]];

    return cloned;
  }
}