# Tasks

## Use Cases
- [ ] Implement use case: Earn Points
- [ ] Implement use case: Spend Points
- [ ] Implement use case: Reverse Transaction
- [ ] Implement use case: Expire Lots

## Invariants
- [ ] Enforce invariant 1a81240f-7ed2-5343-87a1-31dd39354a80: Sum of all entry amounts in one transaction must always be zero.
- [ ] Enforce invariant 628dab44-0ff2-5eca-b327-a19578de6771: Accounts with allowNegative set to false must never have a negative balance.
- [ ] Enforce invariant 17f1695e-2096-5ef0-afa2-ea88da3ce342: Remaining amount in each lot must stay between zero and original amount.
- [ ] Enforce invariant b84f7bbb-f3c1-5422-bddf-e83f7ce13d7b: Reversal transaction entries must be sign-inverted mirror of the source transaction.
- [ ] Enforce invariant 99339359-1822-5334-8cca-7a33cfa731c8: For each `LedgerTransaction`, the sum of linked `LedgerEntry.amount` must be exactly zero.
- [ ] Enforce invariant e4e68dfd-eb18-5a8f-89d9-de2926fb789a: A `LedgerTransaction` must have at least two `LedgerEntry` records and both debit and credit directions.
- [ ] Enforce invariant 57a58b8d-6d71-5470-add0-dc774d7b4be7: Each `LedgerEntry` must reference exactly one `LedgerTransaction` and one target `Account`.
- [ ] Enforce invariant 694402d5-567d-50fb-aba9-5250edb58d4c: `LedgerEntry.amount` must be non-zero and sign indicates balance direction (positive=credit, negative=debit).

## API
- [ ] Implement API POST /api/v1/accounts
- [ ] Implement API GET /api/v1/accounts
- [ ] Implement API GET /api/v1/accounts/:accountId
- [ ] Implement API POST /api/v1/transactions
- [ ] Implement API GET /api/v1/transactions/:txId
- [ ] Implement API GET /api/v1/transactions
- [ ] Implement API POST /api/v1/transactions/:txId/reverse
- [ ] Implement API GET /api/v1/accounts/:accountId/lots
