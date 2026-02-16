import { Pool } from 'pg';
import { ReadRateLimitBackend, ReadRateLimitConsumeResult } from './read-rate-limit-backend.js';

export interface PostgresReadRateLimitBackendOptions {
  connectionString: string;
  cleanupIntervalMs?: number;
  cleanupRetentionMs?: number;
  cleanupBatchSize?: number;
}

export class PostgresReadRateLimitBackend implements ReadRateLimitBackend {
  readonly kind = 'postgres' as const;
  private static readonly CLEANUP_ADVISORY_LOCK_KEY = 4_391_027;
  private readonly pool: Pool;
  private lastCleanupAtMs = 0;
  private readonly cleanupIntervalMs: number;
  private readonly cleanupRetentionMs: number;
  private readonly cleanupBatchSize: number;
  private cleanupPromise: Promise<void> | null = null;

  constructor(options: PostgresReadRateLimitBackendOptions) {
    this.pool = new Pool({ connectionString: options.connectionString });
    this.cleanupIntervalMs =
      options.cleanupIntervalMs && Number.isInteger(options.cleanupIntervalMs) && options.cleanupIntervalMs > 0
        ? options.cleanupIntervalMs
        : 60_000;
    this.cleanupRetentionMs =
      options.cleanupRetentionMs && Number.isInteger(options.cleanupRetentionMs) && options.cleanupRetentionMs > 0
        ? options.cleanupRetentionMs
        : 3_600_000;
    this.cleanupBatchSize =
      options.cleanupBatchSize && Number.isInteger(options.cleanupBatchSize) && options.cleanupBatchSize > 0
        ? options.cleanupBatchSize
        : 1_000;
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ledger_read_rate_limits (
        bucket_key TEXT PRIMARY KEY,
        count INT NOT NULL,
        reset_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ledger_read_rate_limits_reset_at
      ON ledger_read_rate_limits (reset_at);
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ledger_read_rate_limits_updated_at
      ON ledger_read_rate_limits (updated_at);
    `);
  }

  async consume(bucketKey: string, limit: number, windowMs: number): Promise<ReadRateLimitConsumeResult> {
    const nowMs = Date.now();
    const nextResetAtMs = nowMs + windowMs;
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query(
        `
        SELECT
          count,
          (EXTRACT(EPOCH FROM reset_at) * 1000)::bigint AS reset_at_ms
        FROM ledger_read_rate_limits
        WHERE bucket_key = $1
        FOR UPDATE
        `,
        [bucketKey]
      );

      if (result.rowCount === 0) {
        await client.query(
          `
          INSERT INTO ledger_read_rate_limits (bucket_key, count, reset_at, updated_at)
          VALUES ($1, 1, to_timestamp($2 / 1000.0), NOW())
          `,
          [bucketKey, nextResetAtMs]
        );
        await client.query('COMMIT');
        await this.cleanupIfNeeded(nowMs);
        return {
          allowed: true,
          count: 1,
          resetAtMs: nextResetAtMs
        };
      }

      const row = result.rows[0] as { count: number | string; reset_at_ms: number | string };
      const currentCount = Number(row.count);
      const resetAtMs = Number(row.reset_at_ms);
      if (!Number.isFinite(currentCount) || !Number.isFinite(resetAtMs)) {
        throw new Error('Invalid rate limit row');
      }

      if (nowMs >= resetAtMs) {
        await client.query(
          `
          UPDATE ledger_read_rate_limits
          SET count = 1, reset_at = to_timestamp($2 / 1000.0), updated_at = NOW()
          WHERE bucket_key = $1
          `,
          [bucketKey, nextResetAtMs]
        );
        await client.query('COMMIT');
        await this.cleanupIfNeeded(nowMs);
        return {
          allowed: true,
          count: 1,
          resetAtMs: nextResetAtMs
        };
      }

      if (currentCount >= limit) {
        await client.query('COMMIT');
        await this.cleanupIfNeeded(nowMs);
        return {
          allowed: false,
          count: currentCount,
          resetAtMs
        };
      }

      const nextCount = currentCount + 1;
      await client.query(
        `
        UPDATE ledger_read_rate_limits
        SET count = $2, updated_at = NOW()
        WHERE bucket_key = $1
        `,
        [bucketKey, nextCount]
      );
      await client.query('COMMIT');
      await this.cleanupIfNeeded(nowMs);
      return {
        allowed: true,
        count: nextCount,
        resetAtMs
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async cleanupIfNeeded(nowMs: number): Promise<void> {
    if (nowMs - this.lastCleanupAtMs < this.cleanupIntervalMs) {
      return;
    }
    if (this.cleanupPromise) {
      return this.cleanupPromise;
    }
    this.lastCleanupAtMs = nowMs;
    this.cleanupPromise = this.runCleanup(nowMs).finally(() => {
      this.cleanupPromise = null;
    });
    await this.cleanupPromise;
  }

  private async runCleanup(nowMs: number): Promise<void> {
    const cutoffMs = nowMs - this.cleanupRetentionMs;
    const client = await this.pool.connect();
    try {
      const lockResult = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [PostgresReadRateLimitBackend.CLEANUP_ADVISORY_LOCK_KEY]
      );
      if (!lockResult.rows[0]?.locked) {
        return;
      }

      while (true) {
        const deleteResult = await client.query(
          `
          WITH target AS (
            SELECT bucket_key
            FROM ledger_read_rate_limits
            WHERE reset_at < to_timestamp($1 / 1000.0)
            ORDER BY reset_at ASC
            LIMIT $2
          )
          DELETE FROM ledger_read_rate_limits l
          USING target t
          WHERE l.bucket_key = t.bucket_key
          `,
          [cutoffMs, this.cleanupBatchSize]
        );
        const deletedRows = deleteResult.rowCount ?? 0;
        if (deletedRows < this.cleanupBatchSize) {
          break;
        }
      }
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [PostgresReadRateLimitBackend.CLEANUP_ADVISORY_LOCK_KEY]);
      } catch {
        // ignore unlock errors
      }
      client.release();
    }
  }
}
