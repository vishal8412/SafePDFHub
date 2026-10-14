import { lineSlots, type FlowObstacle } from "./word-flow";
const obstacle: FlowObstacle = {
  x: 300,
  top: 100,
  width: 150,
  height: 200,
  left: 9,
  right: 9,
  above: 5,
  below: 5,
  mode: "square",
  side: "bothSides",
};
describe("Word floating drawing exclusion areas", () => {
  it("wraps to the left of right-aligned pictures only while their band overlaps", () => {
    expect(lineSlots(72, 378, 120, 15, [obstacle])).toEqual([
      { x: 72, width: 219 },
    ]);
    expect(lineSlots(72, 378, 306, 15, [obstacle])).toEqual([
      { x: 72, width: 378 },
    ]);
  });
  it("keeps both usable sides of a centered picture", () => {
    expect(
      lineSlots(72, 468, 120, 15, [{ ...obstacle, x: 200, width: 100 }]),
    ).toEqual([
      { x: 72, width: 119 },
      { x: 309, width: 231 },
    ]);
  });
  it("excludes the complete line for top-and-bottom wrapping but none for layered drawings", () => {
    expect(
      lineSlots(72, 468, 120, 15, [{ ...obstacle, mode: "topBottom" }]),
    ).toEqual([]);
    expect(
      lineSlots(72, 468, 120, 15, [{ ...obstacle, mode: "none" }]),
    ).toEqual([{ x: 72, width: 468 }]);
  });
  it("uses the authored tight-wrap polygon at the current line band", () => {
    const f = {
      ...obstacle,
      x: 72,
      width: 200,
      left: 0,
      right: 0,
      above: 0,
      below: 0,
      mode: "tight" as const,
      polygon: [
        { x: 0, y: 0 },
        { x: 21600, y: 21600 },
        { x: 0, y: 21600 },
      ],
    };
    const slots = lineSlots(72, 468, 100, 20, [f]);
    expect(slots[0].x).toBeCloseTo(92);
    expect(slots[0].width).toBeCloseTo(448);
  });
});
