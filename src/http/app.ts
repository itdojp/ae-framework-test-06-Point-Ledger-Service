import Fastify from 'fastify';
import { ZodError } from 'zod';
import { DomainError, ForbiddenError } from '../domain/errors.js';
import { LedgerService } from '../services/ledger-service.js';
import { createAccountSchema, expireSchema, postTransactionSchema, reverseSchema } from './schemas.js';

type Role = 'ADMIN' | 'MEMBER' | 'VIEWER';

function readRole(headers: Record<string, unknown>): { role: Role; userId: string | null } {
  const roleRaw = String(headers['x-role'] ?? 'ADMIN').toUpperCase();
  const userId = headers['x-user-id'] ? String(headers['x-user-id']) : null;
  if (roleRaw !== 'ADMIN' && roleRaw !== 'MEMBER' && roleRaw !== 'VIEWER') {
    throw new DomainError('INVALID_ROLE', 'x-role must be ADMIN, MEMBER, or VIEWER', 400);
  }
  if ((roleRaw === 'MEMBER' || roleRaw === 'VIEWER') && !userId) {
    throw new DomainError('AUTH_USER_REQUIRED', 'x-user-id is required for MEMBER/VIEWER', 400);
  }
  return { role: roleRaw, userId };
}

function parseBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function buildApp(service = new LedgerService()) {
  const app = Fastify({ logger: false });

  async function ensureOwnAccount(
    tenantId: string,
    accountId: string,
    role: Role,
    userId: string | null
  ): Promise<void> {
    if (role === 'ADMIN') {
      return;
    }
    const account = await service.getAccount(tenantId, accountId);
    if (account.ownerType !== 'USER' || account.ownerId !== userId) {
      throw new ForbiddenError('Cannot access another user account');
    }
  }

  app.post('/api/v1/accounts', async (request) => {
    const body = createAccountSchema.parse(request.body);
    const account = await service.createAccount(body);
    return service.getAccount(account.tenantId, account.accountId);
  });

  app.get('/api/v1/accounts', async (request) => {
    const query = request.query as { tenantId?: string; ownerType?: string; ownerId?: string };
    const auth = readRole(request.headers);
    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }
    if (auth.role !== 'ADMIN') {
      return service.listAccounts(query.tenantId, { ownerType: 'USER', ownerId: auth.userId ?? undefined });
    }
    return service.listAccounts(query.tenantId, { ownerType: query.ownerType, ownerId: query.ownerId });
  });

  app.get('/api/v1/accounts/:accountId', async (request) => {
    const params = request.params as { accountId: string };
    const query = request.query as { tenantId?: string };
    const auth = readRole(request.headers);
    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }
    await ensureOwnAccount(query.tenantId, params.accountId, auth.role, auth.userId);
    return service.getAccount(query.tenantId, params.accountId);
  });

  app.get('/api/v1/accounts/:accountId/lots', async (request) => {
    const params = request.params as { accountId: string };
    const query = request.query as { tenantId?: string };
    const auth = readRole(request.headers);
    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }
    await ensureOwnAccount(query.tenantId, params.accountId, auth.role, auth.userId);
    return service.listLots(query.tenantId, params.accountId);
  });

  app.post('/api/v1/transactions', async (request) => {
    const body = postTransactionSchema.parse(request.body);
    const auth = readRole(request.headers);

    if (auth.role === 'VIEWER') {
      throw new ForbiddenError('VIEWER cannot post transactions');
    }

    if (auth.role === 'MEMBER') {
      if (body.txType !== 'SPEND') {
        throw new ForbiddenError('MEMBER can post SPEND only');
      }
      if (!body.spend) {
        throw new DomainError('INVALID_SPEND_INPUT', 'spend is required for SPEND', 400);
      }
      const spendAccount = await service.getAccount(body.tenantId, body.spend.accountId);
      if (spendAccount.ownerType !== 'USER' || spendAccount.ownerId !== auth.userId) {
        throw new ForbiddenError('Cannot spend points from another account');
      }
      body.createdByUserId = body.createdByUserId ?? auth.userId;
    }

    return service.postTransaction(body);
  });

  app.get('/api/v1/transactions/:txId', async (request) => {
    const params = request.params as { txId: string };
    const query = request.query as { tenantId?: string };
    const auth = readRole(request.headers);
    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }
    const detail = await service.getTransactionDetail(query.tenantId, params.txId);
    if (auth.role !== 'ADMIN') {
      const accountIds = [...new Set(detail.entries.map((entry) => entry.accountId))];
      let visible = false;
      for (const accountId of accountIds) {
        const account = await service.getAccount(query.tenantId, accountId);
        if (account.ownerType === 'USER' && account.ownerId === auth.userId) {
          visible = true;
          break;
        }
      }
      if (!visible) {
        throw new ForbiddenError('Cannot access another user transaction');
      }
    }
    return detail;
  });

  app.get('/api/v1/transactions', async (request) => {
    const query = request.query as {
      tenantId?: string;
      accountId?: string;
      txType?: 'EARN' | 'SPEND' | 'ADJUST' | 'EXPIRE' | 'REVERSAL';
      externalRef?: string;
      postedFrom?: string;
      postedTo?: string;
      page?: string;
      pageSize?: string;
      order?: string;
    };
    const auth = readRole(request.headers);

    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }

    if (auth.role !== 'ADMIN' && query.accountId) {
      await ensureOwnAccount(query.tenantId, query.accountId, auth.role, auth.userId);
    }

    const page = parseBoundedInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = parseBoundedInt(query.pageSize, 50, 1, 200);
    const order = query.order === 'asc' ? 'asc' : 'desc';

    const txs = await service.queryTransactions({
      tenantId: query.tenantId,
      accountId: query.accountId,
      txType: query.txType,
      externalRef: query.externalRef,
      postedFrom: query.postedFrom,
      postedTo: query.postedTo,
      order
    });

    if (auth.role === 'ADMIN') {
      const offset = (page - 1) * pageSize;
      return txs.slice(offset, offset + pageSize);
    }

    const ownAccounts = await service.listAccounts(query.tenantId, {
      ownerType: 'USER',
      ownerId: auth.userId ?? undefined
    });
    const ownAccountIds = new Set(ownAccounts.map((account) => account.accountId));
    const filtered = [];
    for (const tx of txs) {
      const detail = await service.getTransactionDetail(query.tenantId, tx.txId);
      if (detail.entries.some((entry) => ownAccountIds.has(entry.accountId))) {
        filtered.push(tx);
      }
    }
    const offset = (page - 1) * pageSize;
    return filtered.slice(offset, offset + pageSize);
  });

  app.get('/api/v1/audit-logs', async (request) => {
    const query = request.query as {
      tenantId?: string;
      action?: string;
      targetType?: string;
      targetId?: string;
      actorUserId?: string;
      from?: string;
      to?: string;
      page?: string;
      pageSize?: string;
      order?: string;
    };
    const auth = readRole(request.headers);
    if (auth.role !== 'ADMIN') {
      throw new ForbiddenError('Only ADMIN can access audit logs');
    }
    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }
    const page = parseBoundedInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = parseBoundedInt(query.pageSize, 50, 1, 200);
    const order = query.order === 'asc' ? 'asc' : 'desc';

    const base = {
      tenantId: query.tenantId,
      action: query.action,
      targetType: query.targetType,
      targetId: query.targetId,
      actorUserId: query.actorUserId,
      from: query.from,
      to: query.to
    } as const;

    const total = await service.countAuditLogs(base);
    const items = await service.listAuditLogs({
      ...base,
      order,
      offset: (page - 1) * pageSize,
      limit: pageSize
    });

    return {
      page,
      pageSize,
      total,
      items
    };
  });

  app.get('/api/v1/metrics', async (request) => {
    const query = request.query as { tenantId?: string };
    const auth = readRole(request.headers);
    if (auth.role !== 'ADMIN') {
      throw new ForbiddenError('Only ADMIN can access metrics');
    }
    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }
    return service.getTenantMetrics(query.tenantId);
  });

  app.post('/api/v1/transactions/:txId/reverse', async (request) => {
    const params = request.params as { txId: string };
    const body = reverseSchema.parse(request.body);
    const auth = readRole(request.headers);
    if (auth.role !== 'ADMIN') {
      throw new ForbiddenError('Only ADMIN can reverse transactions');
    }
    return service.reverseTransaction(body.tenantId, params.txId, body.actorUserId ?? null);
  });

  app.post('/api/v1/batch/expire', async (request) => {
    const body = expireSchema.parse(request.body);
    const auth = readRole(request.headers);
    if (auth.role !== 'ADMIN') {
      throw new ForbiddenError('Only ADMIN can run expiration batch');
    }
    return service.expireLots(body.tenantId, body.now ? new Date(body.now) : new Date());
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: error.message });
    }
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({ code: error.code, message: error.message });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message });
  });

  return app;
}
