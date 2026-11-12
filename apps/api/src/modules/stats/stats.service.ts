import { Injectable, Inject } from '@nestjs/common';
import {
  type Database,
  deliveries,
  deliveryAttempts,
  events,
  subscriptions,
  eq,
  and,
  gte,
  inArray,
  desc,
  sql,
} from '@eventforge/database';
import { DATABASE } from '../database/database.provider.js';
import { computeSuccessRate } from './stats.util.js';
import type {
  DeliveryStatusCountsDto,
  RecentFailureDto,
  StatsResponseDto,
} from './dto/stats-response.dto.js';

const RECENT_FAILURES_LIMIT = 10;

@Injectable()
export class StatsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Aggregated delivery health for a project over a look-back window. Every query is scoped to
   * the authenticated project.
   */
  async getStats(projectId: string, windowHours: number): Promise<StatsResponseDto> {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const [statusRows, eventCountRows, failureRows] = await Promise.all([
      this.db
        .select({ status: deliveries.status, count: sql<number>`count(*)::int` })
        .from(deliveries)
        .where(and(eq(deliveries.projectId, projectId), gte(deliveries.createdAt, since)))
        .groupBy(deliveries.status),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(events)
        .where(and(eq(events.projectId, projectId), gte(events.createdAt, since))),
      this.db
        .select({
          deliveryId: deliveries.id,
          eventId: deliveries.eventId,
          eventType: events.eventType,
          subscriptionId: deliveries.subscriptionId,
          subscriptionName: subscriptions.name,
          status: deliveries.status,
          attemptsCount: deliveries.attemptsCount,
          updatedAt: deliveries.updatedAt,
        })
        .from(deliveries)
        .innerJoin(events, eq(events.id, deliveries.eventId))
        .innerJoin(subscriptions, eq(subscriptions.id, deliveries.subscriptionId))
        .where(
          and(
            eq(deliveries.projectId, projectId),
            inArray(deliveries.status, ['FAILED', 'DEAD_LETTER']),
            gte(deliveries.updatedAt, since),
          ),
        )
        .orderBy(desc(deliveries.updatedAt), desc(deliveries.id))
        .limit(RECENT_FAILURES_LIMIT),
    ]);

    const byStatus: DeliveryStatusCountsDto = {
      PENDING: 0,
      IN_FLIGHT: 0,
      COMPLETED: 0,
      FAILED: 0,
      DEAD_LETTER: 0,
    };
    for (const row of statusRows) {
      if (row.status in byStatus) {
        byStatus[row.status as keyof DeliveryStatusCountsDto] = row.count;
      }
    }

    // Latest attempt per failed delivery, for the status code and error shown beside each failure.
    const latestAttempts = new Map<string, { statusCode: number | null; error: string | null }>();
    if (failureRows.length > 0) {
      const attemptRows = await this.db
        .selectDistinctOn([deliveryAttempts.deliveryId], {
          deliveryId: deliveryAttempts.deliveryId,
          statusCode: deliveryAttempts.statusCode,
          errorCode: deliveryAttempts.errorCode,
          errorMessage: deliveryAttempts.errorMessage,
        })
        .from(deliveryAttempts)
        .where(
          inArray(
            deliveryAttempts.deliveryId,
            failureRows.map((r) => r.deliveryId),
          ),
        )
        .orderBy(deliveryAttempts.deliveryId, desc(deliveryAttempts.attemptNumber));
      for (const a of attemptRows) {
        latestAttempts.set(a.deliveryId, {
          statusCode: a.statusCode,
          error: a.errorMessage ?? a.errorCode,
        });
      }
    }

    const recentFailures: RecentFailureDto[] = failureRows.map((r) => ({
      deliveryId: r.deliveryId,
      eventId: r.eventId,
      eventType: r.eventType,
      subscriptionId: r.subscriptionId,
      subscriptionName: r.subscriptionName,
      status: r.status,
      attemptsCount: r.attemptsCount,
      lastStatusCode: latestAttempts.get(r.deliveryId)?.statusCode ?? null,
      lastError: latestAttempts.get(r.deliveryId)?.error ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));

    return {
      windowHours,
      since: since.toISOString(),
      eventsTotal: eventCountRows[0]?.count ?? 0,
      deliveriesTotal: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      deliveriesByStatus: byStatus,
      successRate: computeSuccessRate(byStatus.COMPLETED, byStatus.DEAD_LETTER),
      recentFailures,
    };
  }
}
