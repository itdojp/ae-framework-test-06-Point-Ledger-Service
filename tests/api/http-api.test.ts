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

  it('sum(entries.amount) != 0 の取引は400で拒否される', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-sum-invalid', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-sum-invalid', ownerType: 'USER', ownerId: 'u-sum-invalid' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-sum-invalid',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 10, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -9 }
        ]
      }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('TX_SUM_NOT_ZERO');

    await app.close();
  });

  it('残高不足SPENDは409で拒否される', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-insufficient', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-insufficient', ownerType: 'USER', ownerId: 'u-insufficient' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const spend = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-insufficient',
        txType: 'SPEND',
        spend: { accountId: user.accountId, amount: 1 },
        counterAccountId: system.accountId
      }
    });
    expect(spend.statusCode).toBe(409);
    expect(spend.json().code).toBe('INSUFFICIENT_BALANCE');

    await app.close();
  });

  it('Idempotency-Keyヘッダで二重計上を防止できる', async () => {
    const app = buildApp();

    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-idem-header', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-idem-header', ownerType: 'USER', ownerId: 'u-idem-header' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: {
        'idempotency-key': 'idem-header-1'
      },
      payload: {
        tenantId: 't-idem-header',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 15, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -15 }
        ]
      }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: {
        'idempotency-key': 'idem-header-1'
      },
      payload: {
        tenantId: 't-idem-header',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 15, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -15 }
        ]
      }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().transaction.txId).toBe(first.json().transaction.txId);

    const txs = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-idem-header'
    });
    expect(txs.statusCode).toBe(200);
    expect(txs.json()).toHaveLength(1);

    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: {
        'idempotency-key': 'idem-header-2'
      },
      payload: {
        tenantId: 't-idem-header',
        txType: 'ADJUST',
        idempotencyKey: 'idem-body-2',
        entries: [
          { accountId: user.accountId, amount: 1, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -1 }
        ]
      }
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().code).toBe('IDEMPOTENCY_KEY_MISMATCH');

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

  it('SYSTEM口座の重複作成は409になる', async () => {
    const app = buildApp();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-system-dup', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-system-dup', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('SYSTEM_ACCOUNT_EXISTS');

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

  it('MEMBERは他者transaction詳細参照とreverse実行ができない', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rbac-tx-detail', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const user1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rbac-tx-detail', ownerType: 'USER', ownerId: 'u1' }
    });
    const user2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-rbac-tx-detail', ownerType: 'USER', ownerId: 'u2' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(user1Res.statusCode).toBe(200);
    expect(user2Res.statusCode).toBe(200);
    const system = systemRes.json();
    const user1 = user1Res.json();

    const earn = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-rbac-tx-detail',
        txType: 'EARN',
        entries: [
          { accountId: user1.accountId, amount: 15, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -15 }
        ]
      }
    });
    expect(earn.statusCode).toBe(200);
    const txId = earn.json().transaction.txId as string;

    const otherDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${txId}?tenantId=t-rbac-tx-detail`,
      headers: {
        'x-role': 'MEMBER',
        'x-user-id': 'u2'
      }
    });
    expect(otherDetail.statusCode).toBe(403);

    const memberReverse = await app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${txId}/reverse`,
      headers: {
        'x-role': 'MEMBER',
        'x-user-id': 'u2'
      },
      payload: {
        tenantId: 't-rbac-tx-detail'
      }
    });
    expect(memberReverse.statusCode).toBe(403);

    await app.close();
  });

  it('MEMBERのcreatedByUserIdはx-user-idで上書きされる', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-member-actor', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-member-actor', ownerType: 'USER', ownerId: 'u-member-actor' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const earn = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-member-actor',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 20, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -20 }
        ]
      }
    });
    expect(earn.statusCode).toBe(200);

    const firstSpend = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: {
        'x-role': 'MEMBER',
        'x-user-id': 'u-member-actor'
      },
      payload: {
        tenantId: 't-member-actor',
        txType: 'SPEND',
        idempotencyKey: 'member-actor-k1',
        createdByUserId: 'spoofed-user',
        spend: { accountId: user.accountId, amount: 5 },
        counterAccountId: system.accountId
      }
    });
    expect(firstSpend.statusCode).toBe(200);

    const secondSpend = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: {
        'x-role': 'MEMBER',
        'x-user-id': 'u-member-actor'
      },
      payload: {
        tenantId: 't-member-actor',
        txType: 'SPEND',
        idempotencyKey: 'member-actor-k1',
        spend: { accountId: user.accountId, amount: 5 },
        counterAccountId: system.accountId
      }
    });
    expect(secondSpend.statusCode).toBe(200);
    expect(secondSpend.json().transaction.txId).toBe(firstSpend.json().transaction.txId);

    await app.close();
  });

  it('tenant不一致の口座アクセスは404になる', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-auth-404-a', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    expect(systemRes.statusCode).toBe(200);

    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-auth-404-a', ownerType: 'USER', ownerId: 'u-auth-404' }
    });
    expect(userRes.statusCode).toBe(200);
    const user = userRes.json();

    const mismatch = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${user.accountId}?tenantId=t-auth-404-b`,
      headers: {
        'x-role': 'MEMBER',
        'x-user-id': 'u-auth-404'
      }
    });
    expect(mismatch.statusCode).toBe(404);

    await app.close();
  });

  it('tenant不一致のtransaction参照・取消は404になる', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-auth-tx-a', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-auth-tx-a', ownerType: 'USER', ownerId: 'u-auth-tx' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const earn = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-auth-tx-a',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 10, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -10 }
        ]
      }
    });
    expect(earn.statusCode).toBe(200);
    const txId = earn.json().transaction.txId as string;

    const mismatchDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${txId}?tenantId=t-auth-tx-b`
    });
    expect(mismatchDetail.statusCode).toBe(404);

    const mismatchReverse = await app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${txId}/reverse`,
      headers: {
        'x-role': 'ADMIN'
      },
      payload: {
        tenantId: 't-auth-tx-b'
      }
    });
    expect(mismatchReverse.statusCode).toBe(404);

    await app.close();
  });

  it('reverseは同一transactionに対して冪等に同一結果を返す', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-reverse-idem', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-reverse-idem', ownerType: 'USER', ownerId: 'u-reverse-idem' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const earn = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-reverse-idem',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 12, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -12 }
        ]
      }
    });
    expect(earn.statusCode).toBe(200);
    const sourceTxId = earn.json().transaction.txId as string;

    const firstReverse = await app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${sourceTxId}/reverse`,
      payload: {
        tenantId: 't-reverse-idem',
        actorUserId: 'admin-1'
      }
    });
    expect(firstReverse.statusCode).toBe(200);

    const secondReverse = await app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${sourceTxId}/reverse`,
      payload: {
        tenantId: 't-reverse-idem',
        actorUserId: 'admin-2'
      }
    });
    expect(secondReverse.statusCode).toBe(200);
    expect(secondReverse.json().transaction.txId).toBe(firstReverse.json().transaction.txId);
    expect(secondReverse.json().transaction.reversalOfTxId).toBe(sourceTxId);

    await app.close();
  });

  it('消費済みEARN transactionはreverseできない', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-reverse-earned-consumed', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-reverse-earned-consumed', ownerType: 'USER', ownerId: 'u-reverse-earned-consumed' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const earn = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-reverse-earned-consumed',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 20, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -20 }
        ]
      }
    });
    expect(earn.statusCode).toBe(200);
    const earnTxId = earn.json().transaction.txId as string;

    const spend = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-reverse-earned-consumed',
        txType: 'SPEND',
        spend: { accountId: user.accountId, amount: 1 },
        counterAccountId: system.accountId
      }
    });
    expect(spend.statusCode).toBe(200);

    const reverseEarn = await app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${earnTxId}/reverse`,
      payload: {
        tenantId: 't-reverse-earned-consumed'
      }
    });
    expect(reverseEarn.statusCode).toBe(409);
    expect(reverseEarn.json().code).toBe('EARN_ALREADY_CONSUMED');

    await app.close();
  });

  it('ADJUSTでexpiresAt付きentryを登録するとlotが生成される', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-adjust-lot', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-adjust-lot', ownerType: 'USER', ownerId: 'u-adjust-lot' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const adjust = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-adjust-lot',
        txType: 'ADJUST',
        entries: [
          { accountId: user.accountId, amount: 7, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -7 }
        ]
      }
    });
    expect(adjust.statusCode).toBe(200);

    const lots = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${user.accountId}/lots?tenantId=t-adjust-lot`
    });
    expect(lots.statusCode).toBe(200);
    expect(lots.json()).toHaveLength(1);
    expect(lots.json()[0].sourceTxId).toBe(adjust.json().transaction.txId);
    expect(lots.json()[0].originalAmount).toBe(7);
    expect(lots.json()[0].remainingAmount).toBe(7);
    expect(lots.json()[0].status).toBe('ACTIVE');
    expect(lots.json()[0].expiresAt).toBe('2026-12-31T00:00:00.000Z');

    await app.close();
  });

  it('SPENDはFEFO順でconsumptionを作成する', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-fefo-api', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-fefo-api', ownerType: 'USER', ownerId: 'u-fefo-api' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const earnLateExpiry = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-fefo-api',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 8, expiresAt: '2026-06-01T00:00:00.000Z' },
          { accountId: system.accountId, amount: -8 }
        ]
      }
    });
    expect(earnLateExpiry.statusCode).toBe(200);

    const earnEarlyExpiry = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-fefo-api',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 10, expiresAt: '2026-05-01T00:00:00.000Z' },
          { accountId: system.accountId, amount: -10 }
        ]
      }
    });
    expect(earnEarlyExpiry.statusCode).toBe(200);

    const lotsBeforeSpend = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${user.accountId}/lots?tenantId=t-fefo-api`
    });
    expect(lotsBeforeSpend.statusCode).toBe(200);
    const earlyLot = lotsBeforeSpend
      .json()
      .find((lot: { expiresAt: string }) => lot.expiresAt === '2026-05-01T00:00:00.000Z');
    const lateLot = lotsBeforeSpend
      .json()
      .find((lot: { expiresAt: string }) => lot.expiresAt === '2026-06-01T00:00:00.000Z');
    expect(earlyLot).toBeTruthy();
    expect(lateLot).toBeTruthy();

    const spend = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-fefo-api',
        txType: 'SPEND',
        spend: { accountId: user.accountId, amount: 15 },
        counterAccountId: system.accountId
      }
    });
    expect(spend.statusCode).toBe(200);
    expect(spend.json().consumptions).toHaveLength(2);
    expect(spend.json().consumptions[0].lotId).toBe(earlyLot.lotId);
    expect(spend.json().consumptions[0].amount).toBe(10);
    expect(spend.json().consumptions[1].lotId).toBe(lateLot.lotId);
    expect(spend.json().consumptions[1].amount).toBe(5);

    const lotsAfterSpend = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${user.accountId}/lots?tenantId=t-fefo-api`
    });
    expect(lotsAfterSpend.statusCode).toBe(200);
    const earlyLotAfter = lotsAfterSpend
      .json()
      .find((lot: { lotId: string }) => lot.lotId === earlyLot.lotId);
    const lateLotAfter = lotsAfterSpend
      .json()
      .find((lot: { lotId: string }) => lot.lotId === lateLot.lotId);
    expect(earlyLotAfter.remainingAmount).toBe(0);
    expect(earlyLotAfter.status).toBe('CONSUMED');
    expect(lateLotAfter.remainingAmount).toBe(3);
    expect(lateLotAfter.status).toBe('ACTIVE');

    await app.close();
  });

  it('SPENDのreverseでlot残高と口座残高が復元される', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-reverse-spend', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-reverse-spend', ownerType: 'USER', ownerId: 'u-reverse-spend' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const earn = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-reverse-spend',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 20, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -20 }
        ]
      }
    });
    expect(earn.statusCode).toBe(200);

    const spend = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-reverse-spend',
        txType: 'SPEND',
        spend: { accountId: user.accountId, amount: 7 },
        counterAccountId: system.accountId
      }
    });
    expect(spend.statusCode).toBe(200);
    const spendTxId = spend.json().transaction.txId as string;
    expect(spend.json().consumptions).toHaveLength(1);
    expect(spend.json().consumptions[0].amount).toBe(7);

    const reverseSpend = await app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${spendTxId}/reverse`,
      payload: {
        tenantId: 't-reverse-spend',
        actorUserId: 'admin-reverse-spend'
      }
    });
    expect(reverseSpend.statusCode).toBe(200);
    expect(reverseSpend.json().transaction.txType).toBe('REVERSAL');
    expect(reverseSpend.json().transaction.reversalOfTxId).toBe(spendTxId);

    const sourceAfterReverse = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${spendTxId}?tenantId=t-reverse-spend`
    });
    expect(sourceAfterReverse.statusCode).toBe(200);
    expect(sourceAfterReverse.json().transaction.status).toBe('REVERSED');

    const accountAfterReverse = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${user.accountId}?tenantId=t-reverse-spend`
    });
    expect(accountAfterReverse.statusCode).toBe(200);
    expect(accountAfterReverse.json().balance).toBe(20);

    const lotsAfterReverse = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${user.accountId}/lots?tenantId=t-reverse-spend`
    });
    expect(lotsAfterReverse.statusCode).toBe(200);
    expect(lotsAfterReverse.json()).toHaveLength(1);
    expect(lotsAfterReverse.json()[0].remainingAmount).toBe(20);
    expect(lotsAfterReverse.json()[0].status).toBe('ACTIVE');

    await app.close();
  });

  it('失効バッチはADMINのみ実行可能で、同一lotを二重失効しない', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-expire-idem', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-expire-idem', ownerType: 'USER', ownerId: 'u-expire-idem' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const earn = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-expire-idem',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 30, expiresAt: '2026-01-01T00:00:00.000Z' },
          { accountId: system.accountId, amount: -30 }
        ]
      }
    });
    expect(earn.statusCode).toBe(200);

    const memberExpire = await app.inject({
      method: 'POST',
      url: '/api/v1/batch/expire',
      headers: {
        'x-role': 'MEMBER',
        'x-user-id': 'u-expire-idem'
      },
      payload: {
        tenantId: 't-expire-idem',
        now: '2026-02-01T00:00:00.000Z'
      }
    });
    expect(memberExpire.statusCode).toBe(403);

    const firstExpire = await app.inject({
      method: 'POST',
      url: '/api/v1/batch/expire',
      payload: {
        tenantId: 't-expire-idem',
        now: '2026-02-01T00:00:00.000Z'
      }
    });
    expect(firstExpire.statusCode).toBe(200);
    expect(firstExpire.json()).toHaveLength(1);

    const secondExpire = await app.inject({
      method: 'POST',
      url: '/api/v1/batch/expire',
      payload: {
        tenantId: 't-expire-idem',
        now: '2026-02-01T00:00:00.000Z'
      }
    });
    expect(secondExpire.statusCode).toBe(200);
    expect(secondExpire.json()).toHaveLength(0);

    const lots = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${user.accountId}/lots?tenantId=t-expire-idem`
    });
    expect(lots.statusCode).toBe(200);
    expect(lots.json()[0].status).toBe('EXPIRED');
    expect(lots.json()[0].remainingAmount).toBe(0);

    const expiredTxs = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?tenantId=t-expire-idem&txType=EXPIRE'
    });
    expect(expiredTxs.statusCode).toBe(200);
    expect(expiredTxs.json()).toHaveLength(1);

    await app.close();
  });

  it('EXPIRE transactionはreverseできない', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-expire-reverse', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-expire-reverse', ownerType: 'USER', ownerId: 'u-expire-reverse' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const earn = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-expire-reverse',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 9, expiresAt: '2026-01-01T00:00:00.000Z' },
          { accountId: system.accountId, amount: -9 }
        ]
      }
    });
    expect(earn.statusCode).toBe(200);

    const expire = await app.inject({
      method: 'POST',
      url: '/api/v1/batch/expire',
      payload: {
        tenantId: 't-expire-reverse',
        now: '2026-02-01T00:00:00.000Z'
      }
    });
    expect(expire.statusCode).toBe(200);
    expect(expire.json()).toHaveLength(1);
    const expireTxId = expire.json()[0].transaction.txId as string;

    const reverseExpire = await app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${expireTxId}/reverse`,
      payload: {
        tenantId: 't-expire-reverse'
      }
    });
    expect(reverseExpire.statusCode).toBe(409);
    expect(reverseExpire.json().code).toBe('REVERSAL_NOT_ALLOWED');

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

  it('監査ログはactionとactorUserIdで絞り込みできる', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-audit-filter', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-audit-filter', ownerType: 'USER', ownerId: 'u-audit-filter' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const tx1 = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-audit-filter',
        txType: 'EARN',
        createdByUserId: 'actor-a',
        entries: [
          { accountId: user.accountId, amount: 20, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -20 }
        ]
      }
    });
    expect(tx1.statusCode).toBe(200);

    const tx2 = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-audit-filter',
        txType: 'ADJUST',
        createdByUserId: 'actor-b',
        entries: [
          { accountId: user.accountId, amount: 3, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -3 }
        ]
      }
    });
    expect(tx2.statusCode).toBe(200);

    const actorAOnly = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs?tenantId=t-audit-filter&action=TX_POST&actorUserId=actor-a',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(actorAOnly.statusCode).toBe(200);
    const payload = actorAOnly.json();
    expect(payload.total).toBeGreaterThan(0);
    expect(payload.items.every((item: { action: string; actorUserId: string | null }) => item.action === 'TX_POST')).toBe(true);
    expect(payload.items.every((item: { actorUserId: string | null }) => item.actorUserId === 'actor-a')).toBe(true);

    const noMatch = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs?tenantId=t-audit-filter&action=TX_POST&actorUserId=actor-z',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(noMatch.statusCode).toBe(200);
    expect(noMatch.json().total).toBe(0);
    expect(noMatch.json().items).toHaveLength(0);

    await app.close();
  });

  it('監査ログはfrom/toで時間範囲絞り込みできる', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-audit-time', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-audit-time', ownerType: 'USER', ownerId: 'u-audit-time' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const tx1 = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-audit-time',
        txType: 'EARN',
        entries: [
          { accountId: user.accountId, amount: 7, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -7 }
        ]
      }
    });
    expect(tx1.statusCode).toBe(200);
    const tx1Id = tx1.json().transaction.txId as string;

    await new Promise((resolve) => setTimeout(resolve, 5));

    const tx2 = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-audit-time',
        txType: 'ADJUST',
        entries: [
          { accountId: user.accountId, amount: 2, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -2 }
        ]
      }
    });
    expect(tx2.statusCode).toBe(200);
    const tx2Id = tx2.json().transaction.txId as string;

    const allLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs?tenantId=t-audit-time&action=TX_POST&order=asc&page=1&pageSize=100',
      headers: { 'x-role': 'ADMIN' }
    });
    expect(allLogs.statusCode).toBe(200);
    const allItems = allLogs.json().items as Array<{ targetId: string; createdAt: string }>;
    const log1 = allItems.find((item) => item.targetId === tx1Id);
    const log2 = allItems.find((item) => item.targetId === tx2Id);
    expect(log1).toBeDefined();
    expect(log2).toBeDefined();

    const fromRes = await app.inject({
      method: 'GET',
      url: `/api/v1/audit-logs?tenantId=t-audit-time&action=TX_POST&from=${encodeURIComponent(log2!.createdAt)}`,
      headers: { 'x-role': 'ADMIN' }
    });
    expect(fromRes.statusCode).toBe(200);
    const fromItems = fromRes.json().items as Array<{ targetId: string; createdAt: string }>;
    expect(fromItems.some((item) => item.targetId === tx2Id)).toBe(true);
    expect(fromItems.every((item) => item.createdAt >= log2!.createdAt)).toBe(true);

    const toRes = await app.inject({
      method: 'GET',
      url: `/api/v1/audit-logs?tenantId=t-audit-time&action=TX_POST&to=${encodeURIComponent(log1!.createdAt)}`,
      headers: { 'x-role': 'ADMIN' }
    });
    expect(toRes.statusCode).toBe(200);
    const toItems = toRes.json().items as Array<{ targetId: string; createdAt: string }>;
    expect(toItems.some((item) => item.targetId === tx1Id)).toBe(true);
    expect(toItems.every((item) => item.createdAt <= log1!.createdAt)).toBe(true);

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

  it('transactions一覧はpostedFrom/postedToで絞り込める', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-tx-time', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-tx-time', ownerType: 'USER', ownerId: 'u-time' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(userRes.statusCode).toBe(200);
    const system = systemRes.json();
    const user = userRes.json();

    const tx1 = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-tx-time',
        txType: 'EARN',
        externalRef: 'time-1',
        entries: [
          { accountId: user.accountId, amount: 10, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -10 }
        ]
      }
    });
    expect(tx1.statusCode).toBe(200);
    const tx1PostedAt = tx1.json().transaction.postedAt as string;

    await new Promise((resolve) => setTimeout(resolve, 5));

    const tx2 = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-tx-time',
        txType: 'ADJUST',
        externalRef: 'time-2',
        entries: [
          { accountId: user.accountId, amount: 1, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -1 }
        ]
      }
    });
    expect(tx2.statusCode).toBe(200);
    const tx2PostedAt = tx2.json().transaction.postedAt as string;

    const fromRes = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions?tenantId=t-tx-time&postedFrom=${encodeURIComponent(tx2PostedAt)}`
    });
    expect(fromRes.statusCode).toBe(200);
    const fromItems = fromRes.json() as Array<{ txId: string; postedAt: string }>;
    expect(fromItems.some((item) => item.txId === tx2.json().transaction.txId)).toBe(true);
    expect(fromItems.every((item) => item.postedAt >= tx2PostedAt)).toBe(true);

    const toRes = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions?tenantId=t-tx-time&postedTo=${encodeURIComponent(tx1PostedAt)}`
    });
    expect(toRes.statusCode).toBe(200);
    const toItems = toRes.json() as Array<{ txId: string; postedAt: string }>;
    expect(toItems.some((item) => item.txId === tx1.json().transaction.txId)).toBe(true);
    expect(toItems.every((item) => item.postedAt <= tx1PostedAt)).toBe(true);

    await app.close();
  });

  it('MEMBERは他人口座をaccountId指定してtransactions検索できない', async () => {
    const app = buildApp();
    const systemRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-tx-account-rbac', ownerType: 'SYSTEM', ownerId: 'SYSTEM' }
    });
    const user1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-tx-account-rbac', ownerType: 'USER', ownerId: 'u1' }
    });
    const user2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      payload: { tenantId: 't-tx-account-rbac', ownerType: 'USER', ownerId: 'u2' }
    });
    expect(systemRes.statusCode).toBe(200);
    expect(user1Res.statusCode).toBe(200);
    expect(user2Res.statusCode).toBe(200);
    const system = systemRes.json();
    const user1 = user1Res.json();

    const earn = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        tenantId: 't-tx-account-rbac',
        txType: 'EARN',
        entries: [
          { accountId: user1.accountId, amount: 10, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -10 }
        ]
      }
    });
    expect(earn.statusCode).toBe(200);

    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions?tenantId=t-tx-account-rbac&accountId=${user1.accountId}`,
      headers: {
        'x-role': 'MEMBER',
        'x-user-id': 'u2'
      }
    });
    expect(forbidden.statusCode).toBe(403);

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
