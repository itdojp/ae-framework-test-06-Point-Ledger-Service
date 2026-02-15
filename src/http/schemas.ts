import { z } from 'zod';

export const createAccountSchema = z.object({
  tenantId: z.string().min(1),
  ownerType: z.enum(['USER', 'SYSTEM']),
  ownerId: z.string().min(1),
  unit: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  allowNegative: z.boolean().optional()
});

const entrySchema = z.object({
  accountId: z.string().min(1),
  amount: z.number().int(),
  expiresAt: z.string().datetime().nullable().optional()
});

export const postTransactionSchema = z.object({
  tenantId: z.string().min(1),
  txType: z.enum(['EARN', 'SPEND', 'ADJUST']),
  idempotencyKey: z.string().min(1).optional(),
  externalRef: z.string().optional(),
  description: z.string().optional(),
  createdByUserId: z.string().optional(),
  entries: z.array(entrySchema).optional(),
  spend: z
    .object({
      accountId: z.string().min(1),
      amount: z.number().int().positive()
    })
    .optional(),
  counterAccountId: z.string().optional()
});

export const reverseSchema = z.object({
  tenantId: z.string().min(1),
  actorUserId: z.string().optional()
});

export const expireSchema = z.object({
  tenantId: z.string().min(1),
  now: z.string().datetime().optional()
});
