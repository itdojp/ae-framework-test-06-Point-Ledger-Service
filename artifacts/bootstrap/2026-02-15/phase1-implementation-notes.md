# Phase 1 Implementation Notes

## Scope
- TypeScript + Fastify API baseline
- In-memory ledger domain implementation
- FEFO spend allocation
- Reversal and expiration batch
- Unit/API/Property/MBT tests

## Files Added
- src/domain/*
- src/services/*
- src/http/*
- tests/unit/*
- tests/api/*
- tests/property/*
- tests/mbt/*
- package.json, tsconfig.json, vitest.config.ts

## Validation Plan
1. pnpm install
2. pnpm run typecheck
3. pnpm run test
4. scripts/ae/evaluation-run.sh
