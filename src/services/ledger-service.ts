import { v4 as uuidv4 } from 'uuid';
import {
  Account,
  AuditLog,
  CreateAccountInput,
  EntryInput,
  LedgerEntry,
  LedgerSnapshot,
  LedgerTransaction,
  LotConsumption,
  PointLot,
  PostTransactionInput,
  QueryTransactions,
  TransactionDetail,
  TxType
} from '../domain/types.js';
import { AsyncMutex } from './async-mutex.js';
import { ConflictError, DomainError, NotFoundError } from '../domain/errors.js';

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function sortLotsForFefo(lots: PointLot[]): PointLot[] {
  return [...lots].sort((a, b) => {
    if (a.expiresAt === null && b.expiresAt === null) {
      return a.createdAt.localeCompare(b.createdAt);
    }
    if (a.expiresAt === null) {
      return 1;
    }
    if (b.expiresAt === null) {
      return -1;
    }
    const expCompare = a.expiresAt.localeCompare(b.expiresAt);
    if (expCompare !== 0) {
      return expCompare;
    }
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function sum(entries: { amount: number }[]): number {
  return entries.reduce((acc, entry) => acc + entry.amount, 0);
}

export class LedgerService {
  private readonly mutex = new AsyncMutex();
  private readonly accounts = new Map<string, Account>();
  private readonly balances = new Map<string, number>();
  private readonly transactions = new Map<string, LedgerTransaction>();
  private readonly entriesByTxId = new Map<string, LedgerEntry[]>();
  private readonly lots = new Map<string, PointLot>();
  private readonly consumptionsBySpendTx = new Map<string, LotConsumption[]>();
  private readonly auditLogs: AuditLog[] = [];
  private readonly idempotencyToTxId = new Map<string, string>();
  private readonly reversalBySourceTxId = new Map<string, string>();

  async createAccount(input: CreateAccountInput): Promise<Account> {
    return this.mutex.runExclusive(async () => {
      const timestamp = nowIso();

      if (input.ownerType === 'SYSTEM') {
        const existingSystem = [...this.accounts.values()].find((account) => {
          return account.tenantId === input.tenantId && account.ownerType === 'SYSTEM';
        });
        if (existingSystem) {
          throw new ConflictError('SYSTEM_ACCOUNT_EXISTS', 'SYSTEM account already exists in tenant');
        }
      }

      const account: Account = {
        accountId: uuidv4(),
        tenantId: input.tenantId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        unit: input.unit ?? 'POINT',
        status: input.status ?? 'ACTIVE',
        allowNegative: input.allowNegative ?? (input.ownerType === 'SYSTEM'),
        version: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      this.accounts.set(account.accountId, account);
      this.balances.set(account.accountId, 0);
      return { ...account };
    });
  }

  async getAccount(tenantId: string, accountId: string): Promise<Account & { balance: number }> {
    const account = this.accounts.get(accountId);
    if (!account || account.tenantId !== tenantId) {
      throw new NotFoundError('Account not found');
    }

    return { ...account, balance: this.balances.get(accountId) ?? 0 };
  }

  async listAccounts(tenantId: string, filters?: { ownerType?: string; ownerId?: string }): Promise<(Account & { balance: number })[]> {
    return [...this.accounts.values()]
      .filter((account) => account.tenantId === tenantId)
      .filter((account) => !filters?.ownerType || account.ownerType === filters.ownerType)
      .filter((account) => !filters?.ownerId || account.ownerId === filters.ownerId)
      .map((account) => ({ ...account, balance: this.balances.get(account.accountId) ?? 0 }));
  }

  async listLots(tenantId: string, accountId: string): Promise<PointLot[]> {
    const account = this.accounts.get(accountId);
    if (!account || account.tenantId !== tenantId) {
      throw new NotFoundError('Account not found');
    }

    return [...this.lots.values()]
      .filter((lot) => lot.tenantId === tenantId && lot.accountId === accountId)
      .map((lot) => ({ ...lot }));
  }

  async postTransaction(input: PostTransactionInput): Promise<TransactionDetail> {
    return this.mutex.runExclusive(async () => {
      const idempotencyKey = input.idempotencyKey?.trim() || null;
      const actor = input.createdByUserId ?? 'system';
      if (idempotencyKey) {
        const key = `${input.tenantId}:${actor}:${idempotencyKey}`;
        const existingTxId = this.idempotencyToTxId.get(key);
        if (existingTxId) {
          return this.getTransactionDetailInternal(input.tenantId, existingTxId);
        }
      }

      const timestamp = nowIso();
      let entries: EntryInput[] = [];
      let consumptions: LotConsumption[] = [];

      if (input.txType === 'SPEND') {
        const spend = input.spend;
        if (!spend || !input.counterAccountId) {
          throw new DomainError('INVALID_SPEND_INPUT', 'spend and counterAccountId are required for SPEND', 400);
        }
        if (spend.amount <= 0) {
          throw new DomainError('INVALID_SPEND_AMOUNT', 'spend.amount must be greater than zero', 400);
        }

        const spendAccount = this.requireAccount(input.tenantId, spend.accountId);
        const counterAccount = this.requireAccount(input.tenantId, input.counterAccountId);
        this.ensureAccountActive(spendAccount);
        this.ensureAccountActive(counterAccount);

        const candidateLots = sortLotsForFefo(
          [...this.lots.values()].filter((lot) => {
            return (
              lot.tenantId === input.tenantId &&
              lot.accountId === spend.accountId &&
              lot.status === 'ACTIVE' &&
              lot.remainingAmount > 0 &&
              (lot.expiresAt === null || lot.expiresAt > timestamp)
            );
          })
        );

        let required = spend.amount;
        const plannedConsumptions: LotConsumption[] = [];

        for (const lot of candidateLots) {
          if (required <= 0) {
            break;
          }
          const consumeAmount = Math.min(required, lot.remainingAmount);
          required -= consumeAmount;
          plannedConsumptions.push({
            consumptionId: uuidv4(),
            tenantId: input.tenantId,
            spendTxId: '__PENDING__',
            lotId: lot.lotId,
            amount: consumeAmount,
            createdAt: timestamp
          });
        }

        if (required > 0) {
          throw new ConflictError('INSUFFICIENT_BALANCE', 'Insufficient balance');
        }

        entries = [
          { accountId: spend.accountId, amount: -spend.amount },
          { accountId: input.counterAccountId, amount: spend.amount }
        ];
        consumptions = plannedConsumptions;
      } else {
        if (!input.entries || input.entries.length === 0) {
          throw new DomainError('INVALID_ENTRIES', 'entries are required for EARN/ADJUST', 400);
        }
        entries = input.entries;
      }

      if (sum(entries) !== 0) {
        throw new DomainError('TX_SUM_NOT_ZERO', 'sum(entries.amount) must equal zero', 400);
      }

      for (const entry of entries) {
        this.requireAccount(input.tenantId, entry.accountId);
      }

      const stagedBalances = new Map<string, number>();
      for (const entry of entries) {
        const current = stagedBalances.get(entry.accountId) ?? this.getBalance(entry.accountId);
        stagedBalances.set(entry.accountId, current + entry.amount);
      }

      for (const [accountId, balance] of stagedBalances.entries()) {
        const account = this.requireAccount(input.tenantId, accountId);
        if (!account.allowNegative && balance < 0) {
          throw new ConflictError('INSUFFICIENT_BALANCE', 'Balance would become negative');
        }
      }

      const txId = uuidv4();
      const transaction: LedgerTransaction = {
        txId,
        tenantId: input.tenantId,
        txType: input.txType,
        status: 'POSTED',
        createdByUserId: input.createdByUserId ?? null,
        idempotencyKey,
        externalRef: input.externalRef ?? null,
        description: input.description ?? null,
        postedAt: timestamp,
        reversedAt: null,
        reversalOfTxId: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      const persistedEntries: LedgerEntry[] = entries.map((entry) => ({
        entryId: uuidv4(),
        tenantId: input.tenantId,
        txId,
        accountId: entry.accountId,
        amount: entry.amount,
        createdAt: timestamp
      }));

      for (const entry of persistedEntries) {
        const account = this.requireAccount(input.tenantId, entry.accountId);
        const nextBalance = this.getBalance(entry.accountId) + entry.amount;
        this.balances.set(entry.accountId, nextBalance);
        account.version += 1;
        account.updatedAt = timestamp;
      }

      const persistedConsumptions: LotConsumption[] = consumptions.map((consumption) => ({
        ...consumption,
        spendTxId: txId
      }));

      if (input.txType === 'SPEND') {
        for (const consumption of persistedConsumptions) {
          const lot = this.requireLot(input.tenantId, consumption.lotId);
          lot.remainingAmount -= consumption.amount;
          if (lot.remainingAmount < 0) {
            throw new DomainError('LOT_NEGATIVE', 'Lot remaining amount must not be negative', 500);
          }
          lot.status = lot.remainingAmount === 0 ? 'CONSUMED' : 'ACTIVE';
          lot.updatedAt = timestamp;
        }
      }

      if (input.txType === 'EARN' || input.txType === 'ADJUST') {
        for (const entry of entries) {
          if (entry.amount <= 0 || !entry.expiresAt) {
            continue;
          }
          const account = this.requireAccount(input.tenantId, entry.accountId);
          if (account.ownerType !== 'USER') {
            continue;
          }
          const lot: PointLot = {
            lotId: uuidv4(),
            tenantId: input.tenantId,
            accountId: entry.accountId,
            sourceTxId: txId,
            originalAmount: entry.amount,
            remainingAmount: entry.amount,
            expiresAt: entry.expiresAt ?? null,
            status: 'ACTIVE',
            createdAt: timestamp,
            updatedAt: timestamp
          };
          this.lots.set(lot.lotId, lot);
        }
      }

      this.transactions.set(txId, transaction);
      this.entriesByTxId.set(txId, persistedEntries);
      this.consumptionsBySpendTx.set(txId, persistedConsumptions);

      if (idempotencyKey) {
        const key = `${input.tenantId}:${actor}:${idempotencyKey}`;
        this.idempotencyToTxId.set(key, txId);
      }

      this.auditLogs.push({
        auditId: uuidv4(),
        tenantId: input.tenantId,
        actorUserId: input.createdByUserId ?? null,
        action: 'TX_POST',
        targetType: 'LedgerTransaction',
        targetId: txId,
        payload: { txType: input.txType },
        createdAt: timestamp
      });

      this.assertInvariantsForTenant(input.tenantId);
      return this.getTransactionDetailInternal(input.tenantId, txId);
    });
  }

  async getTransactionDetail(tenantId: string, txId: string): Promise<TransactionDetail> {
    return this.getTransactionDetailInternal(tenantId, txId);
  }

  async queryTransactions(query: QueryTransactions): Promise<LedgerTransaction[]> {
    const txs = [...this.transactions.values()]
      .filter((tx) => tx.tenantId === query.tenantId)
      .filter((tx) => !query.txType || tx.txType === query.txType)
      .filter((tx) => !query.externalRef || tx.externalRef === query.externalRef)
      .filter((tx) => !query.postedFrom || tx.postedAt >= query.postedFrom)
      .filter((tx) => !query.postedTo || tx.postedAt <= query.postedTo)
      .filter((tx) => {
        if (!query.accountId) {
          return true;
        }
        const entries = this.entriesByTxId.get(tx.txId) ?? [];
        return entries.some((entry) => entry.accountId === query.accountId);
      })
      .sort((a, b) => a.postedAt.localeCompare(b.postedAt));

    return txs.map((tx) => ({ ...tx }));
  }

  async reverseTransaction(tenantId: string, txId: string, actorUserId?: string | null): Promise<TransactionDetail> {
    return this.mutex.runExclusive(async () => {
      const sourceTx = this.transactions.get(txId);
      if (!sourceTx || sourceTx.tenantId !== tenantId) {
        throw new NotFoundError('Transaction not found');
      }

      const existingReversalTxId = this.reversalBySourceTxId.get(txId);
      if (existingReversalTxId) {
        return this.getTransactionDetailInternal(tenantId, existingReversalTxId);
      }

      if (sourceTx.txType === 'EXPIRE') {
        throw new ConflictError('REVERSAL_NOT_ALLOWED', 'EXPIRE transaction reversal is not allowed');
      }

      if (sourceTx.txType === 'EARN') {
        const sourceLots = [...this.lots.values()].filter((lot) => lot.tenantId === tenantId && lot.sourceTxId === txId);
        for (const lot of sourceLots) {
          if (lot.remainingAmount !== lot.originalAmount || lot.status !== 'ACTIVE') {
            throw new ConflictError('EARN_ALREADY_CONSUMED', 'EARN transaction lot is already consumed');
          }
        }
      }

      const sourceEntries = this.entriesByTxId.get(txId) ?? [];
      const reversalEntries: EntryInput[] = sourceEntries.map((entry) => ({
        accountId: entry.accountId,
        amount: -entry.amount
      }));

      if (sum(reversalEntries) !== 0) {
        throw new DomainError('REVERSAL_SUM_INVALID', 'Reversal entries must sum to zero', 500);
      }

      const stagedBalances = new Map<string, number>();
      for (const entry of reversalEntries) {
        const current = stagedBalances.get(entry.accountId) ?? this.getBalance(entry.accountId);
        stagedBalances.set(entry.accountId, current + entry.amount);
      }

      for (const [accountId, balance] of stagedBalances.entries()) {
        const account = this.requireAccount(tenantId, accountId);
        if (!account.allowNegative && balance < 0) {
          throw new ConflictError('INSUFFICIENT_BALANCE', 'Reversal would make balance negative');
        }
      }

      const timestamp = nowIso();
      const reversalTxId = uuidv4();
      const reversalTx: LedgerTransaction = {
        txId: reversalTxId,
        tenantId,
        txType: 'REVERSAL',
        status: 'POSTED',
        createdByUserId: actorUserId ?? null,
        idempotencyKey: null,
        externalRef: null,
        description: `reversal of ${txId}`,
        postedAt: timestamp,
        reversedAt: null,
        reversalOfTxId: txId,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      const persistedEntries: LedgerEntry[] = reversalEntries.map((entry) => ({
        entryId: uuidv4(),
        tenantId,
        txId: reversalTxId,
        accountId: entry.accountId,
        amount: entry.amount,
        createdAt: timestamp
      }));

      for (const entry of persistedEntries) {
        const account = this.requireAccount(tenantId, entry.accountId);
        const nextBalance = this.getBalance(entry.accountId) + entry.amount;
        this.balances.set(entry.accountId, nextBalance);
        account.version += 1;
        account.updatedAt = timestamp;
      }

      if (sourceTx.txType === 'EARN') {
        const sourceLots = [...this.lots.values()].filter((lot) => lot.tenantId === tenantId && lot.sourceTxId === txId);
        for (const lot of sourceLots) {
          lot.remainingAmount = 0;
          lot.status = 'CANCELLED';
          lot.updatedAt = timestamp;
        }
      }

      if (sourceTx.txType === 'SPEND') {
        const sourceConsumptions = this.consumptionsBySpendTx.get(txId) ?? [];
        for (const consumption of sourceConsumptions) {
          const lot = this.requireLot(tenantId, consumption.lotId);
          lot.remainingAmount += consumption.amount;
          if (lot.remainingAmount > lot.originalAmount) {
            throw new DomainError('LOT_OVERFLOW', 'Lot remaining amount exceeds original amount', 500);
          }
          lot.status = lot.remainingAmount === 0 ? 'CONSUMED' : 'ACTIVE';
          lot.updatedAt = timestamp;
        }
      }

      sourceTx.status = 'REVERSED';
      sourceTx.reversedAt = timestamp;
      sourceTx.updatedAt = timestamp;

      this.transactions.set(reversalTxId, reversalTx);
      this.entriesByTxId.set(reversalTxId, persistedEntries);
      this.consumptionsBySpendTx.set(reversalTxId, []);
      this.reversalBySourceTxId.set(txId, reversalTxId);

      this.auditLogs.push({
        auditId: uuidv4(),
        tenantId,
        actorUserId: actorUserId ?? null,
        action: 'TX_REVERSE',
        targetType: 'LedgerTransaction',
        targetId: reversalTxId,
        payload: { reversalOfTxId: txId },
        createdAt: timestamp
      });

      this.assertInvariantsForTenant(tenantId);
      return this.getTransactionDetailInternal(tenantId, reversalTxId);
    });
  }

  async expireLots(tenantId: string, now: Date = new Date()): Promise<TransactionDetail[]> {
    return this.mutex.runExclusive(async () => {
      const timestamp = nowIso(now);
      const systemAccount = [...this.accounts.values()].find((account) => {
        return account.tenantId === tenantId && account.ownerType === 'SYSTEM';
      });
      if (!systemAccount) {
        throw new NotFoundError('SYSTEM account not found');
      }

      const results: TransactionDetail[] = [];
      const targetLots = sortLotsForFefo(
        [...this.lots.values()].filter((lot) => {
          return (
            lot.tenantId === tenantId &&
            lot.status === 'ACTIVE' &&
            lot.remainingAmount > 0 &&
            lot.expiresAt !== null &&
            lot.expiresAt <= timestamp
          );
        })
      );

      for (const lot of targetLots) {
        const amount = lot.remainingAmount;
        if (amount <= 0) {
          continue;
        }

        const detail = await this.postInternal({
          tenantId,
          txType: 'EXPIRE',
          createdByUserId: null,
          description: `expire lot ${lot.lotId}`,
          entries: [
            { accountId: lot.accountId, amount: -amount },
            { accountId: systemAccount.accountId, amount }
          ]
        });

        lot.remainingAmount = 0;
        lot.status = 'EXPIRED';
        lot.updatedAt = timestamp;

        this.auditLogs.push({
          auditId: uuidv4(),
          tenantId,
          actorUserId: null,
          action: 'LOT_EXPIRE',
          targetType: 'PointLot',
          targetId: lot.lotId,
          payload: { txId: detail.transaction.txId, amount },
          createdAt: timestamp
        });

        results.push(detail);
      }

      this.assertInvariantsForTenant(tenantId);
      return results;
    });
  }

  snapshot(tenantId?: string): LedgerSnapshot {
    const accounts = [...this.accounts.values()]
      .filter((account) => !tenantId || account.tenantId === tenantId)
      .map((account) => ({ ...account }));

    const balances: Record<string, number> = {};
    for (const account of accounts) {
      balances[account.accountId] = this.getBalance(account.accountId);
    }

    const txs = [...this.transactions.values()]
      .filter((tx) => !tenantId || tx.tenantId === tenantId)
      .map((tx) => ({ ...tx }));

    const entries = txs.flatMap((tx) => (this.entriesByTxId.get(tx.txId) ?? []).map((entry) => ({ ...entry })));
    const lots = [...this.lots.values()]
      .filter((lot) => !tenantId || lot.tenantId === tenantId)
      .map((lot) => ({ ...lot }));
    const consumptions = txs.flatMap((tx) => (this.consumptionsBySpendTx.get(tx.txId) ?? []).map((cons) => ({ ...cons })));
    const auditLogs = this.auditLogs
      .filter((log) => !tenantId || log.tenantId === tenantId)
      .map((log) => ({ ...log }));

    return { accounts, balances, transactions: txs, entries, lots, consumptions, auditLogs };
  }

  private async postInternal(input: {
    tenantId: string;
    txType: TxType;
    description: string;
    entries: EntryInput[];
    createdByUserId: string | null;
  }): Promise<TransactionDetail> {
    if (sum(input.entries) !== 0) {
      throw new DomainError('TX_SUM_NOT_ZERO', 'sum(entries.amount) must equal zero', 400);
    }

    for (const entry of input.entries) {
      this.requireAccount(input.tenantId, entry.accountId);
    }

    const stagedBalances = new Map<string, number>();
    for (const entry of input.entries) {
      const current = stagedBalances.get(entry.accountId) ?? this.getBalance(entry.accountId);
      stagedBalances.set(entry.accountId, current + entry.amount);
    }

    for (const [accountId, balance] of stagedBalances.entries()) {
      const account = this.requireAccount(input.tenantId, accountId);
      if (!account.allowNegative && balance < 0) {
        throw new ConflictError('INSUFFICIENT_BALANCE', 'Balance would become negative');
      }
    }

    const timestamp = nowIso();
    const txId = uuidv4();
    const tx: LedgerTransaction = {
      txId,
      tenantId: input.tenantId,
      txType: input.txType,
      status: 'POSTED',
      createdByUserId: input.createdByUserId,
      idempotencyKey: null,
      externalRef: null,
      description: input.description,
      postedAt: timestamp,
      reversedAt: null,
      reversalOfTxId: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const persistedEntries: LedgerEntry[] = input.entries.map((entry) => ({
      entryId: uuidv4(),
      tenantId: input.tenantId,
      txId,
      accountId: entry.accountId,
      amount: entry.amount,
      createdAt: timestamp
    }));

    for (const entry of persistedEntries) {
      const account = this.requireAccount(input.tenantId, entry.accountId);
      const nextBalance = this.getBalance(entry.accountId) + entry.amount;
      this.balances.set(entry.accountId, nextBalance);
      account.version += 1;
      account.updatedAt = timestamp;
    }

    this.transactions.set(txId, tx);
    this.entriesByTxId.set(txId, persistedEntries);
    this.consumptionsBySpendTx.set(txId, []);

    this.auditLogs.push({
      auditId: uuidv4(),
      tenantId: input.tenantId,
      actorUserId: input.createdByUserId,
      action: 'TX_POST',
      targetType: 'LedgerTransaction',
      targetId: txId,
      payload: { txType: input.txType },
      createdAt: timestamp
    });

    return {
      transaction: { ...tx },
      entries: persistedEntries.map((entry) => ({ ...entry })),
      consumptions: []
    };
  }

  private requireAccount(tenantId: string, accountId: string): Account {
    const account = this.accounts.get(accountId);
    if (!account || account.tenantId !== tenantId) {
      throw new NotFoundError('Account not found');
    }
    return account;
  }

  private requireLot(tenantId: string, lotId: string): PointLot {
    const lot = this.lots.get(lotId);
    if (!lot || lot.tenantId !== tenantId) {
      throw new NotFoundError('Lot not found');
    }
    return lot;
  }

  private getBalance(accountId: string): number {
    return this.balances.get(accountId) ?? 0;
  }

  private getTransactionDetailInternal(tenantId: string, txId: string): TransactionDetail {
    const tx = this.transactions.get(txId);
    if (!tx || tx.tenantId !== tenantId) {
      throw new NotFoundError('Transaction not found');
    }

    return {
      transaction: { ...tx },
      entries: (this.entriesByTxId.get(txId) ?? []).map((entry) => ({ ...entry })),
      consumptions: (this.consumptionsBySpendTx.get(txId) ?? []).map((consumption) => ({ ...consumption }))
    };
  }

  private ensureAccountActive(account: Account): void {
    if (account.status !== 'ACTIVE') {
      throw new ConflictError('ACCOUNT_INACTIVE', 'Account is not active');
    }
  }

  private assertInvariantsForTenant(tenantId: string): void {
    const tenantTxs = [...this.transactions.values()].filter((tx) => tx.tenantId === tenantId);

    for (const tx of tenantTxs) {
      const entries = this.entriesByTxId.get(tx.txId) ?? [];
      if (sum(entries) !== 0) {
        throw new DomainError('INVARIANT_TX_SUM', `Transaction ${tx.txId} sum is not zero`, 500);
      }
    }

    const tenantAccounts = [...this.accounts.values()].filter((account) => account.tenantId === tenantId);
    for (const account of tenantAccounts) {
      const balance = this.getBalance(account.accountId);
      if (!account.allowNegative && balance < 0) {
        throw new DomainError('INVARIANT_NEGATIVE_BALANCE', `Account ${account.accountId} has negative balance`, 500);
      }
    }

    const tenantLots = [...this.lots.values()].filter((lot) => lot.tenantId === tenantId);
    for (const lot of tenantLots) {
      if (lot.remainingAmount < 0 || lot.remainingAmount > lot.originalAmount) {
        throw new DomainError('INVARIANT_LOT_RANGE', `Lot ${lot.lotId} remaining out of range`, 500);
      }
    }

    for (const sourceTxId of this.reversalBySourceTxId.keys()) {
      const sourceEntries = this.entriesByTxId.get(sourceTxId) ?? [];
      const reversalEntries = this.entriesByTxId.get(this.reversalBySourceTxId.get(sourceTxId) ?? '') ?? [];
      if (sourceEntries.length !== reversalEntries.length) {
        throw new DomainError('INVARIANT_REVERSAL_LENGTH', `Reversal length mismatch for ${sourceTxId}`, 500);
      }

      for (let i = 0; i < sourceEntries.length; i += 1) {
        const source = sourceEntries[i];
        const reversal = reversalEntries[i];
        if (!source || !reversal || source.accountId !== reversal.accountId || source.amount !== -reversal.amount) {
          throw new DomainError('INVARIANT_REVERSAL_MIRROR', `Reversal mismatch for ${sourceTxId}`, 500);
        }
      }
    }
  }
}
