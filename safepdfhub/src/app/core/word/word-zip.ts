/** Finalize streamed ZIP32 entries as ordinary OPC ZIP entries.
 * Some Office readers reject deferred local headers/data descriptors. Reuse
 * compressed Blob slices, so no document-sized byte array or recompression is needed.
 */
export async function officeZip(
  source: Blob,
  check: () => void,
): Promise<Blob> {
  check();
  const tail = new Uint8Array(
    await source.slice(Math.max(0, source.size - 65557)).arrayBuffer(),
  );
  const tv = new DataView(tail.buffer);
  let end = tail.length - 22;
  while (end >= 0 && tv.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw Error("The Word archive has no ZIP directory.");
  const count = tv.getUint16(end + 10, true),
    directorySize = tv.getUint32(end + 12, true),
    directoryOffset = tv.getUint32(end + 16, true);
  const directory = new Uint8Array(
    await source
      .slice(directoryOffset, directoryOffset + directorySize)
      .arrayBuffer(),
  );
  const dv = new DataView(directory.buffer);
  const parts: BlobPart[] = [];
  let cursor = 0,
    offset = 0;
  for (let i = 0; i < count; i++) {
    check();
    if (dv.getUint32(cursor, true) !== 0x02014b50)
      throw Error("Invalid Word ZIP directory.");
    const localOffset = dv.getUint32(cursor + 42, true),
      compressed = dv.getUint32(cursor + 20, true);
    const local = new Uint8Array(
      await source.slice(localOffset, localOffset + 30).arrayBuffer(),
    );
    const lv = new DataView(local.buffer);
    if (lv.getUint32(0, true) !== 0x04034b50)
      throw Error("Invalid Word ZIP entry.");
    const headerLength = 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
    const flags = dv.getUint16(cursor + 8, true) & ~8;
    lv.setUint16(6, flags, true);
    for (const [a, b] of [
      [14, 16],
      [18, 20],
      [22, 24],
    ])
      lv.setUint32(a, dv.getUint32(cursor + b, true), true);
    dv.setUint16(cursor + 8, flags, true);
    dv.setUint32(cursor + 42, offset, true);
    parts.push(
      local,
      source.slice(localOffset + 30, localOffset + headerLength + compressed),
    );
    offset += headerLength + compressed;
    cursor +=
      46 +
      dv.getUint16(cursor + 28, true) +
      dv.getUint16(cursor + 30, true) +
      dv.getUint16(cursor + 32, true);
  }
  const trailer = tail.slice(end);
  new DataView(trailer.buffer).setUint32(16, offset, true);
  check();
  return new Blob([...parts, directory, trailer], { type: source.type });
}
