import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    WORKER_PORT: z.coerce.number().int().nonnegative().default(3001),
    WORKER_HOST: z.string().default('127.0.0.1'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    DATABASE_URL: z
      .string()
      .url('DATABASE_URL must be a valid PostgreSQL connection URL')
      .default('postgresql://postgres:postgres@localhost:5432/eventforge'),
    DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(20),

    REDIS_URL: z
      .string()
      .url('REDIS_URL must be a valid Redis connection URL')
      .default('redis://localhost:6379'),

    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
    OUTBOX_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    WEBHOOK_MAX_RETRIES: z.coerce.number().int().positive().default(5),
    DELIVERY_LEASE_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    STALE_RECOVERY_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
    ALLOW_LOCAL_WEBHOOKS: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((val) => Boolean(val === true || val === 'true' || val === '1')),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (data.ALLOW_LOCAL_WEBHOOKS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ALLOW_LOCAL_WEBHOOKS must never be enabled in production environment',
          path: ['ALLOW_LOCAL_WEBHOOKS'],
        });
      }

      if (
        data.DATABASE_URL.includes('://postgres:postgres@') ||
        data.DATABASE_URL.includes('://postgres:@')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'DATABASE_URL must not use default or empty development credentials in production environment',
          path: ['DATABASE_URL'],
        });
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;
