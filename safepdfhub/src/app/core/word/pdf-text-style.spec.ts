import { graphicsContext, positionedText, textPaints } from "./pdf-text-style";
describe("PDF editable layout", () => {
  it("keeps adjacent columns and separate PDF spans at their original coordinates", () => {
    const lines = positionedText([
      { text: "LEFT", x: 20, y: 40, width: 40, size: 12 },
      { text: "RIGHT", x: 80, y: 40, width: 50, size: 12 },
    ]);
    expect(lines.map((l) => l.x)).toEqual([20, 80]);
    expect(lines).toHaveLength(2);
  });
  it("fits substituted fonts to the measured source width and retains colour", () => {
    const [line] = positionedText(
      [
        {
          text: "Heading",
          x: 10,
          y: 20,
          width: 60,
          size: 14,
          color: "123456",
          font: "Some-Bold",
        },
      ],
      () => 80,
    );
    expect(line.runs[0]).toMatchObject({
      scale: 75,
      color: "123456",
      bold: true,
    });
  });
  it("tracks saved paint state and does not derive colours from text content", () => {
    const ops = { save: 1, restore: 2, setFillRGBColor: 3, showText: 4 };
    const paints = textPaints(
      {
        fnArray: [3, 4, 1, 3, 4, 2, 4],
        argsArray: [
          ["#123456"],
          [[{ unicode: "One" }]],
          [],
          ["#654321"],
          [[{ unicode: "Two" }]],
          [],
          [[{ unicode: "Three" }]],
        ],
      },
      ops,
    );
    expect(paints.color("One")).toBe("123456");
    expect(paints.color("Two")).toBe("654321");
    expect(paints.color("Three")).toBe("123456");
  });
  it("flags invisible or clipping text instead of adding visible duplicate text", () => {
    expect(
      textPaints(
        { fnArray: [1, 2], argsArray: [[3], [[{ unicode: "Hidden" }]]] },
        { setTextRenderingMode: 1, showText: 2 },
      ).unsafe,
    ).toBe(true);
  });
  it("retains vector painting while omitting text from the artwork", () => {
    const raw = {
      fillText: vi.fn(),
      strokeText: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "white",
    };
    const ctx = graphicsContext(raw as any);
    ctx.fillText("word", 0, 0);
    ctx.strokeText("word", 0, 0);
    ctx.fillRect(0, 0, 5, 5);
    ctx.fillStyle = "blue";
    expect(raw.fillText).not.toHaveBeenCalled();
    expect(raw.strokeText).not.toHaveBeenCalled();
    expect(raw.fillRect).toHaveBeenCalled();
    expect(raw.fillStyle).toBe("blue");
  });
});
