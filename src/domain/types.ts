export type OwnerType = 'USER' | 'SYSTEM';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED';
export type TxType = 'EARN' | 'SPEND' | 'ADJUST' | 'EXPIRE' | 'REVERSAL';
export type TxStatus = 'POSTED' | 'REVERSED';
export type LotStatus = 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED';

export interface Account {
  accountId: string;
  tenantId: string;
  ownerType: OwnerType;
  ownerId: string;
  unit: string;
  status: AccountStatus;
  allowNegative: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerTransaction {
  txId: string;
  tenantId: string;
  txType: TxType;
  status: TxStatus;
  createdByUserId: string | null;
  idempotencyKey: string | null;
  externalRef: string | null;
  description: string | null;
  postedAt: string;
  reversedAt: string | null;
  reversalOfTxId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntry {
  entryId: string;
  tenantId: string;
  txId: string;
  accountId: string;
  amount: number;
  createdAt: string;
}

export interface PointLot {
  lotId: string;
  tenantId: string;
  accountId: string;
  sourceTxId: string;
  originalAmount: number;
  remainingAmount: number;
  expiresAt: string | null;
  status: LotStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LotConsumption {
  consumptionId: string;
  tenantId: string;
  spendTxId: string;
  lotId: string;
  amount: number;
  createdAt: string;
}

export interface AuditLog {
  auditId: string;
  tenantId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CreateAccountInput {
  tenantId: string;
  ownerType: OwnerType;
  ownerId: string;
  unit?: string;
  status?: AccountStatus;
  allowNegative?: boolean;
}

export interface EntryInput {
  accountId: string;
  amount: number;
  expiresAt?: string | null;
}

export interface PostTransactionInput {
  tenantId: string;
  txType: 'EARN' | 'SPEND' | 'ADJUST';
  idempotencyKey?: string | null;
  externalRef?: string | null;
  description?: string | null;
  createdByUserId?: string | null;
  entries?: EntryInput[];
  spend?: {
    accountId: string;
    amount: number;
  };
  counterAccountId?: string;
}

export interface QueryTransactions {
  tenantId: string;
  accountId?: string;
  txType?: TxType;
  externalRef?: string;
  postedFrom?: string;
  postedTo?: string;
}

export interface TransactionDetail {
  transaction: LedgerTransaction;
  entries: LedgerEntry[];
  consumptions: LotConsumption[];
}

export interface LedgerSnapshot {
  accounts: Account[];
  balances: Record<string, number>;
  transactions: LedgerTransaction[];
  entries: LedgerEntry[];
  lots: PointLot[];
  consumptions: LotConsumption[];
  auditLogs: AuditLog[];
}

export interface LedgerPersistentState extends LedgerSnapshot {
  schemaVersion: 1;
}

export interface QueryAuditLogs {
  tenantId: string;
  action?: string;
  targetType?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
}
