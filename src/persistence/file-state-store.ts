import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { LedgerPersistentState } from '../domain/types.js';
import { StateStore } from './state-store.js';

async function writeFileAtomic(filePath: string, value: string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tempPath, value, 'utf-8');
  await rename(tempPath, filePath);
}

export class FileStateStore implements StateStore {
  readonly kind = 'file' as const;
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<LedgerPersistentState | null> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as LedgerPersistentState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async save(state: LedgerPersistentState): Promise<void> {
    await writeFileAtomic(this.filePath, JSON.stringify(state, null, 2));
  }
}
