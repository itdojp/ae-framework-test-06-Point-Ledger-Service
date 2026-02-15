export interface ReadRateLimitConsumeResult {
  allowed: boolean;
  count: number;
  resetAtMs: number;
}

export interface ReadRateLimitBackend {
  kind: 'memory' | 'postgres';
  consume(bucketKey: string, limit: number, windowMs: number): Promise<ReadRateLimitConsumeResult>;
  close?(): Promise<void>;
}

interface InMemoryBucket {
  count: number;
  resetAtMs: number;
}

export class InMemoryReadRateLimitBackend implements ReadRateLimitBackend {
  readonly kind = 'memory' as const;
  private readonly buckets = new Map<string, InMemoryBucket>();

  async consume(bucketKey: string, limit: number, windowMs: number): Promise<ReadRateLimitConsumeResult> {
    const now = Date.now();
    const existing = this.buckets.get(bucketKey);
    if (!existing || now >= existing.resetAtMs) {
      const resetAtMs = now + windowMs;
      this.buckets.set(bucketKey, { count: 1, resetAtMs });
      return { allowed: true, count: 1, resetAtMs };
    }

    if (existing.count >= limit) {
      return { allowed: false, count: existing.count, resetAtMs: existing.resetAtMs };
    }

    existing.count += 1;
    if (this.buckets.size > 10000) {
      for (const [key, bucket] of this.buckets.entries()) {
        if (now >= bucket.resetAtMs) {
          this.buckets.delete(key);
        }
      }
    }
    return { allowed: true, count: existing.count, resetAtMs: existing.resetAtMs };
  }
}
