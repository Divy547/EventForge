import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from '../src/common/guards/api-key.guard.js';

interface MockDb {
  select: jest.Mock<(...args: any[]) => any>;
  from: jest.Mock<(...args: any[]) => any>;
  innerJoin: jest.Mock<(...args: any[]) => any>;
  where: jest.Mock<(...args: any[]) => any>;
  limit: jest.Mock<(...args: any[]) => any>;
  update: jest.Mock<(...args: any[]) => any>;
  set: jest.Mock<(...args: any[]) => any>;
}

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let reflector: Reflector;
  let mockDb: MockDb;

  beforeEach(() => {
    reflector = new Reflector();
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };
    guard = new ApiKeyGuard(reflector, mockDb as unknown as any);
  });

  function createMockContext(headers: Record<string, string>, isPublic = false): ExecutionContext {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);

    const request = {
      header: (name: string) => headers[name.toLowerCase()] || headers[name] || null,
      project: undefined,
    };

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: jest.fn(),
        getNext: jest.fn(),
      }),
    } as unknown as ExecutionContext;
  }

  it('should allow access to public routes without checking API key', async () => {
    const context = createMockContext({}, true);
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should reject request when no API key header is provided', async () => {
    const context = createMockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should reject request when API key is not found in database', async () => {
    mockDb.limit.mockResolvedValue([]);
    const context = createMockContext({ 'x-api-key': 'ef_live_nonexistent' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should reject request when API key has expired', async () => {
    const expiredDate = new Date(Date.now() - 100000);
    mockDb.limit.mockResolvedValue([
      {
        apiKeyId: 'key-1',
        projectId: 'proj-1',
        projectName: 'Test Project',
        projectSlug: 'test',
        expiresAt: expiredDate,
        revokedAt: null,
      },
    ]);

    const context = createMockContext({ 'x-api-key': 'ef_live_expired' });
    await expect(guard.canActivate(context)).rejects.toThrow('API key has expired');
  });

  it('should authenticate valid API key and attach project to request', async () => {
    const validKey = 'ef_live_valid123456';
    mockDb.limit.mockResolvedValue([
      {
        apiKeyId: 'key-123',
        projectId: 'proj-456',
        projectName: 'Acme Corp',
        projectSlug: 'acme',
        expiresAt: null,
        revokedAt: null,
      },
    ]);
    mockDb.set.mockReturnValue({
      where: jest.fn().mockReturnValue(Promise.resolve()),
    });

    const context = createMockContext({ 'x-api-key': validKey });
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    const req = context.switchToHttp().getRequest() as any;
    expect(req.project).toEqual({
      id: 'proj-456',
      name: 'Acme Corp',
      slug: 'acme',
      apiKeyId: 'key-123',
    });
  });

  it('should also accept Authorization: Bearer <key> header', async () => {
    const validKey = 'ef_live_bearer123';
    mockDb.limit.mockResolvedValue([
      {
        apiKeyId: 'key-999',
        projectId: 'proj-888',
        projectName: 'Bearer Project',
        projectSlug: 'bearer-corp',
        expiresAt: null,
        revokedAt: null,
      },
    ]);
    mockDb.set.mockReturnValue({
      where: jest.fn().mockReturnValue(Promise.resolve()),
    });

    const context = createMockContext({ authorization: `Bearer ${validKey}` });
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    const req = context.switchToHttp().getRequest() as any;
    expect(req.project.id).toBe('proj-888');
  });
});
