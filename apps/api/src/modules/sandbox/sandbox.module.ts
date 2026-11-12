import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { SandboxController } from './sandbox.controller.js';
import { SandboxReceiverController } from './sandbox-receiver.controller.js';
import { SandboxRateLimiter } from './sandbox-rate-limiter.js';
import { SandboxService } from './sandbox.service.js';

@Module({
  imports: [EventsModule],
  controllers: [SandboxController, SandboxReceiverController],
  providers: [SandboxService, SandboxRateLimiter],
  exports: [SandboxRateLimiter],
})
export class SandboxModule {}
