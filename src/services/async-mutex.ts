export class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  async runExclusive<T>(work: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    const prev = this.queue;
    this.queue = prev.then(() => next);
    await prev;

    try {
      return await work();
    } finally {
      release();
    }
  }
}
