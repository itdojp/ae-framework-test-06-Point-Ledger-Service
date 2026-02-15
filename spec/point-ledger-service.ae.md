# Point_Ledger_Service

Multi-tenant point ledger service for earning, spending, reversal, and expiration processing.

## Glossary

- **Account**: A balance holder that belongs to a tenant and an owner.
- **LedgerTransaction**: A posted action that contains one or more ledger entries.
- **LedgerEntry**: A signed amount change applied to one account.
- **PointLot**: A granted point chunk with optional expiration datetime.
- **LotConsumption**: A mapping from a spend transaction to consumed lots.

## Domain

### Account
- **accountId** (uuid, required) - Unique account identifier in tenant scope.
- **tenantId** (string, required) - Tenant identifier for strict data isolation.
- **ownerType** (string, required) - Owner type value such as USER or SYSTEM.
- **ownerId** (string, required) - Owner identifier that links account ownership.
- **allowNegative** (boolean, required) - Flag that controls negative balance permission.
- **status** (string, required) - Operational state such as ACTIVE or SUSPENDED.

### LedgerTransaction
- **txId** (uuid, required) - Unique transaction identifier.
- **tenantId** (string, required) - Tenant identifier for transaction isolation.
- **txType** (string, required) - Transaction type like EARN, SPEND, ADJUST, EXPIRE, or REVERSAL.
- **status** (string, required) - Transaction state such as POSTED or REVERSED.
- **idempotencyKey** (string) - Optional key used to prevent duplicate posting.
- **postedAt** (date, required) - UTC timestamp when the transaction is posted.

### LedgerEntry
- **entryId** (uuid, required) - Unique entry identifier.
- **txId** (uuid, required) - Parent transaction identifier.
- **accountId** (uuid, required) - Target account identifier.
- **amount** (number, required) - Signed amount where plus means credit and minus means debit.

### PointLot
- **lotId** (uuid, required) - Unique lot identifier.
- **accountId** (uuid, required) - Account identifier that owns this lot.
- **sourceTxId** (uuid, required) - Source transaction identifier for lot creation.
- **originalAmount** (number, required) - Initial lot amount at creation.
- **remainingAmount** (number, required) - Remaining lot amount after consumption.
- **expiresAt** (date) - Optional UTC datetime for lot expiration.
- **status** (string, required) - Lot state such as ACTIVE, CONSUMED, EXPIRED, or CANCELLED.

## Invariants

- Sum of all entry amounts in one transaction must always be zero.
- Accounts with allowNegative set to false must never have a negative balance.
- Remaining amount in each lot must stay between zero and original amount.
- Reversal transaction entries must be sign-inverted mirror of the source transaction.

## Use Cases

### Earn Points
- Administrator or system grants points to a user account.
- System optionally creates a lot when expiration is specified.

### Spend Points
- User spends points from a user account.
- System consumes lots by FEFO ordering with deterministic tie-break.
- System rolls back the transaction when balance is insufficient.

### Reverse Transaction
- Authorized operator reverses a posted transaction.
- System creates a reversal transaction with mirrored entry signs.

### Expire Lots
- Batch process finds expired active lots.
- System moves remaining amount to zero and posts expire transaction.

## API

- POST /api/v1/accounts - Create account in tenant scope.
- GET /api/v1/accounts - Search accounts by owner and type.
- GET /api/v1/accounts/:accountId - Get account details with current balance.
- POST /api/v1/transactions - Post EARN, SPEND, or ADJUST transaction.
- GET /api/v1/transactions/:txId - Get transaction detail and linked entries.
- GET /api/v1/transactions - Search transactions by filters.
- POST /api/v1/transactions/:txId/reverse - Reverse a posted transaction.
- GET /api/v1/accounts/:accountId/lots - List lots for audit and troubleshooting.
