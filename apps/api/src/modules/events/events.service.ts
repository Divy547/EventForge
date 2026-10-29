import {
  Injectable,
  Inject,
  NotFoundException,
  PayloadTooLargeException,
  Logger,
} from '@nestjs/common';
import {
  type Database,
  events,
  insertEventWithOutbox,
  sql,
  eq,
  and,
  gte,
  lte,
} from '@eventforge/database';
import { defaultMetricsRegistry } from '@eventforge/common';
import { DATABASE } from '../database/database.provider.js';
import type { IngestEventDto } from './dto/ingest-event.dto.js';
import type { ListEventsQueryDto } from './dto/list-events-query.dto.js';
import type {
  IngestEventResponseDto,
  EventDetailResponseDto,
  PaginatedEventsResponseDto,
} from './dto/event-response.dto.js';

const MAX_PAYLOAD_BYTES = 256 * 1024; // 256 KB

const eventsAcceptedTotal = defaultMetricsRegistry.registerCounter(
  'eventforge_events_accepted_total',
  'Total number of events successfully accepted for ingestion',
  ['event_type', 'is_duplicate'],
);

const eventsRejectedTotal = defaultMetricsRegistry.registerCounter(
  'eventforge_events_rejected_total',
  'Total number of event ingestion requests rejected before acceptance',
  ['reason'],
);

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Durably ingests an event and creates its transactional outbox record atomically.
   */
  async ingestEvent(projectId: string, dto: IngestEventDto): Promise<IngestEventResponseDto> {
    const payloadStr = JSON.stringify(dto.payload);
    if (Buffer.byteLength(payloadStr, 'utf8') > MAX_PAYLOAD_BYTES) {
      eventsRejectedTotal.inc({ reason: 'payload_too_large' });
      throw new PayloadTooLargeException(
        `Event payload exceeds the maximum allowed size of ${MAX_PAYLOAD_BYTES / 1024} KB`,
      );
    }

    const result = await insertEventWithOutbox(this.db, {
      projectId,
      eventType: dto.eventType,
      source: dto.source,
      payload: dto.payload,
      metadata: dto.metadata || {},
      idempotencyKey: dto.idempotencyKey || null,
    });

    eventsAcceptedTotal.inc({
      event_type: dto.eventType,
      is_duplicate: String(result.isDuplicate),
    });

    this.logger.log({
      message: `Event ${result.event.id} accepted for processing`,
      eventId: result.event.id,
      eventType: dto.eventType,
      source: dto.source,
      projectId,
      isDuplicate: result.isDuplicate,
    });

    return {
      id: result.event.id,
      eventType: result.event.eventType,
      source: result.event.source,
      status: 'ACCEPTED',
      isDuplicate: result.isDuplicate,
      createdAt: result.event.createdAt.toISOString(),
    };
  }

  /**
   * Retrieves an event by ID strictly scoped to the authenticated project.
   */
  async getEventById(projectId: string, eventId: string): Promise<EventDetailResponseDto> {
    const records = await this.db
      .select()
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.projectId, projectId)))
      .limit(1);

    const event = records[0];
    if (!event) {
      throw new NotFoundException(`Event with identifier '${eventId}' not found`);
    }

    return {
      id: event.id,
      projectId: event.projectId,
      idempotencyKey: event.idempotencyKey,
      eventType: event.eventType,
      source: event.source,
      payload: event.payload as Record<string, unknown>,
      metadata: event.metadata as Record<string, unknown>,
      createdAt: event.createdAt.toISOString(),
    };
  }

  /**
   * Lists events for the authenticated project with bounded pagination and filtering.
   */
  async listEvents(
    projectId: string,
    query: ListEventsQueryDto,
  ): Promise<PaginatedEventsResponseDto> {
    const conditions = [eq(events.projectId, projectId)];

    if (query.eventType) {
      conditions.push(eq(events.eventType, query.eventType));
    }

    if (query.source) {
      conditions.push(eq(events.source, query.source));
    }

    if (query.from) {
      conditions.push(gte(events.createdAt, new Date(query.from)));
    }

    if (query.to) {
      conditions.push(lte(events.createdAt, new Date(query.to)));
    }

    const whereClause = and(...conditions);
    const offset = (query.page - 1) * query.limit;

    // 1. Get total count
    const countResult = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(whereClause);

    const total = countResult[0]?.count || 0;

    // 2. Fetch page data with deterministic ordering
    const records = await this.db
      .select()
      .from(events)
      .where(whereClause)
      .orderBy(sql`${events.createdAt} DESC`, sql`${events.id} DESC`)
      .limit(query.limit)
      .offset(offset);

    const data: EventDetailResponseDto[] = records.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      idempotencyKey: e.idempotencyKey,
      eventType: e.eventType,
      source: e.source,
      payload: e.payload as Record<string, unknown>,
      metadata: e.metadata as Record<string, unknown>,
      createdAt: e.createdAt.toISOString(),
    }));

    return {
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }
}
