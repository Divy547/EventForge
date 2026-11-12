import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type Database,
  type ProjectRecord,
  projects,
  subscriptions,
  apiKeys,
  createApiKey,
  eq,
  and,
  lte,
  sql,
} from '@eventforge/database';
import {
  SANDBOX_KEY_TTL_MS,
  SANDBOX_PROJECT_SLUG,
  SANDBOX_SCENARIOS,
  SANDBOX_SCENARIO_INFO,
  generateSigningSecret,
  sandboxReceiverUrl,
  type SandboxScenario,
} from '@eventforge/common';
import { validateEnv } from '@eventforge/config';
import { DATABASE } from '../database/database.provider.js';
import { EventsService } from '../events/events.service.js';
import type {
  SandboxSessionResponseDto,
  SendSandboxEventResponseDto,
} from './dto/send-sandbox-event.dto.js';

/** Arbitrary constant: serialises first-time creation of the sandbox project across replicas. */
const SANDBOX_SETUP_LOCK = 7_262_025;

@Injectable()
export class SandboxService {
  private readonly config = validateEnv();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly eventsService: EventsService,
  ) {}

  get enabled(): boolean {
    return this.config.SANDBOX_ENABLED;
  }

  /** Throws 404 when sandbox mode is off, so the endpoints look absent rather than forbidden. */
  assertEnabled(): void {
    if (!this.enabled) {
      throw new NotFoundException('Sandbox mode is not enabled on this server');
    }
  }

  /**
   * Gives a visitor a short-lived API key for the shared sandbox project. Everyone who starts a
   * session sees the same project, which is what a public demo wants. Expired keys are removed
   * here, so the table cannot grow without bound.
   */
  async createSession(): Promise<SandboxSessionResponseDto> {
    this.assertEnabled();
    const project = await this.ensureSandbox();

    await this.db
      .delete(apiKeys)
      .where(and(eq(apiKeys.projectId, project.id), lte(apiKeys.expiresAt, new Date())));

    const expiresAt = new Date(Date.now() + SANDBOX_KEY_TTL_MS);
    const { rawKey } = await createApiKey(this.db, {
      projectId: project.id,
      name: 'Sandbox visitor',
      expiresAt,
    });
    return { apiKey: rawKey, expiresAt: expiresAt.toISOString() };
  }

  /** Sends one event for a scenario; its subscription (pointing at the demo receiver) is ensured first. */
  async sendEvent(
    project: { id: string },
    scenario: SandboxScenario,
    traceContext?: { traceparent?: string | undefined; tracestate?: string | undefined },
  ): Promise<SendSandboxEventResponseDto> {
    this.assertEnabled();
    await this.ensureSandbox();
    const info = SANDBOX_SCENARIO_INFO[scenario];
    const result = await this.eventsService.ingestEvent(
      project.id,
      {
        eventType: info.eventType,
        source: 'sandbox',
        payload: {
          scenario,
          message: 'Hello from the EventForge sandbox',
          sentAt: new Date().toISOString(),
        },
      },
      traceContext,
    );
    return { eventId: result.id, scenario, eventType: info.eventType };
  }

  /**
   * Makes sure the sandbox project and one subscription per scenario exist and are in their
   * canonical state (active, pointing at the receiver, listening for the scenario's event type).
   * Visitors cannot edit subscriptions through the API, but this also repairs rows changed some
   * other way. The common case is a single read.
   */
  async ensureSandbox(): Promise<ProjectRecord> {
    const receiverBase = this.config.SANDBOX_RECEIVER_URL;
    if (!receiverBase) {
      throw new NotFoundException('Sandbox mode is not enabled on this server');
    }
    const existing = await this.readState();
    if (existing.project && this.isCanonical(existing.subs, receiverBase)) {
      return existing.project;
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${SANDBOX_SETUP_LOCK})`);
      const db = tx as unknown as Database;
      const state = await this.readState(db);

      let project = state.project;
      if (!project) {
        const [created] = await db
          .insert(projects)
          .values({ name: 'Sandbox', slug: SANDBOX_PROJECT_SLUG })
          .returning();
        if (!created) throw new Error('Failed to create the sandbox project');
        project = created;
      }

      for (const scenario of SANDBOX_SCENARIOS) {
        const info = SANDBOX_SCENARIO_INFO[scenario];
        const url = sandboxReceiverUrl(receiverBase, scenario);
        const row = state.subs.find((s) => s.name === info.subscriptionName);
        if (!row) {
          await db.insert(subscriptions).values({
            projectId: project.id,
            name: info.subscriptionName,
            targetUrl: url,
            signingSecret: generateSigningSecret('whsec'),
            eventTypes: [info.eventType],
            isActive: true,
          });
        } else if (
          row.targetUrl !== url ||
          !row.isActive ||
          row.eventTypes.length !== 1 ||
          row.eventTypes[0] !== info.eventType
        ) {
          await db
            .update(subscriptions)
            .set({
              targetUrl: url,
              isActive: true,
              eventTypes: [info.eventType],
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, row.id));
        }
      }
      return project;
    });
  }

  private async readState(db: Database = this.db) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, SANDBOX_PROJECT_SLUG))
      .limit(1);
    const subs = project
      ? await db.select().from(subscriptions).where(eq(subscriptions.projectId, project.id))
      : [];
    return { project, subs };
  }

  private isCanonical(
    subs: Array<{ name: string; targetUrl: string; isActive: boolean; eventTypes: string[] }>,
    receiverBase: string,
  ): boolean {
    return SANDBOX_SCENARIOS.every((scenario) => {
      const info = SANDBOX_SCENARIO_INFO[scenario];
      const matching = subs.filter((s) => s.name === info.subscriptionName);
      const row = matching[0];
      return (
        matching.length === 1 &&
        row !== undefined &&
        row.isActive &&
        row.targetUrl === sandboxReceiverUrl(receiverBase, scenario) &&
        row.eventTypes.length === 1 &&
        row.eventTypes[0] === info.eventType
      );
    });
  }
}
