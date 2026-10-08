/** One prepared PDF per Studio session. Never cache errors or stale work. */
export class StudioExportCache {
  private readonly files = new WeakMap<File, number>();
  private nextFileId = 0;

  /** JSON omits File bytes: distinguish replacements even with identical names and sizes. */
  fileIdentity(file: File | undefined): number | null {
    if (!file) return null;
    let id = this.files.get(file);
    if (id === undefined) {
      id = ++this.nextFileId;
      this.files.set(file, id);
    }
    return id;
  }

  private entry?: { key: string; task: Promise<File> };

  get(key: string, build: () => Promise<File>): Promise<File> {
    if (this.entry?.key === key) return this.entry.task;
    const entry = { key, task: Promise.resolve().then(build) };
    this.entry = entry;
    void entry.task.catch(() => {
      if (this.entry === entry) this.entry = undefined;
    });
    return entry.task;
  }

  clear(): void {
    this.entry = undefined;
  }
}
