/** Adapt only this empty output node: no MEMFS copy of the growing PDF. */
export function attachDiskOutput(fs: any, path: string, handle: any, maxBytes: number): void {
  fs.writeFile(path, new Uint8Array(0));
  const node = fs.lookupPath(path).node;
  const original = node.node_ops;
  node.node_ops = { ...original,
    getattr: (n: any) => ({ ...original.getattr(n), size: handle.getSize() }),
    setattr: (n: any, attr: any) => {
      if (attr.size !== undefined) {
        if (attr.size < 0 || attr.size > maxBytes) throw new Error('Output exceeded the safe storage limit.');
        handle.truncate(attr.size);
      }
      if (attr.mode !== undefined) n.mode = attr.mode;
    },
  };
  node.stream_ops = {
    read: (_s: any, buffer: Uint8Array, offset: number, length: number, position: number) =>
      handle.read(buffer.subarray(offset, offset + Math.min(length, 1_048_576)), { at: position }),
    write: (_s: any, buffer: Uint8Array, offset: number, length: number, position: number) => {
      if (position < 0 || position + length > maxBytes) throw new Error('Output exceeded the safe storage limit.');
      let written = 0;
      while (written < length) {
        const chunk = buffer.subarray(offset + written, offset + Math.min(length, written + 1_048_576));
        const count = handle.write(chunk, { at: position + written });
        if (count <= 0 || count > chunk.length) throw new Error('Temporary storage write failed.');
        written += count;
      }
      return written;
    },
    llseek: (stream: any, offset: number, whence: number) => {
      const pos = offset + (whence === 1 ? stream.position : whence === 2 ? handle.getSize() : 0);
      if (pos < 0 || !Number.isSafeInteger(pos)) throw new Error('Invalid output seek.');
      return pos;
    },
  };
}
