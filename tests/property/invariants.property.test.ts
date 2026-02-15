import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LedgerService } from '../../src/services/ledger-service.js';

describe('Property: invariants', () => {
  it('ランダム操作列でも取引sum=0と非負残高が維持される', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            op: fc.constantFrom<'earn' | 'spend'>('earn', 'spend'),
            amount: fc.integer({ min: 1, max: 30 })
          }),
          { minLength: 1, maxLength: 40 }
        ),
        async (ops) => {
          const service = new LedgerService();
          const tenantId = 't-prop';
          const system = await service.createAccount({ tenantId, ownerType: 'SYSTEM', ownerId: 'SYSTEM' });
          const user = await service.createAccount({ tenantId, ownerType: 'USER', ownerId: 'u-prop' });

          for (const [index, op] of ops.entries()) {
            if (op.op === 'earn') {
              await service.postTransaction({
                tenantId,
                txType: 'EARN',
                idempotencyKey: `earn-${index}`,
                createdByUserId: 'admin',
                entries: [
                  { accountId: user.accountId, amount: op.amount, expiresAt: '2027-01-01T00:00:00.000Z' },
                  { accountId: system.accountId, amount: -op.amount }
                ]
              });
            } else {
              try {
                await service.postTransaction({
                  tenantId,
                  txType: 'SPEND',
                  spend: { accountId: user.accountId, amount: op.amount },
                  counterAccountId: system.accountId
                });
              } catch {
                // 残高不足は仕様上許容
              }
            }

            const snapshot = service.snapshot(tenantId);
            for (const tx of snapshot.transactions) {
              const entries = snapshot.entries.filter((entry) => entry.txId === tx.txId);
              const txSum = entries.reduce((acc, entry) => acc + entry.amount, 0);
              expect(txSum).toBe(0);
            }

            const userBalance = snapshot.balances[user.accountId] ?? 0;
            expect(userBalance).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
