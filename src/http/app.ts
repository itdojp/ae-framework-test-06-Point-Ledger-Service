import Fastify from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from '../domain/errors.js';
import { LedgerService } from '../services/ledger-service.js';
import { createAccountSchema, expireSchema, postTransactionSchema, reverseSchema } from './schemas.js';

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

  app.post('/api/v1/transactions/:txId/reverse', async (request) => {
    const params = request.params as { txId: string };
    const body = reverseSchema.parse(request.body);
    return service.reverseTransaction(body.tenantId, params.txId, body.actorUserId ?? null);
  });

  app.post('/api/v1/batch/expire', async (request) => {
    const body = expireSchema.parse(request.body);
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
