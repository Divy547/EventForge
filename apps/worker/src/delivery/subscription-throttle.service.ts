import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider.js';

/**
 * Atomically reserves the next delivery slot for a subscription (GCRA-style scheduling).
 *
 * KEYS[1] = per-subscription "theoretical arrival time" key
 * ARGV[1] = interval between slots in ms (1000 / rateLimitPerSecond)
 * ARGV[2] = burst window in ms: slots up to this far in the future may run immediately
 *
 * Every caller gets a slot, so throttled jobs are scheduled at distinct future times
 * instead of waking up together and re-contending. Redis TIME is used so all workers
 * share one clock. Returns the delay in ms before the caller's slot (0 = run now).
 */
const RESERVE_SLOT_SCRIPT = `
local interval = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
if tat < now then tat = now end
local newTat = tat + interval
local runAt = newTat - burst
if runAt < now then runAt = now end
redis.call('SET', KEYS[1], string.format('%d', newTat), 'PX', (newTat - now) + burst + 1000)
return runAt - now
`;

@Injectable()
export class SubscriptionThrottleService {
  private readonly logger = new Logger(SubscriptionThrottleService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Reserves a delivery slot enforcing at most `ratePerSecond` sustained deliveries per
   * second for the subscription (with a burst of up to `ratePerSecond`).
   * Returns how long to wait before dispatching; 0 means dispatch immediately.
   * Fails open (returns 0) if Redis is unavailable so throttling never blocks delivery.
   */
  async reserveSlot(subscriptionId: string, ratePerSecond: number): Promise<number> {
    try {
      const intervalMs = 1000 / ratePerSecond;
      const delay = await this.redis.eval(
        RESERVE_SLOT_SCRIPT,
        1,
        `eventforge:throttle:sub:${subscriptionId}`,
        String(intervalMs),
        '1000',
      );
      const delayMs = Number(delay);
      return Number.isFinite(delayMs) && delayMs > 0 ? Math.ceil(delayMs) : 0;
    } catch (error) {
      this.logger.warn(
        `Subscription throttle unavailable, failing open: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
