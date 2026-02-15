import { LedgerPersistentState } from '../domain/types.js';

export interface StateStore {
  kind: 'file' | 'postgres';
  load(): Promise<LedgerPersistentState | null>;
  save(state: LedgerPersistentState): Promise<void>;
  close?(): Promise<void>;
}
