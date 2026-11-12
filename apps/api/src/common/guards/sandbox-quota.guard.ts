import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SANDBOX_PROJECT_SLUG } from '@eventforge/common';
import { validateEnv } from '@eventforge/config';
import { SandboxRateLimiter } from '../../modules/sandbox/sandbox-rate-limiter.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Keeps a sandbox key from being used as a free webhook sender. Runs after ApiKeyGuard and only
 * affects requests authenticated as the sandbox project:
 *
 * - subscriptions cannot be created, changed or deleted (they are managed by the sandbox and
 *   point at the built-in receiver only), and
 * - every other write (events, replays) counts against a per-IP hourly quota.
 *
 * Reads are not limited here; the general RateLimitGuard already covers them.
 */
@Injectable()
export class SandboxQuotaGuard implements CanActivate {
  private readonly config = validateEnv();

  constructor(private readonly limiter: SandboxRateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (request.project?.slug !== SANDBOX_PROJECT_SLUG || READ_METHODS.has(request.method)) {
      return true;
    }

    if (request.path.startsWith('/v1/subscriptions')) {
      throw new ForbiddenException(
        'Subscriptions are managed by the sandbox and cannot be changed with a sandbox key',
      );
    }

    const verdict = await this.limiter.consume(
      `writes:${request.ip ?? 'unknown'}`,
      this.config.SANDBOX_WRITES_PER_HOUR,
    );
    if (!verdict.allowed) {
      http.getResponse<Response>().setHeader('Retry-After', String(verdict.retryAfterSeconds));
      throw new HttpException(
        `Sandbox write limit reached. Retry after ${verdict.retryAfterSeconds} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
