/** Immutable WORKERFS source, bounded to 2 MiB of cached input. */
export function cacheWorkerInput(workerfs: any): void {
  const original = workerfs.stream_ops.read;
  const blocks = new Map<number, Uint8Array>();
  workerfs.stream_ops.read = (stream: any, buffer: Uint8Array, offset: number, length: number, position: number) => {
    let done = 0;
    while (done < length) {
      const at = position + done, block = Math.floor(at / 65536) * 65536;
      let data = blocks.get(block);
      if (!data) {
        const bytes = new Uint8Array(65536);
        const count = original(stream, bytes, 0, bytes.length, block);
        data = bytes.subarray(0, count);
        if (blocks.size >= 32) blocks.delete(blocks.keys().next().value!);
      } else blocks.delete(block);
      blocks.set(block, data);
      const within = at - block, count = Math.min(length - done, data.length - within);
      if (count <= 0) break;
      buffer.set(data.subarray(within, within + count), offset + done); done += count;
    }
    return done;
  };
}
