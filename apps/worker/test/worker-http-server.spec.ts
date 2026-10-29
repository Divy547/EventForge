import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'node:http';
import { WorkerHttpServerService } from '../src/server/worker-http-server.service.js';
import { WorkerConfigService } from '../src/config/worker-config.service.js';
import { WorkerDatabaseService } from '../src/database/worker-database.service.js';

describe('WorkerHttpServerService (Operational HTTP Server)', () => {
  let serverService: WorkerHttpServerService;
  const testPort = 3199;

  beforeAll(() => {
    const mockConfigService = {
      workerPort: testPort,
    } as unknown as WorkerConfigService;

    const mockDbService = {
      pool: {
        connect: () =>
          Promise.resolve({
            query: () => Promise.resolve({ rows: [{ 1: 1 }] }),
            release: () => {},
          }),
      },
    } as unknown as WorkerDatabaseService;

    const mockRedisClient = {
      status: 'ready',
    } as any;

    const mockDeliveryQueue = {
      getWaitingCount: () => Promise.resolve(5),
      getActiveCount: () => Promise.resolve(2),
      getDelayedCount: () => Promise.resolve(1),
      getFailedCount: () => Promise.resolve(0),
    } as any;

    serverService = new WorkerHttpServerService(
      mockConfigService,
      mockDbService,
      mockRedisClient,
      mockDeliveryQueue,
    );

    serverService.onModuleInit();
  });

  afterAll(async () => {
    await serverService.onApplicationShutdown();
  });

  function makeRequest(
    path: string,
    method = 'GET',
  ): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path,
          method,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              body: data,
              headers: res.headers,
            });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('GET /health should return 200 with service name and uptime', async () => {
    const res = await makeRequest('/health');
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('ok');
    expect(json.service).toBe('eventforge-worker');
    expect(typeof json.uptime).toBe('number');
  });

  it('GET /v1/health should also return 200', async () => {
    const res = await makeRequest('/v1/health');
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('ok');
  });

  it('GET /ready should return 200 with dependency statuses', async () => {
    const res = await makeRequest('/ready');
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('ready');
    expect(json.dependencies.postgres.status).toBe('up');
    expect(json.dependencies.redis.status).toBe('up');
  });

  it('GET /metrics should return Prometheus metrics with BullMQ queue gauges', async () => {
    const res = await makeRequest('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('# HELP eventforge_queue_waiting_jobs_gauge');
    expect(res.body).toContain('# TYPE eventforge_queue_waiting_jobs_gauge gauge');
    expect(res.body).toContain('eventforge_queue_waiting_jobs_gauge 5');
    expect(res.body).toContain('eventforge_queue_active_jobs_gauge 2');
    expect(res.body).toContain('eventforge_queue_delayed_jobs_gauge 1');
    expect(res.body).toContain('eventforge_queue_failed_jobs_gauge 0');
  });

  it('POST /health should return 405 Method Not Allowed', async () => {
    const res = await makeRequest('/health', 'POST');
    expect(res.status).toBe(405);
  });

  it('GET /unknown should return 404', async () => {
    const res = await makeRequest('/unknown');
    expect(res.status).toBe(404);
  });
});
