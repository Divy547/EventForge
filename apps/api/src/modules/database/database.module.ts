import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { databaseProviders } from './database.provider.js';
import { closeDatabasePool } from '@eventforge/database';

@Global()
@Module({
  providers: [...databaseProviders],
  exports: [...databaseProviders],
})
export class DatabaseModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await closeDatabasePool();
  }
}
