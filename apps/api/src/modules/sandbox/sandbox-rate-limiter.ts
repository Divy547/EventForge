import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider.js';

export interface SandboxLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counters in Redis for sandbox actions (starting a session, writing with a sandbox
 * key). Separate from the general RateLimitGuard because these limits are hourly and much
 * tighter. Like that guard it fails open if Redis is unreachable, so a Redis outage cannot take
 * the API down with it.
 */
@Injectable()
export class SandboxRateLimiter {
  private readonly logger = new Logger(SandboxRateLimiter.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(bucket: string, limit: number, windowSeconds = 3600): Promise<SandboxLimitResult> {
    const windowMs = windowSeconds * 1000;
    try {
      const redisKey = `eventforge:sandbox:limit:${bucket}`;
      const results = await this.redis
        .multi()
        .incr(redisKey)
        .pexpire(redisKey, windowMs, 'NX')
        .pttl(redisKey)
        .exec();
      const count = Number(results?.[0]?.[1]);
      const ttlMs = Number(results?.[2]?.[1]);
      if (!Number.isFinite(count)) throw new Error('Unexpected Redis reply');
      if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000)),
      };
    } catch (error) {
      this.logger.warn(
        `Sandbox limiter unavailable, failing open: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }
}
