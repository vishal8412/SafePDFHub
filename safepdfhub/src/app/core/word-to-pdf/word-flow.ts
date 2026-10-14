/** All layout values are PDF points; top/bottom use distance from the top of the page. */
export interface FlowObstacle {
  x: number;
  top: number;
  width: number;
  height: number;
  left: number;
  right: number;
  above: number;
  below: number;
  mode: "square" | "tight" | "through" | "topBottom" | "none";
  side: string;
  polygon?: { x: number; y: number }[];
}
export interface FlowSlot {
  x: number;
  width: number;
}
/** Subtract drawing exclusion areas from a line band, retaining both sides when allowed. */
export function lineSlots(
  x: number,
  width: number,
  top: number,
  height: number,
  floats: FlowObstacle[],
): FlowSlot[] {
  let slots = [{ x, width }];
  for (const f of floats) {
    if (
      f.mode === "none" ||
      top + height <= f.top - f.above + 0.01 ||
      top >= f.top + f.height + f.below - 0.01
    )
      continue;
    if (f.mode === "topBottom") return [];
    let low = f.x - f.left,
      high = f.x + f.width + f.right;
    if ((f.mode === "tight" || f.mode === "through") && f.polygon?.length) {
      const ys = [
        Math.max(0, top - f.top - f.above),
        Math.min(f.height, top + height - f.top + f.below),
      ];
      const points = f.polygon.map((p) => ({
        x: f.x + (p.x * f.width) / 21600,
        y: (p.y * f.height) / 21600,
      }));
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length];
        if (a.y >= ys[0] && a.y <= ys[1]) xs.push(a.x);
        for (const yy of ys)
          if (
            yy >= Math.min(a.y, b.y) &&
            yy <= Math.max(a.y, b.y) &&
            a.y !== b.y
          )
            xs.push(a.x + ((yy - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      if (xs.length) {
        low = Math.min(...xs) - f.left;
        high = Math.max(...xs) + f.right;
      }
    }
    slots = slots
      .flatMap((s) => {
        const end = s.x + s.width;
        if (high <= s.x || low >= end) return [s];
        const left = { x: s.x, width: Math.max(0, low - s.x) },
          right = {
            x: Math.max(s.x, high),
            width: Math.max(0, end - Math.max(s.x, high)),
          };
        if (f.side === "left") return [left];
        if (f.side === "right") return [right];
        if (f.side === "largest")
          return [left.width >= right.width ? left : right];
        return [left, right];
      })
      .filter((s) => s.width > 0.01);
  }
  return slots;
}
