import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { EnvConfig } from '@eventforge/config';

/**
 * Applies transport-level protections shared by the real server and the test harness:
 * trust-proxy (so rate limiting sees client IPs behind a reverse proxy), `helmet`
 * security headers, and an explicit CORS allow-list.
 */
export function configureHttpSecurity(
  app: INestApplication,
  config: Pick<EnvConfig, 'CORS_ALLOWED_ORIGINS' | 'TRUST_PROXY_HOPS'>,
): void {
  const server = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: unknown) => void;
    disable: (key: string) => void;
  };
  server.disable('x-powered-by');
  if (config.TRUST_PROXY_HOPS > 0) {
    server.set('trust proxy', config.TRUST_PROXY_HOPS);
  }

  // Swagger UI relies on inline scripts/styles, so only /docs gets a relaxed CSP.
  const strict = helmet();
  const relaxed = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith('/docs') ? relaxed(req, res, next) : strict(req, res, next),
  );

  const allowed = new Set(config.CORS_ALLOWED_ORIGINS);
  app.enableCors({
    // No Origin header (curl, server-to-server) is unaffected. Browsers from origins
    // outside the allow-list receive no CORS headers and so are blocked.
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) =>
      callback(null, !origin || allowed.has(origin)),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    maxAge: 600,
  });
}
