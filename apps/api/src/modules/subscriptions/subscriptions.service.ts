import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { generateSigningSecret } from '@eventforge/common';
import {
  type Database,
  subscriptions,
  type SubscriptionRecord,
  eq,
  and,
} from '@eventforge/database';
import { DATABASE } from '../database/database.provider.js';
import { validateDestinationUrl } from '../../common/utils/ssrf-validator.js';
import type { CreateSubscriptionDto } from './dto/create-subscription.dto.js';
import type { UpdateSubscriptionDto } from './dto/update-subscription.dto.js';
import type {
  SubscriptionResponseDto,
  CreatedSubscriptionResponseDto,
} from './dto/subscription-response.dto.js';

@Injectable()
export class SubscriptionsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Creates a new webhook subscription with SSRF validation and generates an HMAC signing secret.
   */
  async createSubscription(
    projectId: string,
    dto: CreateSubscriptionDto,
  ): Promise<CreatedSubscriptionResponseDto> {
    const ssrfResult = await validateDestinationUrl(dto.targetUrl, {
      allowLocal: process.env.ALLOW_LOCAL_WEBHOOKS === 'true',
    });

    if (!ssrfResult.isValid) {
      throw new BadRequestException(
        `Target URL failed security verification (SSRF Protection): ${ssrfResult.reason}`,
      );
    }

    const signingSecret = generateSigningSecret('whsec');

    const inserted = await this.db
      .insert(subscriptions)
      .values({
        projectId,
        name: dto.name,
        targetUrl: dto.targetUrl,
        signingSecret,
        eventTypes: dto.eventTypes,
        rateLimitPerSecond: dto.rateLimitPerSecond || null,
        headers: dto.headers || null,
        isActive: true,
      })
      .returning();

    const sub = inserted[0];
    if (!sub) {
      throw new Error('Failed to create subscription record');
    }

    return {
      ...this.mapToResponseDto(sub),
      signingSecret,
    };
  }

  /**
   * Lists all subscriptions belonging to the authenticated project.
   * Note: signing secrets are strictly omitted.
   */
  async listSubscriptions(projectId: string): Promise<SubscriptionResponseDto[]> {
    const records = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.projectId, projectId))
      .orderBy(subscriptions.createdAt);

    return records.map((r: SubscriptionRecord) => this.mapToResponseDto(r));
  }

  /**
   * Retrieves a single subscription by ID, enforcing project isolation.
   */
  async getSubscriptionById(
    projectId: string,
    subscriptionId: string,
  ): Promise<SubscriptionResponseDto> {
    const records = await this.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.projectId, projectId)))
      .limit(1);

    const sub = records[0];
    if (!sub) {
      throw new NotFoundException(`Subscription with identifier '${subscriptionId}' not found`);
    }

    return this.mapToResponseDto(sub);
  }

  /**
   * Updates a subscription, re-validating the target URL against SSRF if changed.
   */
  async updateSubscription(
    projectId: string,
    subscriptionId: string,
    dto: UpdateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    if (dto.targetUrl) {
      const ssrfResult = await validateDestinationUrl(dto.targetUrl, {
        allowLocal: process.env.ALLOW_LOCAL_WEBHOOKS === 'true',
      });

      if (!ssrfResult.isValid) {
        throw new BadRequestException(
          `Target URL failed security verification (SSRF Protection): ${ssrfResult.reason}`,
        );
      }
    }

    const updated = await this.db
      .update(subscriptions)
      .set({
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.targetUrl ? { targetUrl: dto.targetUrl } : {}),
        ...(dto.eventTypes ? { eventTypes: dto.eventTypes } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.rateLimitPerSecond !== undefined
          ? { rateLimitPerSecond: dto.rateLimitPerSecond }
          : {}),
        ...(dto.headers !== undefined ? { headers: dto.headers } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.projectId, projectId)))
      .returning();

    const sub = updated[0];
    if (!sub) {
      throw new NotFoundException(`Subscription with identifier '${subscriptionId}' not found`);
    }

    return this.mapToResponseDto(sub);
  }

  /**
   * Deletes a subscription, enforcing project isolation.
   */
  async deleteSubscription(projectId: string, subscriptionId: string): Promise<void> {
    const deleted = await this.db
      .delete(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.projectId, projectId)))
      .returning({ id: subscriptions.id });

    if (deleted.length === 0) {
      throw new NotFoundException(`Subscription with identifier '${subscriptionId}' not found`);
    }
  }

  private mapToResponseDto(record: SubscriptionRecord): SubscriptionResponseDto {
    return {
      id: record.id,
      projectId: record.projectId,
      name: record.name,
      targetUrl: record.targetUrl,
      eventTypes: record.eventTypes,
      isActive: record.isActive,
      rateLimitPerSecond: record.rateLimitPerSecond,
      headers: record.headers,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
