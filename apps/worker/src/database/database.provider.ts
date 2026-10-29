import { Provider } from '@nestjs/common';
import {
  getDatabaseConnection,
  type Database,
  type DatabaseConnection,
} from '@eventforge/database';

export const DATABASE_CONNECTION = 'DATABASE_CONNECTION';
export const DATABASE = 'DATABASE';

export const databaseProviders: Provider[] = [
  {
    provide: DATABASE_CONNECTION,
    useFactory: (): DatabaseConnection => {
      return getDatabaseConnection();
    },
  },
  {
    provide: DATABASE,
    useFactory: (conn: DatabaseConnection): Database => {
      return conn.db;
    },
    inject: [DATABASE_CONNECTION],
  },
];
