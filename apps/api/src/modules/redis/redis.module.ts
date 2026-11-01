import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { DELIVERY_QUEUE, REDIS_CLIENT, redisProviders } from './redis.provider.js';

@Global()
@Module({
  providers: [...redisProviders],
  exports: [...redisProviders],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    @Inject(DELIVERY_QUEUE) private readonly deliveryQueue: Queue,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.deliveryQueue.close();
    } catch {
      // Ignore errors during queue shutdown
    }
    try {
      this.redisClient.disconnect();
    } catch {
      // Ignore errors during client disconnect
    }
  }
}
