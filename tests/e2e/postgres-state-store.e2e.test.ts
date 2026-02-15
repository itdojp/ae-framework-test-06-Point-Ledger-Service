import { describe, expect, it } from 'vitest';
import { LedgerService } from '../../src/services/ledger-service.js';
import { PostgresStateStore } from '../../src/persistence/postgres-state-store.js';

const connectionString = process.env.LEDGER_DATABASE_URL;
const runIfDb = connectionString ? it : it.skip;

describe('PostgresStateStore E2E', () => {
  runIfDb('PostgreSQLに保存した状態を復元できる', async () => {
    if (!connectionString) {
      throw new Error('LEDGER_DATABASE_URL is not set');
    }

    const tenantId = 't-pg-e2e';
    const stateKey = `pg-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const storeForWrite = new PostgresStateStore({ connectionString, stateKey });
    await storeForWrite.init();
    const writer = new LedgerService({ stateStore: storeForWrite });

    const system = await writer.createAccount({ tenantId, ownerType: 'SYSTEM', ownerId: 'SYSTEM' });
    const user = await writer.createAccount({ tenantId, ownerType: 'USER', ownerId: 'u-pg' });

    await writer.postTransaction({
      tenantId,
      txType: 'EARN',
      createdByUserId: 'admin',
      idempotencyKey: 'pg-e2e-k1',
      entries: [
        { accountId: user.accountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
        { accountId: system.accountId, amount: -100 }
      ]
    });
    await writer.postTransaction({
      tenantId,
      txType: 'SPEND',
      spend: { accountId: user.accountId, amount: 40 },
      counterAccountId: system.accountId
    });
    await writer.saveState();
    await storeForWrite.close();

    const storeForRead = new PostgresStateStore({ connectionString, stateKey });
    await storeForRead.init();
    const reader = new LedgerService({ stateStore: storeForRead });
    const loaded = await reader.loadState();
    expect(loaded).toBe(true);

    const restoredUser = await reader.getAccount(tenantId, user.accountId);
    expect(restoredUser.balance).toBe(60);

    const replay = await reader.postTransaction({
      tenantId,
      txType: 'EARN',
      createdByUserId: 'admin',
      idempotencyKey: 'pg-e2e-k1',
      entries: [
        { accountId: user.accountId, amount: 100, expiresAt: '2026-12-31T00:00:00.000Z' },
        { accountId: system.accountId, amount: -100 }
      ]
    });
    expect(replay.transaction.txType).toBe('EARN');

    await storeForRead.close();
  });
});
