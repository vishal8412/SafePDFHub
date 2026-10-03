/** Bound synchronous disk traffic without retaining the whole PDF. */
export function bufferedHandle(handle: any) {
  const pending = new Uint8Array(1_048_576);
  let start = 0, length = 0;
  const reads = new Map<number, Uint8Array>();
  const flush = () => {
    let done = 0;
    while (done < length) {
      const count = handle.write(pending.subarray(done, length), { at: start + done });
      if (count <= 0 || count > length - done) throw new Error('Temporary storage write failed.');
      done += count;
    }
    length = 0;
  };
  return {
    flush,
    getSize: () => Math.max(handle.getSize(), start + length),
    truncate: (size: number) => { flush(); handle.truncate(size); start = size; reads.clear(); },
    write: (bytes: Uint8Array, options: {at: number}) => {
      reads.clear();
      if (length && options.at !== start + length) flush();
      let done = 0;
      while (done < bytes.length) {
        if (!length) start = options.at + done;
        const count = Math.min(bytes.length - done, pending.length - length);
        pending.set(bytes.subarray(done, done + count), length);
        done += count; length += count;
        if (length === pending.length) flush();
      }
      return bytes.length;
    },
    read: (bytes: Uint8Array, options: {at: number}) => {
      flush();
      let done = 0;
      while (done < bytes.length) {
        const position = options.at + done, block = Math.floor(position / 65536) * 65536;
        let cached = reads.get(block);
        if (!cached) {
          const data = new Uint8Array(65536);
          const count = handle.read(data, { at: block });
          cached = data.subarray(0, count);
          if (reads.size >= 16) reads.delete(reads.keys().next().value!);
        } else reads.delete(block);
        reads.set(block, cached);
        const offset = position - block, count = Math.min(bytes.length - done, cached.length - offset);
        if (count <= 0) break;
        bytes.set(cached.subarray(offset, offset + count), done); done += count;
      }
      return done;
    },
  };
}
