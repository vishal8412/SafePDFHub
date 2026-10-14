import { Inflate } from "fflate";
import { WORD_INPUT_BYTES } from "./docx-preflight";
export interface DocxPart {
  name: string;
  size: number;
  compressed: number;
  offset: number;
  method: number;
  crc: number;
}
/** Range reads keep the complete compressed file out of JavaScript memory. */
export async function openDocx(file: Blob) {
  if (!file.size || file.size > WORD_INPUT_BYTES)
    throw Error("Choose a non-empty DOCX up to 200 MB.");
  const tailStart = Math.max(0, file.size - 65557),
    tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--)
    if (
      tail.getUint32(i, true) === 0x06054b50 &&
      i + 22 + tail.getUint16(i + 20, true) === tail.byteLength
    ) {
      end = i;
      break;
    }
  if (end < 0) throw Error("This is not a valid DOCX archive.");
  const count = tail.getUint16(end + 10, true),
    length = tail.getUint32(end + 12, true),
    offset = tail.getUint32(end + 16, true);
  if (
    tail.getUint32(end + 4, true) !== 0 ||
    count === 65535 ||
    count > 30000 ||
    length > 8_000_000 ||
    offset + length > tailStart + end
  )
    throw Error("This DOCX archive format is not supported.");
  const view = new DataView(
      await file.slice(offset, offset + length).arrayBuffer(),
    ),
    parts = new Map<string, DocxPart>();
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > length || view.getUint32(at, true) !== 0x02014b50)
      throw Error("The DOCX archive is damaged.");
    const flags = view.getUint16(at + 8, true),
      method = view.getUint16(at + 10, true),
      crc = view.getUint32(at + 16, true),
      compressed = view.getUint32(at + 20, true),
      size = view.getUint32(at + 24, true),
      n = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true),
      local = view.getUint32(at + 42, true);
    if (at + 46 + n + extra + comment > length)
      throw Error("The DOCX archive is incomplete.");
    const name = new TextDecoder().decode(
      new Uint8Array(view.buffer, at + 46, n),
    );
    at += 46 + n + extra + comment;
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      parts.has(name) ||
      size === 0xffffffff ||
      local + 30 + compressed > offset
    )
      throw Error("Encrypted or unsafe DOCX archives are not supported.");
    if (/vbaProject|word\/embeddings\//i.test(name))
      throw Error(
        "Macros and embedded objects cannot be converted. Save a standard DOCX copy.",
      );
    parts.set(name, { name, size, compressed, offset: local, method, crc });
  }
  if (!parts.has("word/document.xml") || !parts.has("[Content_Types].xml"))
    throw Error("Choose a DOCX document, not another ZIP file.");
  return {
    parts,
    async read(name: string, limit = 64_000_000): Promise<Uint8Array> {
      const part = parts.get(name);
      if (!part) throw Error(`Missing document part: ${name}`);
      if (part.size > limit)
        throw Error(
          `A document part is too complex to process on this device (${name}).`,
        );
      const header = new DataView(
        await file.slice(part.offset, part.offset + 30).arrayBuffer(),
      );
      if (
        header.byteLength !== 30 ||
        header.getUint32(0, true) !== 0x04034b50 ||
        header.getUint16(8, true) !== part.method
      )
        throw Error("The DOCX archive is damaged.");
      const start =
        part.offset +
        30 +
        header.getUint16(26, true) +
        header.getUint16(28, true);
      if (start + part.compressed > offset)
        throw Error("The DOCX archive is incomplete.");
      const out = new Uint8Array(part.size);
      let written = 0,
        crc = 0xffffffff;
      const append = (chunk: Uint8Array) => {
        if (written + chunk.length > out.length)
          throw Error("Archive size metadata does not match its contents.");
        out.set(chunk, written);
        written += chunk.length;
        for (const b of chunk) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
      };
      const inflater = part.method === 8 ? new Inflate(append) : null;
      for (let pos = 0; pos < part.compressed; pos += 65536) {
        const chunk = new Uint8Array(
          await file
            .slice(start + pos, start + Math.min(part.compressed, pos + 65536))
            .arrayBuffer(),
        );
        if (inflater)
          inflater.push(chunk, pos + chunk.length === part.compressed);
        else append(chunk);
      }
      if (written !== part.size || (crc ^ 0xffffffff) >>> 0 !== part.crc)
        throw Error("The DOCX archive failed its integrity check.");
      return out;
    },
  };
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
