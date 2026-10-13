export const WORD_INPUT_BYTES = 200_000_000;
export interface ArchiveEntry {
  name: string;
  bytes: number;
}
/** Inspect central-directory metadata before any archive inflation. ZIP64 is deliberately unsupported. */
export async function inspectArchive(
  file: Blob,
  expandedLimit = 256_000_000,
): Promise<ArchiveEntry[]> {
  const tail = new DataView(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--)
    if (
      tail.getUint32(i, true) === 0x06054b50 &&
      i + 22 + tail.getUint16(i + 20, true) === tail.byteLength
    ) {
      end = i;
      break;
    }
  if (end < 0) throw Error('This is not a valid DOCX archive. Save a new DOCX copy in Word.');
  const count = tail.getUint16(end + 10, true),
    size = tail.getUint32(end + 12, true),
    offset = tail.getUint32(end + 16, true);
  if (
    tail.getUint16(end + 4, true) ||
    tail.getUint16(end + 6, true) ||
    count === 65535 ||
    count > 10000 ||
    size > 4_000_000 ||
    offset + size > file.size - 22
  )
    throw Error('This archive format or complexity is not supported in the browser.');
  const view = new DataView(await file.slice(offset, offset + size).arrayBuffer());
  const entries: ArchiveEntry[] = [];
  const names = new Set<string>();
  let pos = 0,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > view.byteLength || view.getUint32(pos, true) !== 0x02014b50)
      throw Error('The DOCX archive is damaged.');
    const flags = view.getUint16(pos + 8, true),
      method = view.getUint16(pos + 10, true),
      bytes = view.getUint32(pos + 24, true),
      len = view.getUint16(pos + 28, true),
      extra = view.getUint16(pos + 30, true),
      comment = view.getUint16(pos + 32, true);
    if (pos + 46 + len + extra + comment > view.byteLength)
      throw Error('The DOCX archive is incomplete.');
    const name = new TextDecoder().decode(new Uint8Array(view.buffer, pos + 46, len));
    pos += 46 + len + extra + comment;
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').includes('..') ||
      names.has(name)
    )
      throw Error('Encrypted or unsafe DOCX archives are not supported.');
    names.add(name);
    total += bytes;
    if (
      bytes === 0xffffffff ||
      total > expandedLimit ||
      (/\.(xml|rels)$/i.test(name) && bytes > 8_000_000)
    )
      throw Error(
        'This document expands beyond the safe browser memory budget. Split it into smaller documents.',
      );
    if (/vbaProject|word\/embeddings\//i.test(name))
      throw Error('Macros and embedded objects are not supported. Save a plain DOCX copy.');
    entries.push({ name, bytes });
  }
  if (!names.has('word/document.xml') || !names.has('[Content_Types].xml'))
    throw Error('Choose a DOCX document, not another ZIP file.');
  return entries;
}
