import { Module } from '@nestjs/common';
import { OutboxPollerService } from './outbox-poller.service.js';
import { RetentionService } from './retention.service.js';
import { StaleDeliveryRecoveryService } from './stale-delivery-recovery.service.js';

@Module({
  providers: [OutboxPollerService, StaleDeliveryRecoveryService, RetentionService],
  exports: [OutboxPollerService, StaleDeliveryRecoveryService, RetentionService],
})
export class OutboxModule {}
