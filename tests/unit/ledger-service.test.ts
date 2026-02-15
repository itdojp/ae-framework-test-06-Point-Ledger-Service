import { describe, expect, it } from 'vitest';
import { LedgerService } from '../../src/services/ledger-service.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function setup(): Promise<{
  service: LedgerService;
  tenantId: string;
  userAccountId: string;
  systemAccountId: string;
}> {
  const service = new LedgerService();
  const tenantId = 't-1';
  const system = await service.createAccount({ tenantId, ownerType: 'SYSTEM', ownerId: 'SYSTEM' });
  const user = await service.createAccount({ tenantId, ownerType: 'USER', ownerId: 'u-1' });
  return { service, tenantId, userAccountId: user.accountId, systemAccountId: system.accountId };
}

describe('LedgerService', () => {
  it('EARNでロットを作成して残高を更新する', async () => {
    const { service, tenantId, userAccountId, systemAccountId } = await setup();

    await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: userAccountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
        { accountId: systemAccountId, amount: -100 }
      ]
    });

    const user = await service.getAccount(tenantId, userAccountId);
    const system = await service.getAccount(tenantId, systemAccountId);
    const lots = await service.listLots(tenantId, userAccountId);

    expect(user.balance).toBe(100);
    expect(system.balance).toBe(-100);
    expect(lots).toHaveLength(1);
    expect(lots[0]?.remainingAmount).toBe(100);
  });

  it('SPENDはFEFOでロット消費する', async () => {
    const { service, tenantId, userAccountId, systemAccountId } = await setup();

    await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: userAccountId, amount: 50, expiresAt: '2026-03-01T00:00:00.000Z' },
        { accountId: systemAccountId, amount: -50 }
      ]
    });
    await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: userAccountId, amount: 100, expiresAt: '2026-06-01T00:00:00.000Z' },
        { accountId: systemAccountId, amount: -100 }
      ]
    });

    const spend = await service.postTransaction({
      tenantId,
      txType: 'SPEND',
      spend: { accountId: userAccountId, amount: 70 },
      counterAccountId: systemAccountId
    });

    expect(spend.consumptions).toHaveLength(2);
    expect(spend.consumptions[0]?.amount).toBe(50);
    expect(spend.consumptions[1]?.amount).toBe(20);

    const lots = await service.listLots(tenantId, userAccountId);
    const sorted = [...lots].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    expect(sorted[0]?.remainingAmount).toBe(0);
    expect(sorted[1]?.remainingAmount).toBe(80);
  });

  it('残高不足SPENDは409で失敗し状態不変', async () => {
    const { service, tenantId, userAccountId, systemAccountId } = await setup();

    await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: userAccountId, amount: 20, expiresAt: '2026-03-01T00:00:00.000Z' },
        { accountId: systemAccountId, amount: -20 }
      ]
    });

    await expect(
      service.postTransaction({
        tenantId,
        txType: 'SPEND',
        spend: { accountId: userAccountId, amount: 30 },
        counterAccountId: systemAccountId
      })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });

    const user = await service.getAccount(tenantId, userAccountId);
    expect(user.balance).toBe(20);
  });

  it('idempotency_key再送は同一txを返す', async () => {
    const { service, tenantId, userAccountId, systemAccountId } = await setup();

    const first = await service.postTransaction({
      tenantId,
      txType: 'EARN',
      createdByUserId: 'admin',
      idempotencyKey: 'k-1',
      entries: [
        { accountId: userAccountId, amount: 40, expiresAt: '2026-12-01T00:00:00.000Z' },
        { accountId: systemAccountId, amount: -40 }
      ]
    });

    const second = await service.postTransaction({
      tenantId,
      txType: 'EARN',
      createdByUserId: 'admin',
      idempotencyKey: 'k-1',
      entries: [
        { accountId: userAccountId, amount: 40, expiresAt: '2026-12-01T00:00:00.000Z' },
        { accountId: systemAccountId, amount: -40 }
      ]
    });

    expect(second.transaction.txId).toBe(first.transaction.txId);
    const txs = await service.queryTransactions({ tenantId });
    expect(txs).toHaveLength(1);
  });

  it('EARN取消はロット未消費時のみ成功', async () => {
    const { service, tenantId, userAccountId, systemAccountId } = await setup();

    const earn = await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: userAccountId, amount: 90, expiresAt: '2026-12-31T00:00:00.000Z' },
        { accountId: systemAccountId, amount: -90 }
      ]
    });

    await service.reverseTransaction(tenantId, earn.transaction.txId, 'admin');

    const user = await service.getAccount(tenantId, userAccountId);
    expect(user.balance).toBe(0);

    const lots = await service.listLots(tenantId, userAccountId);
    expect(lots[0]?.status).toBe('CANCELLED');
  });

  it('消費済みEARN取消は409', async () => {
    const { service, tenantId, userAccountId, systemAccountId } = await setup();

    const earn = await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: userAccountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
        { accountId: systemAccountId, amount: -100 }
      ]
    });

    await service.postTransaction({
      tenantId,
      txType: 'SPEND',
      spend: { accountId: userAccountId, amount: 10 },
      counterAccountId: systemAccountId
    });

    await expect(service.reverseTransaction(tenantId, earn.transaction.txId)).rejects.toMatchObject({
      code: 'EARN_ALREADY_CONSUMED'
    });
  });

  it('SPEND取消でロット残高を復元する', async () => {
    const { service, tenantId, userAccountId, systemAccountId } = await setup();

    await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: userAccountId, amount: 60, expiresAt: '2026-12-31T00:00:00.000Z' },
        { accountId: systemAccountId, amount: -60 }
      ]
    });

    const spend = await service.postTransaction({
      tenantId,
      txType: 'SPEND',
      spend: { accountId: userAccountId, amount: 40 },
      counterAccountId: systemAccountId
    });

    await service.reverseTransaction(tenantId, spend.transaction.txId);

    const user = await service.getAccount(tenantId, userAccountId);
    expect(user.balance).toBe(60);

    const lots = await service.listLots(tenantId, userAccountId);
    expect(lots[0]?.remainingAmount).toBe(60);
  });

  it('失効バッチで期限切れロットをEXPIRE化する', async () => {
    const { service, tenantId, userAccountId, systemAccountId } = await setup();

    await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: userAccountId, amount: 25, expiresAt: '2026-01-01T00:00:00.000Z' },
        { accountId: systemAccountId, amount: -25 }
      ]
    });

    const expireResults = await service.expireLots(tenantId, new Date('2026-02-01T00:00:00.000Z'));
    expect(expireResults).toHaveLength(1);

    const lots = await service.listLots(tenantId, userAccountId);
    expect(lots[0]?.status).toBe('EXPIRED');
    expect(lots[0]?.remainingAmount).toBe(0);
  });

  it('同時SPENDでも過剰消費しない', async () => {
    const { service, tenantId, userAccountId, systemAccountId } = await setup();

    await service.postTransaction({
      tenantId,
      txType: 'EARN',
      entries: [
        { accountId: userAccountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
        { accountId: systemAccountId, amount: -100 }
      ]
    });

    const [r1, r2] = await Promise.allSettled([
      service.postTransaction({
        tenantId,
        txType: 'SPEND',
        spend: { accountId: userAccountId, amount: 80 },
        counterAccountId: systemAccountId
      }),
      service.postTransaction({
        tenantId,
        txType: 'SPEND',
        spend: { accountId: userAccountId, amount: 80 },
        counterAccountId: systemAccountId
      })
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
    const rejected = [r1, r2].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const user = await service.getAccount(tenantId, userAccountId);
    expect(user.balance).toBe(20);
  });

  it('状態ファイルに自動保存し、再起動後に復元できる', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledger-state-'));
    const stateFilePath = join(dir, 'state.json');
    try {
      const service = new LedgerService({ stateFilePath });
      const tenantId = 't-persist';
      const system = await service.createAccount({ tenantId, ownerType: 'SYSTEM', ownerId: 'SYSTEM' });
      const user = await service.createAccount({ tenantId, ownerType: 'USER', ownerId: 'u-persist' });

      await service.postTransaction({
        tenantId,
        txType: 'EARN',
        createdByUserId: 'admin',
        idempotencyKey: 'persist-k1',
        entries: [
          { accountId: user.accountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -100 }
        ]
      });
      await service.postTransaction({
        tenantId,
        txType: 'SPEND',
        spend: { accountId: user.accountId, amount: 30 },
        counterAccountId: system.accountId
      });

      const restored = new LedgerService({ stateFilePath });
      const loaded = await restored.loadStateFromFile();
      expect(loaded).toBe(true);

      const account = await restored.getAccount(tenantId, user.accountId);
      expect(account.balance).toBe(70);

      const replay = await restored.postTransaction({
        tenantId,
        txType: 'EARN',
        createdByUserId: 'admin',
        idempotencyKey: 'persist-k1',
        entries: [
          { accountId: user.accountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
          { accountId: system.accountId, amount: -100 }
        ]
      });
      const allTx = await restored.queryTransactions({ tenantId });
      expect(replay.transaction.txType).toBe('EARN');
      expect(allTx).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
