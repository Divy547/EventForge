import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

export const DASHBOARD_PREFIX = '/dashboard';

/**
 * Default location of the built dashboard bundle. The relative path is the same from
 * `apps/api/src` (tsx dev) and `apps/api/dist` (compiled / Docker image).
 */
export function defaultDashboardDir(fromDir: string): string {
  return path.resolve(fromDir, '../../dashboard/dist');
}

/**
 * Serves the dashboard SPA under `/dashboard` from the same process as the API, so no extra
 * container is needed. Hashed files under `/assets` are cached for a year; `index.html` is never
 * cached so a redeploy is picked up immediately. Unknown extension-less paths fall back to
 * `index.html` (client-side routing); unknown files still return 404.
 *
 * Returns `false` (and serves nothing) when the bundle has not been built.
 */
export function configureDashboard(app: NestExpressApplication, dir: string): boolean {
  if (!existsSync(path.join(dir, 'index.html'))) return false;

  app.useStaticAssets(dir, {
    prefix: `${DASHBOARD_PREFIX}/`,
    index: false,
    redirect: false,
    setHeaders: (res, filePath) => {
      const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
      res.setHeader(
        'Cache-Control',
        immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const isDashboardPath =
      req.path === DASHBOARD_PREFIX || req.path.startsWith(`${DASHBOARD_PREFIX}/`);
    const isDocument =
      (req.method === 'GET' || req.method === 'HEAD') && path.extname(req.path) === '';
    if (!isDashboardPath || !isDocument) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root: dir }, (err) => (err ? next(err) : undefined));
  });

  return true;
}
