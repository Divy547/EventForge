import { envSchema, type EnvConfig } from './schema.js';

/**
 * Validates process.env against the strict environment schema.
 * Throws a formatted, human-readable error immediately on invalid configuration.
 */
export function validateEnv(rawEnv: NodeJS.ProcessEnv = process.env): EnvConfig {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const formattedErrors = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');

    throw new Error(
      `[EventForge Configuration Error] Invalid environment configuration:\n${formattedErrors}`,
    );
  }

  return result.data;
}
