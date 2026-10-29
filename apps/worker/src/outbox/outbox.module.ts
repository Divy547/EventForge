import { Module } from '@nestjs/common';
import { OutboxPollerService } from './outbox-poller.service.js';
import { StaleDeliveryRecoveryService } from './stale-delivery-recovery.service.js';

@Module({
  providers: [OutboxPollerService, StaleDeliveryRecoveryService],
  exports: [OutboxPollerService, StaleDeliveryRecoveryService],
})
export class OutboxModule {}
