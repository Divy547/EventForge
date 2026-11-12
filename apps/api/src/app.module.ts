import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { DatabaseModule } from './modules/database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module.js';
import { RedisModule } from './modules/redis/redis.module.js';
import { DeliveriesModule } from './modules/deliveries/deliveries.module.js';
import { StatsModule } from './modules/stats/stats.module.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { ApiKeyGuard } from './common/guards/api-key.guard.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    HealthModule,
    EventsModule,
    SubscriptionsModule,
    DeliveriesModule,
    StatsModule,
  ],
  providers: [
    // Order matters: rate limiting runs before authentication so invalid-key guessing is throttled.
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
