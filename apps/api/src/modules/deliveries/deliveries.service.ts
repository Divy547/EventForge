import { Injectable, Inject, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  type Database,
  type DeliveryRecord,
  type DeliveryAttemptRecord,
  deliveries,
  events,
  subscriptions,
  deliveryAttempts,
  replayDeadLetterDelivery,
  batchReplayDeadLetterDeliveries,
  eq,
  and,
  gte,
  lte,
  desc,
  asc,
  sql,
} from '@eventforge/database';
import { DATABASE } from '../database/database.provider.js';
import { DELIVERY_QUEUE } from '../redis/redis.provider.js';
import type { ListDeliveriesQueryDto } from './dto/list-deliveries-query.dto.js';
import type {
  PaginatedDeliveriesResponseDto,
  DeliveryDetailResponseDto,
  DeliverySummaryResponseDto,
} from './dto/delivery-response.dto.js';
import type {
  ReplaySingleDeliveryDto,
  ReplaySingleResponseDto,
  ReplayBatchDeliveriesDto,
  ReplayBatchResponseDto,
} from './dto/replay-delivery.dto.js';

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(DELIVERY_QUEUE) private readonly deliveryQueue: Queue,
  ) {}

  /**
   * Lists project deliveries with filtering and pagination.
   * Defaults to DEAD_LETTER deliveries when query.status is not specified.
   */
  async listDeliveries(
    projectId: string,
    query: ListDeliveriesQueryDto,
  ): Promise<PaginatedDeliveriesResponseDto> {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const conditions = [eq(deliveries.projectId, projectId)];

    if (query.status) {
      conditions.push(eq(deliveries.status, query.status));
    }
    if (query.subscriptionId) {
      conditions.push(eq(deliveries.subscriptionId, query.subscriptionId));
    }
    if (query.eventId) {
      conditions.push(eq(deliveries.eventId, query.eventId));
    }
    if (query.from) {
      conditions.push(gte(deliveries.createdAt, new Date(query.from)));
    }
    if (query.to) {
      conditions.push(lte(deliveries.createdAt, new Date(query.to)));
    }

    const whereClause = and(...conditions);

    const [countResult, rows] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(deliveries)
        .where(whereClause),
      this.db
        .select()
        .from(deliveries)
        .where(whereClause)
        .orderBy(desc(deliveries.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    const data: DeliverySummaryResponseDto[] = rows.map((row: DeliveryRecord) => ({
      id: row.id,
      projectId: row.projectId,
      eventId: row.eventId,
      subscriptionId: row.subscriptionId,
      status: row.status,
      attemptsCount: row.attemptsCount,
      maxAttempts: row.maxAttempts,
      nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Retrieves full delivery details, associated event, subscription (secret omitted),
   * and chronological attempt execution history.
   */
  async getDeliveryById(projectId: string, id: string): Promise<DeliveryDetailResponseDto> {
    const [delivery] = await this.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.id, id), eq(deliveries.projectId, projectId)))
      .limit(1);

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    const [eventRows, subRows, attemptRows] = await Promise.all([
      this.db
        .select({
          id: events.id,
          eventType: events.eventType,
          source: events.source,
          createdAt: events.createdAt,
        })
        .from(events)
        .where(eq(events.id, delivery.eventId))
        .limit(1),
      this.db
        .select({
          id: subscriptions.id,
          name: subscriptions.name,
          targetUrl: subscriptions.targetUrl,
          isActive: subscriptions.isActive,
        })
        .from(subscriptions)
        .where(eq(subscriptions.id, delivery.subscriptionId))
        .limit(1),
      this.db
        .select()
        .from(deliveryAttempts)
        .where(eq(deliveryAttempts.deliveryId, delivery.id))
        .orderBy(asc(deliveryAttempts.attemptNumber)),
    ]);

    const event = eventRows[0]
      ? {
          id: eventRows[0].id,
          eventType: eventRows[0].eventType,
          source: eventRows[0].source,
          createdAt: eventRows[0].createdAt.toISOString(),
        }
      : undefined;

    const subscription = subRows[0]
      ? {
          id: subRows[0].id,
          name: subRows[0].name,
          targetUrl: subRows[0].targetUrl,
          isActive: subRows[0].isActive,
        }
      : undefined;

    const attempts = attemptRows.map((a: DeliveryAttemptRecord) => ({
      id: a.id,
      attemptNumber: a.attemptNumber,
      statusCode: a.statusCode,
      responseBodySnippet: a.responseBodySnippet,
      executionDurationMs: a.executionDurationMs,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      createdAt: a.createdAt.toISOString(),
    }));

    return {
      id: delivery.id,
      projectId: delivery.projectId,
      eventId: delivery.eventId,
      subscriptionId: delivery.subscriptionId,
      status: delivery.status,
      attemptsCount: delivery.attemptsCount,
      maxAttempts: delivery.maxAttempts,
      nextRetryAt: delivery.nextRetryAt?.toISOString() ?? null,
      completedAt: delivery.completedAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
      event,
      subscription,
      attempts,
    };
  }

  /**
   * Replays a single dead-letter delivery.
   * Atomically transitions status to PENDING, increases maxAttempts, and enqueues to BullMQ.
   */
  async replayDelivery(
    projectId: string,
    id: string,
    dto: ReplaySingleDeliveryDto,
  ): Promise<ReplaySingleResponseDto> {
    try {
      const result = await replayDeadLetterDelivery(
        this.db,
        projectId,
        id,
        dto.additionalAttempts ?? 3,
      );

      if (!result) {
        throw new NotFoundException('Delivery not found');
      }

      // Enqueue job with deterministic attempt-based ID
      const targetAttempt = result.targetAttempt;
      const jobId = `delivery-${result.delivery.id}-${targetAttempt}`;

      try {
        await this.deliveryQueue.add('deliver', { deliveryId: result.delivery.id }, { jobId });
      } catch (err) {
        // PostgreSQL is the source of truth: background worker recovery will claim PENDING deliveries
        this.logger.warn({
          message: `Redis enqueue failed during replay for delivery ${id}: ${err instanceof Error ? err.message : String(err)}. Delivery will be recovered by worker.`,
          deliveryId: id,
          projectId,
        });
      }

      const summary: DeliverySummaryResponseDto = {
        id: result.delivery.id,
        projectId: result.delivery.projectId,
        eventId: result.delivery.eventId,
        subscriptionId: result.delivery.subscriptionId,
        status: result.delivery.status,
        attemptsCount: result.delivery.attemptsCount,
        maxAttempts: result.delivery.maxAttempts,
        nextRetryAt: result.delivery.nextRetryAt?.toISOString() ?? null,
        completedAt: result.delivery.completedAt?.toISOString() ?? null,
        createdAt: result.delivery.createdAt.toISOString(),
        updatedAt: result.delivery.updatedAt.toISOString(),
      };

      return {
        delivery: summary,
        replayed: true,
        message: 'Delivery successfully reset to PENDING and scheduled for redelivery',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes("only 'DEAD_LETTER' deliveries can be replayed") ||
        msg.includes('concurrently')
      ) {
        throw new ConflictException(msg);
      }
      throw error;
    }
  }

  /**
   * Batch replays dead-letter deliveries with per-item status tracking.
   */
  async batchReplay(
    projectId: string,
    dto: ReplayBatchDeliveriesDto,
  ): Promise<ReplayBatchResponseDto> {
    const result = await batchReplayDeadLetterDeliveries(this.db, projectId, {
      deliveryIds: dto.deliveryIds,
      subscriptionId: dto.subscriptionId,
      additionalAttempts: dto.additionalAttempts ?? 3,
      limit: dto.limit ?? 50,
    });

    // Enqueue BullMQ jobs for all successfully transitioned deliveries
    for (const item of result.items) {
      if (item.success && item.targetAttempt) {
        const jobId = `delivery-${item.deliveryId}-${item.targetAttempt}`;
        try {
          await this.deliveryQueue.add('deliver', { deliveryId: item.deliveryId }, { jobId });
        } catch (err) {
          this.logger.warn({
            message: `Redis enqueue failed during batch replay for delivery ${item.deliveryId}: ${err instanceof Error ? err.message : String(err)}. Recovery poller will dispatch.`,
            deliveryId: item.deliveryId,
          });
        }
      }
    }

    return {
      totalRequested: result.totalRequested,
      replayedCount: result.replayedCount,
      failedCount: result.failedCount,
      items: result.items.map((item) => ({
        deliveryId: item.deliveryId,
        success: item.success,
        status: item.delivery?.status,
        error: item.error,
        statusCode: item.statusCode,
      })),
    };
  }
}
