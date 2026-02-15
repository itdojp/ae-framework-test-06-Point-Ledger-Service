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

  it('VIEWERは取引登録できない', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rbac', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rbac', ownerType: 'USER', ownerId: 'u-rbac' }
    });

    const system = systemRes.json();
    const user = userRes.json();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: {
        'x-role': 'VIEWER',
        'x-user-id': 'u-rbac'
      },
      payload: {
        tenantId: 't-rbac',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -100 }
        ]
      }
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('MEMBERは他人口座のSPENDができない', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rbac-2', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const user1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rbac-2', ownerType: 'USER', ownerId: 'u1' }
    });
    const user2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rbac-2', ownerType: 'USER', ownerId: 'u2' }
    });

    const system = systemRes.json();
    const user1 = user1Res.json();
    const user2 = user2Res.json();

    await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-rbac-2',
        txType: 'EARN',
        entries: [
          { accountId: user1.accountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -100 }
        ]
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: {
        'x-role': 'MEMBER',
        'x-user-id': 'u2'
      },
      payload: {
        tenantId: 't-rbac-2',
        txType: 'SPEND',
        spend: { accountId: user1.accountId, amount: 10 },
        counterAccountId: system.accountId
      }
    });

    expect(response.statusCode).toBe(403);

    const ownSpendResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: {
        'x-role': 'MEMBER',
        'x-user-id': 'u1'
      },
      payload: {
        tenantId: 't-rbac-2',
        txType: 'SPEND',
        spend: { accountId: user1.accountId, amount: 10 },
        counterAccountId: system.accountId
      }
    });

    expect(ownSpendResponse.statusCode).toBe(200);
    expect(user2.ownerId).toBe('u2');
    await app.close();
  });

  it('ADMINは監査ログ参照でき、MEMBERは参照不可', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-audit', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-audit', ownerType: 'USER', ownerId: 'u-audit' }
    });
    const system = systemRes.json();
    const user = userRes.json();

    await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-audit',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 50, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -50 }
        ]
      }
    });

    const adminLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs?tenantId=t-audit',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(adminLogs.statusCode).toBe(200);
    expect(adminLogs.json().length).toBeGreaterThan(0);

    const memberLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs?tenantId=t-audit',
      headers: { 'x-role': 'MEMBER', 'x-user-id': 'u-audit' }
    });
    expect(memberLogs.statusCode).toBe(403);

    await app.close();
  });
});
