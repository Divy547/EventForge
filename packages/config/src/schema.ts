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

    // Data retention (worker). RETENTION_DAYS=0 disables the retention job.
    RETENTION_DAYS: z.coerce.number().int().nonnegative().default(30),
    RETENTION_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
    RETENTION_BATCH_SIZE: z.coerce.number().int().positive().default(1000),

    // API protection
    RATE_LIMIT_ENABLED: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((val) => !(val === false || val === 'false' || val === '0')),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_KEY_MAX: z.coerce.number().int().positive().default(1200),
    RATE_LIMIT_IP_MAX: z.coerce.number().int().positive().default(2400),
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((val) =>
        val
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    // Bearer token required to scrape API /metrics. Unset: open outside production, disabled in production.
    METRICS_TOKEN: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.string().min(16, 'METRICS_TOKEN must be at least 16 characters').optional(),
    ),
    TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),

    ALLOW_LOCAL_WEBHOOKS: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((val) => Boolean(val === true || val === 'true' || val === '1')),

    // Sandbox mode (public demo). The receiver base is the address the WORKER uses to reach the
    // API's built-in demo receiver, e.g. http://api:3000/sandbox/receiver. Only that address is
    // exempt from SSRF blocking. The API reads SANDBOX_ENABLED too; the worker only needs the URL.
    SANDBOX_ENABLED: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((val) => Boolean(val === true || val === 'true' || val === '1')),
    SANDBOX_RECEIVER_URL: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.string().url('SANDBOX_RECEIVER_URL must be a valid http(s) URL').optional(),
    ),
    // Per client IP and hour: visitor sessions that may be started, and writes (events, replays,
    // subscriptions) a sandbox key may make.
    SANDBOX_SESSIONS_PER_HOUR: z.coerce.number().int().positive().default(10),
    SANDBOX_WRITES_PER_HOUR: z.coerce.number().int().positive().default(60),
  })
  .superRefine((data, ctx) => {
    if (data.SANDBOX_ENABLED && !data.SANDBOX_RECEIVER_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SANDBOX_RECEIVER_URL is required when SANDBOX_ENABLED is true',
        path: ['SANDBOX_RECEIVER_URL'],
      });
    }
    if (data.SANDBOX_RECEIVER_URL && !/^https?:\/\//i.test(data.SANDBOX_RECEIVER_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SANDBOX_RECEIVER_URL must use http or https',
        path: ['SANDBOX_RECEIVER_URL'],
      });
    }
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
