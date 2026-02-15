import { describe, expect, it } from 'vitest';
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
});
