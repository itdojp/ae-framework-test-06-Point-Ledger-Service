# Design

## Domain Model
- Account (fields: accountId:uuid, tenantId:string, ownerType:string, ownerId:string, allowNegative:boolean, status:string)
- LedgerTransaction (fields: txId:uuid, tenantId:string, txType:string, status:string, idempotencyKey:string, postedAt:date)
- LedgerEntry (fields: entryId:uuid, txId:uuid, accountId:uuid, amount:number)
- PointLot (fields: lotId:uuid, accountId:uuid, sourceTxId:uuid, originalAmount:number, remainingAmount:number, expiresAt:date, status:string)

## Non-Functional Requirements
- (no NFR defined)

## Notes
- (add architecture notes, diagrams, and assets in ./assets)
