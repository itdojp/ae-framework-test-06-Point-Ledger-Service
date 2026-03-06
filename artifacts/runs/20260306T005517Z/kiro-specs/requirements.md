---
specId: point_ledger_service
version: 1.0.0
generatedAt: 2026-03-06T00:55:23.105Z
---

# Requirements

## Overview
- Name: Point_Ledger_Service
- Description: Multi-tenant point ledger service for earning, spending, reversal, and expiration processing.

## Use Cases
- Earn Points (actor: User)
- Spend Points (actor: User)
- Reverse Transaction (actor: User)
- Expire Lots (actor: User)

## Invariants
- 1a81240f-7ed2-5343-87a1-31dd39354a80: Sum of all entry amounts in one transaction must always be zero.
- 628dab44-0ff2-5eca-b327-a19578de6771: Accounts with allowNegative set to false must never have a negative balance.
- 17f1695e-2096-5ef0-afa2-ea88da3ce342: Remaining amount in each lot must stay between zero and original amount.
- b84f7bbb-f3c1-5422-bddf-e83f7ce13d7b: Reversal transaction entries must be sign-inverted mirror of the source transaction.
- 99339359-1822-5334-8cca-7a33cfa731c8: For each `LedgerTransaction`, the sum of linked `LedgerEntry.amount` must be exactly zero.
- e4e68dfd-eb18-5a8f-89d9-de2926fb789a: A `LedgerTransaction` must have at least two `LedgerEntry` records and both debit and credit directions.
- 57a58b8d-6d71-5470-add0-dc774d7b4be7: Each `LedgerEntry` must reference exactly one `LedgerTransaction` and one target `Account`.
- 694402d5-567d-50fb-aba9-5250edb58d4c: `LedgerEntry.amount` must be non-zero and sign indicates balance direction (positive=credit, negative=debit).

## API
- POST /api/v1/accounts - Create account in tenant scope.
- GET /api/v1/accounts - Search accounts by owner and type.
- GET /api/v1/accounts/:accountId - Get account details with current balance.
- POST /api/v1/transactions - Post EARN, SPEND, or ADJUST transaction.
- GET /api/v1/transactions/:txId - Get transaction detail and linked entries.
- GET /api/v1/transactions - Search transactions by filters.
- POST /api/v1/transactions/:txId/reverse - Reverse a posted transaction.
- GET /api/v1/accounts/:accountId/lots - List lots for audit and troubleshooting.
