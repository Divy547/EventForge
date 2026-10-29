import { Global, Module } from '@nestjs/common';
import { WorkerConfigService } from './worker-config.service.js';

@Global()
@Module({
  providers: [WorkerConfigService],
  exports: [WorkerConfigService],
})
export class WorkerConfigModule {}
