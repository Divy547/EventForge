import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hashApiKey } from '@eventforge/common';
import { type Database, apiKeys, projects, eq, and, isNull } from '@eventforge/database';
import { DATABASE } from '../../modules/database/database.provider.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

export interface AuthenticatedProject {
  id: string;
  name: string;
  slug: string;
  apiKeyId: string;
}

declare module 'express' {
  interface Request {
    project?: AuthenticatedProject;
  }
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const rawKey = this.extractApiKey(request);

    if (!rawKey) {
      throw new UnauthorizedException('Missing required authentication credentials (API key)');
    }

    const hashedKey = hashApiKey(rawKey);

    const records = await this.db
      .select({
        apiKeyId: apiKeys.id,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        projectId: projects.id,
        projectName: projects.name,
        projectSlug: projects.slug,
      })
      .from(apiKeys)
      .innerJoin(projects, eq(apiKeys.projectId, projects.id))
      .where(and(eq(apiKeys.hashedKey, hashedKey), isNull(apiKeys.revokedAt)))
      .limit(1);

    const keyRecord = records[0];
    if (!keyRecord) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('API key has expired');
    }

    // Fire-and-forget timestamp update
    this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, keyRecord.apiKeyId))
      .catch(() => {});

    request.project = {
      id: keyRecord.projectId,
      name: keyRecord.projectName,
      slug: keyRecord.projectSlug,
      apiKeyId: keyRecord.apiKeyId,
    };

    return true;
  }

  private extractApiKey(request: Request): string | null {
    // 1. Check X-API-Key header
    const apiKeyHeader = request.header('X-API-Key');
    if (apiKeyHeader) {
      return apiKeyHeader.trim();
    }

    // 2. Check Authorization: Bearer <key>
    const authHeader = request.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }

    return null;
  }
}
