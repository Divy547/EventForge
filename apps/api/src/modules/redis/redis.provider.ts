import { Provider } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { WEBHOOK_DELIVERY_QUEUE } from '@eventforge/common';
import { validateEnv } from '@eventforge/config';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const DELIVERY_QUEUE = 'DELIVERY_QUEUE';

export const redisProviders: Provider[] = [
  {
    provide: REDIS_CLIENT,
    useFactory: (): Redis => {
      const config = validateEnv();
      return new Redis(config.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: false,
      });
    },
  },
  {
    provide: DELIVERY_QUEUE,
    useFactory: (redisClient: Redis): Queue => {
      return new Queue(WEBHOOK_DELIVERY_QUEUE, {
        connection: redisClient,
        defaultJobOptions: {
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      });
    },
    inject: [REDIS_CLIENT],
  },
];
