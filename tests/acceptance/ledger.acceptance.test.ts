import { describe, expect, it } from 'vitest';
import { LedgerService } from '../../src/services/ledger-service.js';

async function setupLedger() {
  const service = new LedgerService();
  const tenantId = 't-acc';
  const system = await service.createAccount({ tenantId, ownerType: 'SYSTEM', ownerId: 'SYSTEM' });
  const user = await service.createAccount({ tenantId, ownerType: 'USER', ownerId: 'u-acc' });
  return { service, tenantId, system, user };
}

describe('Acceptance Criteria', () => {
  it('LG-ACC-01: 同時SPENDで過剰消費が起きない', async () => {
    const { service, tenantId, system, user } = await setupLedger();

    await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: user.accountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
        { accountId: system.accountId, amount: -100 }
      ]
    });

    const [r1, r2] = await Promise.allSettled([
      service.postTransaction({
        tenantId,
        txType: 'SPEND',
        spend: { accountId: user.accountId, amount: 80 },
        counterAccountId: system.accountId
      }),
      service.postTransaction({
        tenantId,
        txType: 'SPEND',
        spend: { accountId: user.accountId, amount: 80 },
        counterAccountId: system.accountId
      })
    ]);

    expect([r1, r2].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect([r1, r2].filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await service.getAccount(tenantId, user.accountId)).balance).toBe(20);
  });

  it('LG-ACC-02: idempotency_key再送で二重計上されない', async () => {
    const { service, tenantId, system, user } = await setupLedger();

    const first = await service.postTransaction({
      tenantId,
      txType: 'EARN',
      createdByUserId: 'admin',
      idempotencyKey: 'acc-02-k1',
      entries: [
        { accountId: user.accountId, amount: 30, expiresAt: '2026-12-31T00:00:00.000Z' },
        { accountId: system.accountId, amount: -30 }
      ]
    });

    const second = await service.postTransaction({
      tenantId,
      txType: 'EARN',
      createdByUserId: 'admin',
      idempotencyKey: 'acc-02-k1',
      entries: [
        { accountId: user.accountId, amount: 30, expiresAt: '2026-12-31T00:00:00.000Z' },
        { accountId: system.accountId, amount: -30 }
      ]
    });

    expect(second.transaction.txId).toBe(first.transaction.txId);
    expect((await service.queryTransactions({ tenantId })).length).toBe(1);
  });

  it('LG-ACC-03: 失効後、期限切れlotは残高に寄与しない', async () => {
    const { service, tenantId, system, user } = await setupLedger();

    await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: user.accountId, amount: 55, expiresAt: '2026-01-01T00:00:00.000Z' },
        { accountId: system.accountId, amount: -55 }
      ]
    });

    await service.expireLots(tenantId, new Date('2026-02-01T00:00:00.000Z'));

    const account = await service.getAccount(tenantId, user.accountId);
    const lots = await service.listLots(tenantId, user.accountId);
    expect(account.balance).toBe(0);
    expect(lots[0]?.status).toBe('EXPIRED');
    expect(lots[0]?.remainingAmount).toBe(0);
  });

  it('LG-ACC-04: EARN取消は未消費lotのみ可能', async () => {
    const { service, tenantId, system, user } = await setupLedger();

    const earn = await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: user.accountId, amount: 80, expiresAt: '2026-12-31T00:00:00.000Z' },
        { accountId: system.accountId, amount: -80 }
      ]
    });

    await service.postTransaction({
      tenantId,
      txType: 'SPEND',
      spend: { accountId: user.accountId, amount: 10 },
      counterAccountId: system.accountId
    });

    await expect(service.reverseTransaction(tenantId, earn.transaction.txId)).rejects.toMatchObject({
      code: 'EARN_ALREADY_CONSUMED'
    });
  });
});
