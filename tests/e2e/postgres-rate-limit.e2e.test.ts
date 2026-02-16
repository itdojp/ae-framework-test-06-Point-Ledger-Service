import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildApp } from '../../src/http/app.js';
import { PostgresReadRateLimitBackend } from '../../src/http/postgres-read-rate-limit-backend.js';

const connectionString = process.env.LEDGER_DATABASE_URL;
const runIfDb = connectionString ? it : it.skip;

describe('Postgres Read Rate Limit E2E', () => {
  runIfDb('複数プロセス相当でレート制御キーを共有できる', async () => {
    if (!connectionString) {
      throw new Error('LEDGER_DATABASE_URL is not set');
    }

    const backend1 = new PostgresReadRateLimitBackend({ connectionString });
    const backend2 = new PostgresReadRateLimitBackend({ connectionString });
    await backend1.init();
    await backend2.init();

    const app1 = buildApp(undefined, {
      readRateLimit: {
        windowMs: 60_000,
        maxRequests: 1,
        actorKeyStrategy: 'ip',
        backend: backend1
      }
    });
    const app2 = buildApp(undefined, {
      readRateLimit: {
        windowMs: 60_000,
        maxRequests: 1,
        actorKeyStrategy: 'ip',
        backend: backend2
      }
    });

    const tenantId = `t-pg-rl-${Date.now()}`;
    const first = await app1.inject({
      method: 'GET',
      url: `/api/v1/transactions?tenantId=${tenantId}`,
      headers: { 'x-role': 'ADMIN' }
    });
    expect(first.statusCode).toBe(200);

    const second = await app2.inject({
      method: 'GET',
      url: `/api/v1/transactions?tenantId=${tenantId}`,
      headers: { 'x-role': 'ADMIN' }
    });
    expect(second.statusCode).toBe(429);
    expect(second.json().code).toBe('RATE_LIMIT_EXCEEDED');

    await app1.close();
    await app2.close();
    await backend1.close();
    await backend2.close();
  });

  runIfDb('cleanup設定で期限切れbucketをバッチ削除できる', async () => {
    if (!connectionString) {
      throw new Error('LEDGER_DATABASE_URL is not set');
    }

    const prefix = `cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const oldBucket = `${prefix}:old`;
    const triggerBucket = `${prefix}:trigger`;

    const backend = new PostgresReadRateLimitBackend({
      connectionString,
      cleanupIntervalMs: 1,
      cleanupRetentionMs: 1,
      cleanupBatchSize: 1
    });
    await backend.init();

    await backend.consume(oldBucket, 10, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await backend.consume(triggerBucket, 10, 60_000);

    const pool = new Pool({ connectionString });
    try {
      const query = await pool.query<{ bucket_key: string }>(
        `
        SELECT bucket_key
        FROM ledger_read_rate_limits
        WHERE bucket_key LIKE $1
        ORDER BY bucket_key ASC
        `,
        [`${prefix}:%`]
      );

      const keys = query.rows.map((row) => row.bucket_key);
      expect(keys.includes(oldBucket)).toBe(false);
      expect(keys.includes(triggerBucket)).toBe(true);

      await pool.query('DELETE FROM ledger_read_rate_limits WHERE bucket_key LIKE $1', [`${prefix}:%`]);
    } finally {
      await pool.end();
      await backend.close();
    }
  });
});
