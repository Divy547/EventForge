import { Module } from '@nestjs/common';
import { WorkerConfigModule } from './config/worker-config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './redis/redis.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { DeliveryModule } from './delivery/delivery.module.js';
import { WorkerHttpServerService } from './server/worker-http-server.service.js';

@Module({
  imports: [WorkerConfigModule, DatabaseModule, RedisModule, OutboxModule, DeliveryModule],
  providers: [WorkerHttpServerService],
})
export class WorkerModule {}
