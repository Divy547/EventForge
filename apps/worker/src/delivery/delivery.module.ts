import { Module } from '@nestjs/common';
import { HttpDispatcherService } from './http-dispatcher.service.js';
import { DeliveryProcessor } from './delivery.processor.js';

@Module({
  providers: [HttpDispatcherService, DeliveryProcessor],
  exports: [HttpDispatcherService, DeliveryProcessor],
})
export class DeliveryModule {}
