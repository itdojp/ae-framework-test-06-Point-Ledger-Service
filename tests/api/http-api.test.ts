import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/http/app.js';

describe('HTTP API', () => {
  it('accounts->earn->spendフローが動作する', async () => {
    const app = buildApp();

    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-api', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-api', ownerType: 'USER', ownerId: 'u-api' }
    });

    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);

    const system = systemRes.json();
    const user = userRes.json();

    const earnRes = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-api',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -100 }
        ]
      }
    });

    expect(earnRes.statusCode).toBe(200);

    const spendRes = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-api',
        txType: 'SPEND',
        spend: { accountId: user.accountId, amount: 40 },
        counterAccountId: system.accountId
      }
    });

    expect(spendRes.statusCode).toBe(200);

    const accountRes = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${user.accountId}?tenantId=t-api`
    });
    expect(accountRes.statusCode).toBe(200);
    expect(accountRes.json().balance).toBe(60);

    await app.close();
  });
});
