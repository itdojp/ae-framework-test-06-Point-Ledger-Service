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

  it('口座作成はADMINのみ許可される', async () => {
    const app = buildApp();

    const memberRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: {
        'x-role': 'MEMBER',
        'x-user-id': 'u-member'
      },
      payload: { tenantId: 't-account-auth', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    expect(memberRes.statusCode).toBe(403);

    const viewerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: {
        'x-role': 'VIEWER',
        'x-user-id': 'u-viewer'
      },
      payload: { tenantId: 't-account-auth', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    expect(viewerRes.statusCode).toBe(403);

    const adminRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: {
        'x-role': 'ADMIN'
      },
      payload: { tenantId: 't-account-auth', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    expect(adminRes.statusCode).toBe(200);

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

    const earnRes = await app.inject({
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
    expect(earnRes.statusCode).toBe(200);
    const earnTxId = earnRes.json().transaction.txId as string;

    const adminLogs = await app.inject({
      method: 'GET',
      url: `/api/v1/audit-logs?tenantId=t-audit&page=1&pageSize=10&order=desc&targetId=${earnTxId}`,
      headers: { 'x-role': 'ADMIN' }
    });
    expect(adminLogs.statusCode).toBe(200);
    const logsPayload = adminLogs.json();
    expect(logsPayload.total).toBeGreaterThan(0);
    expect(logsPayload.items.length).toBeGreaterThan(0);
    expect(logsPayload.page).toBe(1);
    expect(logsPayload.pageSize).toBe(10);
    expect(logsPayload.items.every((item: { targetId: string }) => item.targetId === earnTxId)).toBe(true);

    const memberLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs?tenantId=t-audit',
      headers: { 'x-role': 'MEMBER', 'x-user-id': 'u-audit' }
    });
    expect(memberLogs.statusCode).toBe(403);

    await app.close();
  });

  it('transactions一覧はorder/page/pageSizeで取得できる', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-tx-page', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-tx-page', ownerType: 'USER', ownerId: 'u-page' }
    });
    const system = systemRes.json();
    const user = userRes.json();

    const tx1 = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-tx-page',
        txType: 'EARN',
        externalRef: 'tx-1',
        entries: [
          { accountId: user.accountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -100 }
        ]
      }
    });
    expect(tx1.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const tx2 = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-tx-page',
        txType: 'ADJUST',
        externalRef: 'tx-2',
        entries: [
          { accountId: user.accountId, amount: 10, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -10 }
        ]
      }
    });
    expect(tx2.statusCode).toBe(200);

    const page1 = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-tx-page&order=desc&page=1&pageSize=1'
    });
    expect(page1.statusCode).toBe(200);
    expect(page1.json()).toHaveLength(1);
    expect(page1.json()[0].externalRef).toBe('tx-2');

    const page2 = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-tx-page&order=desc&page=2&pageSize=1'
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json()).toHaveLength(1);
    expect(page2.json()[0].externalRef).toBe('tx-1');

    const byExternalRef = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-tx-page&externalRef=tx-1'
    });
    expect(byExternalRef.statusCode).toBe(200);
    expect(byExternalRef.json()).toHaveLength(1);
    expect(byExternalRef.json()[0].externalRef).toBe('tx-1');

    await app.close();
  });

  it('metricsはADMINのみ参照できる', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-metrics', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-metrics', ownerType: 'USER', ownerId: 'u-metrics' }
    });
    const system = systemRes.json();
    const user = userRes.json();

    const earnRes = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-metrics',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 25, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -25 }
        ]
      }
    });
    expect(earnRes.statusCode).toBe(200);

    const adminMetrics = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics?tenantId=t-metrics',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(adminMetrics.statusCode).toBe(200);
    const payload = adminMetrics.json();
    expect(payload.tenantId).toBe('t-metrics');
    expect(payload.accounts.total).toBe(2);
    expect(payload.transactions.byType.EARN).toBeGreaterThanOrEqual(1);
    expect(payload.auditLogs).toBeGreaterThanOrEqual(1);

    const memberMetrics = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics?tenantId=t-metrics',
      headers: { 'x-role': 'MEMBER', 'x-user-id': 'u-metrics' }
    });
    expect(memberMetrics.statusCode).toBe(403);

    await app.close();
  });

  it('VIEWER/MEMBERは自己口座のみ参照できる', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rbac-read', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const user1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rbac-read', ownerType: 'USER', ownerId: 'u1' }
    });
    const user2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rbac-read', ownerType: 'USER', ownerId: 'u2' }
    });
    const system = systemRes.json();
    const user1 = user1Res.json();
    const user2 = user2Res.json();

    await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-rbac-read',
        txType: 'EARN',
        entries: [
          { accountId: user1.accountId, amount: 60, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -60 }
        ]
      }
    });

    const viewerList = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts?tenantId=t-rbac-read',
      headers: { 'x-role': 'VIEWER', 'x-user-id': 'u2' }
    });
    expect(viewerList.statusCode).toBe(200);
    expect(viewerList.json()).toHaveLength(1);
    expect(viewerList.json()[0]?.ownerId).toBe('u2');

    const viewerOther = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${user1.accountId}?tenantId=t-rbac-read`,
      headers: { 'x-role': 'VIEWER', 'x-user-id': 'u2' }
    });
    expect(viewerOther.statusCode).toBe(403);

    const memberTxs = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rbac-read',
      headers: { 'x-role': 'MEMBER', 'x-user-id': 'u2' }
    });
    expect(memberTxs.statusCode).toBe(200);
    expect(memberTxs.json()).toHaveLength(0);

    const memberTxsOwner = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rbac-read',
      headers: { 'x-role': 'MEMBER', 'x-user-id': 'u1' }
    });
    expect(memberTxsOwner.statusCode).toBe(200);
    expect(memberTxsOwner.json().length).toBeGreaterThan(0);

    expect(user2.ownerId).toBe('u2');
    await app.close();
  });

  it('読取系レート制御を超過すると429になる', async () => {
    const app = buildApp(undefined, {
      readRateLimit: {
        windowMs: 60_000,
        maxRequests: 1
      }
    });
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rate', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rate', ownerType: 'USER', ownerId: 'u-rate' }
    });
    const system = systemRes.json();
    const user = userRes.json();

    const earnRes = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-rate',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 20, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -20 }
        ]
      }
    });
    expect(earnRes.statusCode).toBe(200);

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rate',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-ratelimit-limit']).toBe('1');
    expect(first.headers['x-ratelimit-remaining']).toBe('0');
    expect(first.headers['x-ratelimit-reset']).toBeDefined();

    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rate',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(second.statusCode).toBe(429);
    expect(second.json().code).toBe('RATE_LIMIT_EXCEEDED');
    expect(second.headers['retry-after']).toBeDefined();
    expect(second.headers['x-ratelimit-limit']).toBe('1');
    expect(second.headers['x-ratelimit-remaining']).toBe('0');

    await app.close();
  });

  it('role別レート上限を適用できる', async () => {
    const app = buildApp(undefined, {
      readRateLimit: {
        windowMs: 60_000,
        maxRequests: 1,
        maxRequestsByRole: {
          ADMIN: 2
        }
      }
    });
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rate-role', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rate-role', ownerType: 'USER', ownerId: 'u-rate-role' }
    });
    const system = systemRes.json();
    const user = userRes.json();

    const earnRes = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-rate-role',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 30, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -30 }
        ]
      }
    });
    expect(earnRes.statusCode).toBe(200);

    const admin1 = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rate-role',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(admin1.statusCode).toBe(200);
    expect(admin1.headers['x-ratelimit-limit']).toBe('2');
    expect(admin1.headers['x-ratelimit-remaining']).toBe('1');

    const admin2 = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rate-role',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(admin2.statusCode).toBe(200);
    expect(admin2.headers['x-ratelimit-limit']).toBe('2');
    expect(admin2.headers['x-ratelimit-remaining']).toBe('0');

    const admin3 = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rate-role',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(admin3.statusCode).toBe(429);
    expect(admin3.json().code).toBe('RATE_LIMIT_EXCEEDED');

    await app.close();
  });

  it('scope別レート上限を適用できる', async () => {
    const app = buildApp(undefined, {
      readRateLimit: {
        windowMs: 60_000,
        maxRequests: 5,
        maxRequestsByScope: {
          transactions: 1,
          metrics: 2
        }
      }
    });
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rate-scope', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rate-scope', ownerType: 'USER', ownerId: 'u-rate-scope' }
    });
    const system = systemRes.json();
    const user = userRes.json();

    const earnRes = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-rate-scope',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 30, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -30 }
        ]
      }
    });
    expect(earnRes.statusCode).toBe(200);

    const tx1 = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rate-scope',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(tx1.statusCode).toBe(200);
    expect(tx1.headers['x-ratelimit-limit']).toBe('1');

    const tx2 = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rate-scope',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(tx2.statusCode).toBe(429);

    const metrics1 = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics?tenantId=t-rate-scope',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(metrics1.statusCode).toBe(200);
    expect(metrics1.headers['x-ratelimit-limit']).toBe('2');

    const metrics2 = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics?tenantId=t-rate-scope',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(metrics2.statusCode).toBe(200);
    expect(metrics2.headers['x-ratelimit-limit']).toBe('2');

    const metrics3 = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics?tenantId=t-rate-scope',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(metrics3.statusCode).toBe(429);

    await app.close();
  });

  it('metricsにレート制御のruntimeカウンタを含める', async () => {
    const app = buildApp(undefined, {
      readRateLimit: {
        windowMs: 60_000,
        maxRequests: 1,
        maxRequestsByScope: {
          metrics: 5
        }
      }
    });
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rate-runtime', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rate-runtime', ownerType: 'USER', ownerId: 'u-rate-runtime' }
    });
    const system = systemRes.json();
    const user = userRes.json();

    await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-rate-runtime',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 10, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -10 }
        ]
      }
    });

    const tx1 = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rate-runtime',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(tx1.statusCode).toBe(200);

    const tx2 = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rate-runtime',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(tx2.statusCode).toBe(429);

    const metrics = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics?tenantId=t-rate-runtime',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(metrics.statusCode).toBe(200);
    const payload = metrics.json();
    expect(payload.runtime.rateLimit.enabled).toBe(true);
    expect(payload.runtime.rateLimit.backendKind).toBe('memory');
    expect(payload.runtime.rateLimit.actorKeyStrategy).toBe('role_user');
    expect(payload.runtime.rateLimit.scopes.transactions.allowed).toBeGreaterThanOrEqual(1);
    expect(payload.runtime.rateLimit.scopes.transactions.blocked).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('actorKeyStrategy=ipでは別ユーザーでも同一IPなら上限を共有する', async () => {
    const app = buildApp(undefined, {
      readRateLimit: {
        windowMs: 60_000,
        maxRequests: 1,
        actorKeyStrategy: 'ip'
      }
    });

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rate-actor',
      headers: { 'x-role': 'MEMBER', 'x-user-id': 'u1' }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-rate-actor',
      headers: { 'x-role': 'MEMBER', 'x-user-id': 'u2' }
    });
    expect(second.statusCode).toBe(429);
    expect(second.json().code).toBe('RATE_LIMIT_EXCEEDED');

    await app.close();
  });
});
