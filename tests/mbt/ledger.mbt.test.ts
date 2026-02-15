import { describe, it } from 'vitest';
import fc from 'fast-check';
import { LedgerService } from '../../src/services/ledger-service.js';

type Model = {
  balance: number;
};

type Real = {
  service: LedgerService;
  tenantId: string;
  userAccountId: string;
  systemAccountId: string;
};

class EarnCommand implements fc.Command<Model, Real> {
  constructor(private readonly amount: number) {}

  check(): boolean {
    return true;
  }

  async run(model: Model, real: Real): Promise<void> {
    await real.service.postTransaction({
      tenantId: real.tenantId,
      txType: 'EARN',
      entries: [
        { accountId: real.userAccountId, amount: this.amount, expiresAt: '2027-01-01T00:00:00.000Z' },
        { accountId: real.systemAccountId, amount: -this.amount }
      ]
    });
    model.balance += this.amount;
  }

  toString(): string {
    return `Earn(${this.amount})`;
  }
}

class SpendCommand implements fc.Command<Model, Real> {
  constructor(private readonly amount: number) {}

  check(model: Readonly<Model>): boolean {
    return model.balance >= this.amount;
  }

  async run(model: Model, real: Real): Promise<void> {
    await real.service.postTransaction({
      tenantId: real.tenantId,
      txType: 'SPEND',
      spend: { accountId: real.userAccountId, amount: this.amount },
      counterAccountId: real.systemAccountId
    });
    model.balance -= this.amount;
  }

  toString(): string {
    return `Spend(${this.amount})`;
  }
}

describe('MBT: ledger state transitions', () => {
  it('earn/spend状態遷移でモデル残高と実残高が一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(
          [
            fc.integer({ min: 1, max: 20 }).map((amount) => new EarnCommand(amount)),
            fc.integer({ min: 1, max: 20 }).map((amount) => new SpendCommand(amount))
          ],
          { maxCommands: 40 }
        ),
        async (commands) => {
          const service = new LedgerService();
          const tenantId = 't-mbt';
          const system = await service.createAccount({ tenantId, ownerType: 'SYSTEM', ownerId: 'SYSTEM' });
          const user = await service.createAccount({ tenantId, ownerType: 'USER', ownerId: 'u-mbt' });

          const setup = (): { model: Model; real: Real } => ({
            model: { balance: 0 },
            real: {
              service,
              tenantId,
              userAccountId: user.accountId,
              systemAccountId: system.accountId
            }
          });

          await fc.asyncModelRun(setup, commands);
        }
      ),
      { numRuns: 30 }
    );
  });
});
