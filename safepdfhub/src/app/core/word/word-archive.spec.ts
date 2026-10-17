import { WordArchive } from "./word-archive";
import { documentXml, WordPage } from "./word-document";
import JSZip from "jszip";
const read = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = reject;
    r.readAsArrayBuffer(blob);
  });
describe("Streaming Word archive", () => {
  const page: WordPage = {
    width: 612,
    height: 792,
    visual: false,
    images: [],
    lines: [
      {
        x: 40,
        y: 60,
        width: 200,
        height: 12,
        runs: [{ text: "Editable हिन्दी & English", font: "Arial", size: 12 }],
      },
    ],
  };
  beforeAll(() => {
    if (!Blob.prototype.arrayBuffer)
      Blob.prototype.arrayBuffer = function () {
        return read(this);
      };
  });
  it("keeps page XML, Unicode and image relationships across incremental export", async () => {
    const archive = new WordArchive(new AbortController().signal);
    const second = {
      ...page,
      visual: true,
      lines: [],
      images: [
        {
          id: 1,
          bytes: new Uint8Array([255, 216, 255, 217]),
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      ],
    };
    await archive.addPage(page);
    await archive.addPage(second);
    const blob = await archive.finish(() => {});
    const zip = await JSZip.loadAsync(await read(blob));
    expect(await zip.file("word/document.xml")!.async("string")).toBe(
      documentXml([page, second]),
    );
    expect(
      await zip.file("word/media/image1.jpg")!.async("uint8array"),
    ).toEqual(second.images[0].bytes);
    expect(
      await zip.file("word/_rels/document.xml.rels")!.async("string"),
    ).toContain("img1");
    archive.dispose();
  });
  it("finalizes local ZIP headers without deferred data descriptors for Office readers", async () => {
    const archive = new WordArchive(new AbortController().signal);
    await archive.addPage(page);
    const bytes = new Uint8Array(await read(await archive.finish(() => {}))),
      view = new DataView(bytes.buffer);
    let offset = 0,
      entries = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      expect(view.getUint16(offset + 6, true) & 8).toBe(0);
      expect(view.getUint32(offset + 22, true)).toBeGreaterThan(0);
      offset +=
        30 +
        view.getUint16(offset + 26, true) +
        view.getUint16(offset + 28, true) +
        view.getUint32(offset + 18, true);
      entries++;
    }
    expect(entries).toBe(4);
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    expect(
      await (
        await JSZip.loadAsync(bytes)
      )
        .file("word/document.xml")!
        .async("string"),
    ).toContain("Editable");
    archive.dispose();
  });
  it("rejects cancellation during final export", async () => {
    const signal = new AbortController();
    const archive = new WordArchive(signal.signal);
    await archive.addPage(page);
    signal.abort();
    await expect(archive.finish(() => {})).rejects.toMatchObject({
      name: "AbortError",
    });
  });
  it("reuses identical media across pages while keeping geometry and shape IDs independent", async () => {
    const archive = new WordArchive(new AbortController().signal);
    for (let i = 1; i <= 3; i++)
      await archive.addPage({
        ...page,
        positioned: true,
        images: [
          {
            id: i,
            format: "png",
            bytes: new Uint8Array([1, 2, 3]),
            x: i * 10,
            y: 0,
            width: i * 40,
            height: 100,
          },
        ],
      });
    const zip = await JSZip.loadAsync(
      await read(await archive.finish(() => {})),
    );
    expect(
      Object.keys(zip.files).filter((n) => n.startsWith("word/media/")),
    ).toEqual(["word/media/image1.png"]);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml.match(/r:id="img1"/g)?.length).toBe(3);
    expect(xml).toContain("margin-left:30.000pt");
    expect(xml).toContain("width:120.000pt");
    expect(xml).toContain('id="artwork3_1"');
    expect(
      (await zip.file("word/_rels/document.xml.rels")!.async("string")).match(
        /Id="img/g,
      )?.length,
    ).toBe(1);
    archive.dispose();
  });
  it("never merges different bytes or formats", async () => {
    const archive = new WordArchive(new AbortController().signal);
    for (let i = 1; i <= 3; i++)
      await archive.addPage({
        ...page,
        images: [
          {
            id: i,
            format: i === 3 ? "png" : "jpg",
            bytes: new Uint8Array(i === 2 ? [3, 2, 1] : [1, 2, 3]),
            x: 0,
            y: 0,
            width: 10,
            height: 10,
          },
        ],
      });
    const zip = await JSZip.loadAsync(
      await read(await archive.finish(() => {})),
    );
    expect(
      Object.keys(zip.files).filter((n) => n.startsWith("word/media/")).length,
    ).toBe(3);
    archive.dispose();
  });
  it("compares bytes even when two different images have the same fingerprint", async () => {
    const archive = new WordArchive(new AbortController().signal);
    const collision = [
      [30, 66, 2, 184, 49, 235, 102, 42],
      [75, 247, 39, 124, 208, 142, 226, 13],
    ];
    for (let i = 0; i < collision.length; i++)
      await archive.addPage({
        ...page,
        images: [
          {
            id: i + 1,
            bytes: new Uint8Array(collision[i]),
            x: 0,
            y: 0,
            width: 10,
            height: 10,
          },
        ],
      });
    const zip = await JSZip.loadAsync(
      await read(await archive.finish(() => {})),
    );
    expect(
      await zip.file("word/media/image1.jpg")!.async("uint8array"),
    ).toEqual(new Uint8Array(collision[0]));
    expect(
      await zip.file("word/media/image2.jpg")!.async("uint8array"),
    ).toEqual(new Uint8Array(collision[1]));
    archive.dispose();
  });
  it("cancels while comparing media without writing another page", async () => {
    const controller = new AbortController();
    const archive = new WordArchive(controller.signal);
    const images = [
      {
        id: 1,
        bytes: new Uint8Array([1, 2, 3]),
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
    ];
    await archive.addPage({ ...page, images });
    const pending = archive.addPage({
      ...page,
      images: [{ ...images[0], id: 2 }],
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
