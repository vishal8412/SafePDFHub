import { wordImage } from "./word-image";

describe("Word artwork encoding", () => {
  beforeAll(() => {
    if (!Blob.prototype.arrayBuffer)
      Blob.prototype.arrayBuffer = function () {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = reject;
          reader.readAsArrayBuffer(this);
        });
      };
  });
  const canvas = (
    png: number,
    jpg: number,
    blank = false,
    mime = "image/jpeg",
  ) =>
    ({
      width: 1,
      height: 65,
      getContext: () => ({
        getImageData: (_x: number, y: number) => ({
          data: new Uint8ClampedArray(
            blank || y < 64 ? [255, 255, 255, 255] : [0, 0, 0, 255],
          ),
        }),
      }),
      toBlob: vi.fn((cb: BlobCallback, type: string) =>
        cb(
          new Blob([new Uint8Array(type === "image/png" ? png : jpg)], {
            type: type === "image/png" ? type : mime,
          }),
        ),
      ),
    }) as unknown as HTMLCanvasElement;
  it("omits a completely white layer without encoding it", async () => {
    const c = canvas(100, 50, true);
    expect(await wordImage(c, () => {})).toBeNull();
    expect(c.toBlob).not.toHaveBeenCalled();
  });
  it("keeps a small mark at the bottom of an otherwise blank page", async () => {
    expect(await wordImage(canvas(100, 95), () => {})).toMatchObject({
      format: "png",
    });
  });
  it("uses smaller JPEG for photographic pages without changing resolution", async () => {
    const c = canvas(1000, 200);
    const result = await wordImage(c, () => {});
    expect(result?.format).toBe("jpg");
    expect(result?.bytes.length).toBe(200);
    expect([c.width, c.height]).toEqual([1, 65]);
    expect(c.toBlob).toHaveBeenLastCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.88,
    );
  });
  it("retains lossless PNG when it is smaller or JPEG is unavailable", async () => {
    expect((await wordImage(canvas(80, 200), () => {}))?.format).toBe("png");
    expect(
      (await wordImage(canvas(100, 20, false, "image/png"), () => {}))?.format,
    ).toBe("png");
  });
  it("reports encoder failure and cancellation", async () => {
    const c = canvas(100, 20);
    c.toBlob = (cb) => cb(null);
    await expect(wordImage(c, () => {})).rejects.toThrow("encode");
    await expect(
      wordImage(c, () => {
        throw new DOMException("Cancelled", "AbortError");
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("keeps the PNG if the optional JPEG encoder fails", async () => {
    const c = canvas(100, 20);
    c.toBlob = (cb, type) =>
      cb(
        type === "image/jpeg"
          ? null
          : new Blob([new Uint8Array(100)], { type: "image/png" }),
      );
    expect((await wordImage(c, () => {}))?.format).toBe("png");
  });
});
