import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { databaseProviders } from './database.provider.js';
import { WorkerDatabaseService } from './worker-database.service.js';
import { closeDatabasePool } from '@eventforge/database';

@Global()
@Module({
  providers: [...databaseProviders, WorkerDatabaseService],
  exports: [...databaseProviders, WorkerDatabaseService],
})
export class DatabaseModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await closeDatabasePool();
  }
}
