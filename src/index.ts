import { buildApp } from './http/app.js';
import { LedgerService } from './services/ledger-service.js';
import { FileStateStore } from './persistence/file-state-store.js';
import { PostgresStateStore } from './persistence/postgres-state-store.js';
import { StateStore } from './persistence/state-store.js';
import { InMemoryReadRateLimitBackend, ReadRateLimitBackend } from './http/read-rate-limit-backend.js';
import { PostgresReadRateLimitBackend } from './http/postgres-read-rate-limit-backend.js';

const port = Number(process.env['PORT'] ?? 3000);
const host = process.env['HOST'] ?? '0.0.0.0';
const stateFilePath = process.env['LEDGER_STATE_FILE'];
const stateBackend = process.env['LEDGER_STATE_BACKEND'] ?? (stateFilePath ? 'file' : 'none');
const readRateLimitWindowMs = Number(process.env['LEDGER_READ_RATE_LIMIT_WINDOW_MS'] ?? 0);
const readRateLimitMaxRequests = Number(process.env['LEDGER_READ_RATE_LIMIT_MAX_REQUESTS'] ?? 0);
const readRateLimitMaxRequestsAdmin = Number(process.env['LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_ADMIN'] ?? 0);
const readRateLimitMaxRequestsMember = Number(process.env['LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_MEMBER'] ?? 0);
const readRateLimitMaxRequestsViewer = Number(process.env['LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_VIEWER'] ?? 0);
const readRateLimitMaxRequestsTransactions = Number(process.env['LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_TRANSACTIONS'] ?? 0);
const readRateLimitMaxRequestsAuditLogs = Number(process.env['LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_AUDIT_LOGS'] ?? 0);
const readRateLimitMaxRequestsMetrics = Number(process.env['LEDGER_READ_RATE_LIMIT_MAX_REQUESTS_METRICS'] ?? 0);
const readRateLimitActorKeyStrategyRaw = process.env['LEDGER_READ_RATE_LIMIT_ACTOR_KEY_STRATEGY'] ?? '';
const readRateLimitBackendRaw = process.env['LEDGER_READ_RATE_LIMIT_BACKEND'] ?? 'memory';
const readRateLimitCleanupIntervalMs = Number(process.env['LEDGER_READ_RATE_LIMIT_CLEANUP_INTERVAL_MS'] ?? 0);
const readRateLimitCleanupRetentionMs = Number(process.env['LEDGER_READ_RATE_LIMIT_CLEANUP_RETENTION_MS'] ?? 0);
const readRateLimitCleanupBatchSize = Number(process.env['LEDGER_READ_RATE_LIMIT_CLEANUP_BATCH_SIZE'] ?? 0);

function isPositiveInt(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function parseActorKeyStrategy(raw: string): 'ip' | 'role_ip' | 'user' | 'role_user' | undefined {
  if (raw === 'ip' || raw === 'role_ip' || raw === 'user' || raw === 'role_user') {
    return raw;
  }
  return undefined;
}
const readRateLimitActorKeyStrategy = parseActorKeyStrategy(readRateLimitActorKeyStrategyRaw);

function parseReadRateLimitBackend(raw: string): 'memory' | 'postgres' {
  if (raw === 'postgres') {
    return 'postgres';
  }
  return 'memory';
}

const readRateLimitBackendType = parseReadRateLimitBackend(readRateLimitBackendRaw);

async function createStateStore(): Promise<StateStore | null> {
  if (stateBackend === 'none') {
    return null;
  }

  if (stateBackend === 'postgres') {
    const connectionString = process.env['LEDGER_DATABASE_URL'];
    const stateKey = process.env['LEDGER_STATE_KEY'] ?? 'point-ledger-service';
    if (!connectionString) {
      throw new Error('LEDGER_DATABASE_URL is required when LEDGER_STATE_BACKEND=postgres');
    }
    const store = new PostgresStateStore({ connectionString, stateKey });
    await store.init();
    return store;
  }

  if (!stateFilePath) {
    throw new Error('LEDGER_STATE_FILE is required when LEDGER_STATE_BACKEND=file');
  }
  return new FileStateStore(stateFilePath);
}

const stateStore = await createStateStore();
const service = new LedgerService({ stateFilePath, stateStore: stateStore ?? undefined });
await service.loadState();

const isReadRateLimitEnabled = isPositiveInt(readRateLimitWindowMs) && isPositiveInt(readRateLimitMaxRequests);
let readRateLimitBackend: ReadRateLimitBackend | undefined;
if (isReadRateLimitEnabled) {
  if (readRateLimitBackendType === 'postgres') {
    const connectionString = process.env['LEDGER_DATABASE_URL'];
    if (!connectionString) {
      throw new Error('LEDGER_DATABASE_URL is required when LEDGER_READ_RATE_LIMIT_BACKEND=postgres');
    }
    const backend = new PostgresReadRateLimitBackend({
      connectionString,
      cleanupIntervalMs: isPositiveInt(readRateLimitCleanupIntervalMs) ? readRateLimitCleanupIntervalMs : undefined,
      cleanupRetentionMs: isPositiveInt(readRateLimitCleanupRetentionMs) ? readRateLimitCleanupRetentionMs : undefined,
      cleanupBatchSize: isPositiveInt(readRateLimitCleanupBatchSize) ? readRateLimitCleanupBatchSize : undefined
    });
    await backend.init();
    readRateLimitBackend = backend;
  } else {
    readRateLimitBackend = new InMemoryReadRateLimitBackend();
  }
}

const app = buildApp(service, {
  readRateLimit: isReadRateLimitEnabled
    ? {
        windowMs: readRateLimitWindowMs,
        maxRequests: readRateLimitMaxRequests,
        maxRequestsByRole: {
          ...(isPositiveInt(readRateLimitMaxRequestsAdmin) ? { ADMIN: readRateLimitMaxRequestsAdmin } : {}),
          ...(isPositiveInt(readRateLimitMaxRequestsMember) ? { MEMBER: readRateLimitMaxRequestsMember } : {}),
          ...(isPositiveInt(readRateLimitMaxRequestsViewer) ? { VIEWER: readRateLimitMaxRequestsViewer } : {})
        },
        maxRequestsByScope: {
          ...(isPositiveInt(readRateLimitMaxRequestsTransactions) ? { transactions: readRateLimitMaxRequestsTransactions } : {}),
          ...(isPositiveInt(readRateLimitMaxRequestsAuditLogs) ? { 'audit-logs': readRateLimitMaxRequestsAuditLogs } : {}),
          ...(isPositiveInt(readRateLimitMaxRequestsMetrics) ? { metrics: readRateLimitMaxRequestsMetrics } : {})
        },
        ...(readRateLimitActorKeyStrategy ? { actorKeyStrategy: readRateLimitActorKeyStrategy } : {}),
        ...(readRateLimitBackend ? { backend: readRateLimitBackend } : {})
      }
    : undefined
});
app.addHook('onClose', async () => {
  if (stateStore?.close) {
    await stateStore.close();
  }
  if (readRateLimitBackend?.close) {
    await readRateLimitBackend.close();
  }
});

app.listen({ port, host }).catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
