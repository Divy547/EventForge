import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { validateEnv } from '@eventforge/config';

/**
 * Protects the Prometheus scrape endpoint.
 *
 * - `METRICS_TOKEN` set: requires `Authorization: Bearer <token>` (constant-time compare).
 * - unset, outside production: open, for local development.
 * - unset, in production: the endpoint is disabled (404) rather than exposed.
 */
@Injectable()
export class MetricsAuthGuard implements CanActivate {
  private readonly config = validateEnv();

  canActivate(context: ExecutionContext): boolean {
    const token = this.config.METRICS_TOKEN;

    if (!token) {
      if (this.config.NODE_ENV === 'production') {
        throw new NotFoundException();
      }
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('Authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const expected = Buffer.from(token);
    const actual = Buffer.from(provided);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Missing or invalid metrics token');
    }
    return true;
  }
}
