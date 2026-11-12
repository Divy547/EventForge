import { Module } from '@nestjs/common';
import { HttpDispatcherService } from './http-dispatcher.service.js';
import { SubscriptionThrottleService } from './subscription-throttle.service.js';
import { DeliveryProcessor } from './delivery.processor.js';

@Module({
  providers: [HttpDispatcherService, SubscriptionThrottleService, DeliveryProcessor],
  exports: [HttpDispatcherService, SubscriptionThrottleService, DeliveryProcessor],
})
export class DeliveryModule {}
