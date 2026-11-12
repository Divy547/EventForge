import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  SANDBOX_FLAKY_FAILURES,
  SANDBOX_PROJECT_SLUG,
  SANDBOX_SLOW_MAX_HOLD_MS,
  isSandboxScenario,
} from '@eventforge/common';
import { type Database, deliveries, projects, eq, and } from '@eventforge/database';
import { Public } from '../../common/decorators/public.decorator.js';
import { DATABASE } from '../database/database.provider.js';
import { REDIS_CLIENT } from '../redis/redis.provider.js';
import { SandboxService } from './sandbox.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The demo receiver that sandbox subscriptions point at. It is public because the worker calls
 * it without a key, but it only answers for deliveries that exist in the sandbox project (the
 * worker sends the delivery ID in `X-EventForge-Delivery-Id`), so it is useless as a generic
 * public endpoint. Hidden from the OpenAPI document.
 */
@ApiExcludeController()
@Controller('sandbox/receiver')
export class SandboxReceiverController {
  constructor(
    private readonly sandbox: SandboxService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @Post(':scenario')
  @HttpCode(200)
  async receive(
    @Param('scenario') scenario: string,
    @Headers('x-eventforge-delivery-id') deliveryId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ received: true; scenario: string; attempt?: number }> {
    this.sandbox.assertEnabled();
    if (!isSandboxScenario(scenario) || !deliveryId || !UUID.test(deliveryId)) {
      throw new NotFoundException();
    }
    if (!(await this.isSandboxDelivery(deliveryId))) {
      throw new NotFoundException();
    }

    switch (scenario) {
      case 'succeed':
        return { received: true, scenario };

      case 'flaky': {
        const attempt = await this.countAttempt(deliveryId);
        if (attempt <= SANDBOX_FLAKY_FAILURES) {
          throw new ServiceUnavailableException(
            `Sandbox receiver is failing on purpose (attempt ${attempt} of ${SANDBOX_FLAKY_FAILURES} planned failures)`,
          );
        }
        return { received: true, scenario, attempt };
      }

      case 'fail':
        throw new InternalServerErrorException('Sandbox receiver always fails on purpose');

      case 'slow': {
        // Never answers in time: wait until the caller gives up (the worker's timeout), with a
        // hard cap so a caller without a timeout cannot hold the connection forever.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, SANDBOX_SLOW_MAX_HOLD_MS);
          res.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        throw new ServiceUnavailableException('Sandbox receiver answered too late on purpose');
      }
    }
  }

  private async isSandboxDelivery(deliveryId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: deliveries.id })
      .from(deliveries)
      .innerJoin(projects, eq(projects.id, deliveries.projectId))
      .where(and(eq(deliveries.id, deliveryId), eq(projects.slug, SANDBOX_PROJECT_SLUG)))
      .limit(1);
    return rows.length > 0;
  }

  /** Counts attempts per delivery, so "fail N times then succeed" survives retries and replays. */
  private async countAttempt(deliveryId: string): Promise<number> {
    const key = `eventforge:sandbox:attempts:${deliveryId}`;
    const results = await this.redis.multi().incr(key).expire(key, 3600, 'NX').exec();
    return Number(results?.[0]?.[1]);
  }
}
