import { describe, it, expect } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RateLimitGuard } from '../src/common/guards/rate-limit.guard.js';

function contextFor(headers: Record<string, string> = {}): ExecutionContext {
  const request = { ip: '203.0.113.9', header: (n: string) => headers[n] };
  const response = { setHeader: () => undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  it('fails open when Redis is unavailable', async () => {
    const broken = {
      multi: () => {
        throw new Error('ECONNREFUSED');
      },
    } as unknown as Redis;
    const guard = new RateLimitGuard(broken);
    await expect(guard.canActivate(contextFor({ 'X-API-Key': 'ef_live_x' }))).resolves.toBe(true);
  });
});
