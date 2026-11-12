import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  getDatabaseConnection,
  createProject,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  findProject,
  AdminError,
  apiKeys,
  eq,
  type Database,
} from '@eventforge/database';
import { hashApiKey } from '@eventforge/common';

describe('Admin operations (projects & API keys)', () => {
  let app: INestApplication;
  let db: Database;

  const slug = `admin-test-${Date.now()}`;
  let projectId: string;

  const statusFor = async (rawKey: string): Promise<number> =>
    (await request(app.getHttpServer()).get('/v1/subscriptions').set('X-API-Key', rawKey)).status;

  beforeAll(async () => {
    db = getDatabaseConnection().db;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a project and rejects duplicate or invalid slugs', async () => {
    const project = await createProject(db, { name: 'Admin Test', slug });
    projectId = project.id;
    expect((await findProject(db, slug)).id).toBe(projectId);
    expect((await findProject(db, projectId)).slug).toBe(slug);

    await expect(createProject(db, { name: 'Dup', slug })).rejects.toThrow(AdminError);
    await expect(createProject(db, { name: 'Bad', slug: 'Not Valid!' })).rejects.toThrow(
      AdminError,
    );
  });

  it('creates a key that authenticates, stores only the hash, and lists without secrets', async () => {
    const { rawKey, key } = await createApiKey(db, { projectId, name: 'first' });
    expect(await statusFor(rawKey)).toBe(200);

    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row?.hashedKey).toBe(hashApiKey(rawKey));
    expect(JSON.stringify(row)).not.toContain(rawKey);

    const listed = await listApiKeys(db, { projectId });
    expect(listed.map((k) => k.id)).toContain(key.id);
    expect(JSON.stringify(listed)).not.toContain(rawKey);
    expect(listed[0]).not.toHaveProperty('hashedKey');
  });

  it('revokes a key so it receives 401, and refuses to revoke twice', async () => {
    const { rawKey, key } = await createApiKey(db, { projectId, name: 'to-revoke' });
    expect(await statusFor(rawKey)).toBe(200);

    await revokeApiKey(db, key.id);
    expect(await statusFor(rawKey)).toBe(401);
    await expect(revokeApiKey(db, key.id)).rejects.toThrow(AdminError);
  });

  it('rotates a key: old key 401, new key 200, same project, old key cannot rotate again', async () => {
    const { rawKey: oldRaw, key: oldKey } = await createApiKey(db, { projectId, name: 'rot' });
    const { rawKey: newRaw, key: newKey } = await rotateApiKey(db, oldKey.id);

    expect(newRaw).not.toBe(oldRaw);
    expect(newKey.projectId).toBe(projectId);
    expect(newKey.name).toBe('rot');
    expect(await statusFor(oldRaw)).toBe(401);
    expect(await statusFor(newRaw)).toBe(200);
    await expect(rotateApiKey(db, oldKey.id)).rejects.toThrow(AdminError);
  });
});
