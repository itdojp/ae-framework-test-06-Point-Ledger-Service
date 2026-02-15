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

export function buildApp(service = new LedgerService()) {
  const app = Fastify({ logger: false });

  app.post('/api/v1/accounts', async (request) => {
    const body = createAccountSchema.parse(request.body);
    const account = await service.createAccount(body);
    return service.getAccount(account.tenantId, account.accountId);
  });

  app.get('/api/v1/accounts', async (request) => {
    const query = request.query as { tenantId?: string; ownerType?: string; ownerId?: string };
    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }
    return service.listAccounts(query.tenantId, { ownerType: query.ownerType, ownerId: query.ownerId });
  });

  app.get('/api/v1/accounts/:accountId', async (request) => {
    const params = request.params as { accountId: string };
    const query = request.query as { tenantId?: string };
    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }
    return service.getAccount(query.tenantId, params.accountId);
  });

  app.get('/api/v1/accounts/:accountId/lots', async (request) => {
    const params = request.params as { accountId: string };
    const query = request.query as { tenantId?: string };
    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }
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
    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }
    return service.getTransactionDetail(query.tenantId, params.txId);
  });

  app.get('/api/v1/transactions', async (request) => {
    const query = request.query as {
      tenantId?: string;
      accountId?: string;
      txType?: 'EARN' | 'SPEND' | 'ADJUST' | 'EXPIRE' | 'REVERSAL';
      externalRef?: string;
      postedFrom?: string;
      postedTo?: string;
    };

    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }

    return service.queryTransactions({
      tenantId: query.tenantId,
      accountId: query.accountId,
      txType: query.txType,
      externalRef: query.externalRef,
      postedFrom: query.postedFrom,
      postedTo: query.postedTo
    });
  });

  app.get('/api/v1/audit-logs', async (request) => {
    const query = request.query as {
      tenantId?: string;
      action?: string;
      targetType?: string;
      actorUserId?: string;
      from?: string;
      to?: string;
    };
    const auth = readRole(request.headers);
    if (auth.role !== 'ADMIN') {
      throw new ForbiddenError('Only ADMIN can access audit logs');
    }
    if (!query.tenantId) {
      throw new DomainError('INVALID_QUERY', 'tenantId is required', 400);
    }
    return service.listAuditLogs({
      tenantId: query.tenantId,
      action: query.action,
      targetType: query.targetType,
      actorUserId: query.actorUserId,
      from: query.from,
      to: query.to
    });
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
