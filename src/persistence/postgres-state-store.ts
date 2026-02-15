import { Pool } from 'pg';
import { LedgerPersistentState } from '../domain/types.js';
import { StateStore } from './state-store.js';

export interface PostgresStateStoreOptions {
  connectionString: string;
  stateKey: string;
}

export class PostgresStateStore implements StateStore {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;
  private readonly stateKey: string;

  constructor(options: PostgresStateStoreOptions) {
    this.pool = new Pool({ connectionString: options.connectionString });
    this.stateKey = options.stateKey;
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ledger_state_snapshots (
        state_key TEXT PRIMARY KEY,
        schema_version INT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async load(): Promise<LedgerPersistentState | null> {
    const result = await this.pool.query(
      'SELECT payload FROM ledger_state_snapshots WHERE state_key = $1',
      [this.stateKey]
    );
    if (result.rowCount === 0) {
      return null;
    }
    return result.rows[0].payload as LedgerPersistentState;
  }

  async save(state: LedgerPersistentState): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO ledger_state_snapshots (state_key, schema_version, payload, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (state_key)
      DO UPDATE SET
        schema_version = EXCLUDED.schema_version,
        payload = EXCLUDED.payload,
        updated_at = NOW()
      `,
      [this.stateKey, state.schemaVersion, JSON.stringify(state)]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
