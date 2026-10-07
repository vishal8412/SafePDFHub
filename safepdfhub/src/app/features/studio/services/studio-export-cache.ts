/** One prepared PDF per Studio session. Never cache errors or stale work. */
export class StudioExportCache {
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

  clear(): void { this.entry = undefined; }
}
