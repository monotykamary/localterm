// Priority-aware concurrency limiter for patch prefetch. Items enqueue with a
// priority (lower = sooner) and an optional force flag. The queue drains up to
// `maxConcurrent` items at a time; when a slot frees, the highest-priority
// pending item starts next.

export interface PrefetchQueueItem {
  path: string;
  priority: number;
  force?: boolean;
}

export class PrefetchQueue {
  private maxConcurrent: number;
  private running = new Set<string>();
  private pending: PrefetchQueueItem[] = [];
  private executor: (path: string, force: boolean) => Promise<void>;

  constructor(maxConcurrent: number, executor: (path: string, force: boolean) => Promise<void>) {
    this.maxConcurrent = maxConcurrent;
    this.executor = executor;
  }

  enqueue(items: PrefetchQueueItem[]): void {
    for (const item of items) {
      if (this.running.has(item.path)) continue;
      const existing = this.pending.findIndex((p) => p.path === item.path);
      if (existing >= 0) {
        if (item.priority < this.pending[existing].priority) {
          this.pending[existing].priority = item.priority;
        }
        if (item.force && !this.pending[existing].force) {
          this.pending[existing].force = true;
        }
        continue;
      }
      this.pending.push({ path: item.path, priority: item.priority, force: item.force });
    }
    this.pending.sort((a, b) => a.priority - b.priority);
    this.drain();
  }

  has(path: string): boolean {
    return this.running.has(path) || this.pending.some((p) => p.path === path);
  }

  clear(): void {
    this.pending = [];
  }

  private drain(): void {
    while (this.running.size < this.maxConcurrent && this.pending.length > 0) {
      const next = this.pending.shift()!;
      this.running.add(next.path);
      void this.executor(next.path, Boolean(next.force)).finally(() => {
        this.running.delete(next.path);
        this.drain();
      });
    }
  }
}
