import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { hashApiKey } from '@eventforge/common';
import { validateEnv } from '@eventforge/config';
import { REDIS_CLIENT } from '../../modules/redis/redis.provider.js';

/**
 * Fixed-window rate limiter backed by Redis (INCR + PEXPIRE), so limits are shared across
 * API replicas. Two buckets are checked per request:
 *
 * - `ip:<address>`: always applied, so repeatedly guessing invalid API keys is throttled.
 * - `key:<sha256 of key>`: applied when a key header is present, so one tenant cannot
 *   monopolise the API. The raw key is never written to Redis.
 *
 * If Redis is unreachable the limiter fails open (and logs): availability of ingestion
 * is preferred over strict throttling.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly config = validateEnv();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.RATE_LIMIT_ENABLED) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const windowMs = this.config.RATE_LIMIT_WINDOW_SECONDS * 1000;

    const buckets: Array<{ id: string; limit: number }> = [
      { id: `ip:${request.ip ?? 'unknown'}`, limit: this.config.RATE_LIMIT_IP_MAX },
    ];
    const rawKey = this.extractApiKey(request);
    if (rawKey) {
      buckets.push({ id: `key:${hashApiKey(rawKey)}`, limit: this.config.RATE_LIMIT_KEY_MAX });
    }

    for (const bucket of buckets) {
      let count: number;
      let ttlMs: number;
      try {
        const redisKey = `eventforge:ratelimit:${bucket.id}`;
        const results = await this.redis
          .multi()
          .incr(redisKey)
          .pexpire(redisKey, windowMs, 'NX')
          .pttl(redisKey)
          .exec();
        count = Number(results?.[0]?.[1]);
        ttlMs = Number(results?.[2]?.[1]);
        if (!Number.isFinite(count)) {
          throw new Error('Unexpected Redis reply');
        }
      } catch (error) {
        this.logger.warn(
          `Rate limiter unavailable, failing open: ${error instanceof Error ? error.message : String(error)}`,
        );
        return true;
      }

      if (count > bucket.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000));
        response.setHeader('Retry-After', String(retryAfterSeconds));
        throw new HttpException(
          `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }

  private extractApiKey(request: Request): string | null {
    const header = request.header('X-API-Key');
    if (header) return header.trim();
    const auth = request.header('Authorization');
    if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
    return null;
  }
}
