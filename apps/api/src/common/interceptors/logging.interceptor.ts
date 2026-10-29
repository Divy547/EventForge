import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  Logger,
} from '@nestjs/common';
import { type Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { defaultMetricsRegistry } from '@eventforge/common';

const httpRequestsTotal = defaultMetricsRegistry.registerCounter(
  'eventforge_http_requests_total',
  'Total number of inbound HTTP requests handled by the API',
  ['method', 'route', 'status_code_class'],
);

const httpRequestDurationSeconds = defaultMetricsRegistry.registerHistogram(
  'eventforge_http_request_duration_seconds',
  'HTTP request latency in seconds',
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  ['method', 'route', 'status_code_class'],
);

function normalizeRoutePath(req: Request): string {
  if (req.route && typeof req.route.path === 'string') {
    const baseUrl = req.baseUrl || '';
    return `${baseUrl}${req.route.path}` || '/';
  }

  const pathname = req.originalUrl?.split('?')[0] || req.url?.split('?')[0] || '/';
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+/g, '/:id');
}

function getStatusCodeClass(code: number): string {
  if (code >= 200 && code < 300) return '2xx';
  if (code >= 300 && code < 400) return '3xx';
  if (code >= 400 && code < 500) return '4xx';
  if (code >= 500) return '5xx';
  return 'other';
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startHr = process.hrtime.bigint();
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { method, originalUrl, ip } = request;
    const correlationId = request.correlationId;

    return next.handle().pipe(
      tap({
        next: () => {
          const deltaNs = process.hrtime.bigint() - startHr;
          const durationMs = Number(deltaNs) / 1_000_000;
          const durationSeconds = Number(deltaNs) / 1_000_000_000;
          const statusCode = response.statusCode;
          const statusCodeClass = getStatusCodeClass(statusCode);
          const route = normalizeRoutePath(request);
          const projectId = request.project?.id || 'anonymous';

          // Record metrics
          httpRequestsTotal.inc({ method, route, status_code_class: statusCodeClass });
          httpRequestDurationSeconds.observe(durationSeconds, {
            method,
            route,
            status_code_class: statusCodeClass,
          });

          this.logger.log({
            message: `${method} ${originalUrl} ${statusCode} ${durationMs.toFixed(2)}ms`,
            method,
            url: originalUrl,
            route,
            statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
            projectId,
            correlationId,
            ip,
          });
        },
        error: (error: Error & { status?: number }) => {
          const deltaNs = process.hrtime.bigint() - startHr;
          const durationMs = Number(deltaNs) / 1_000_000;
          const durationSeconds = Number(deltaNs) / 1_000_000_000;
          const statusCode = error.status || 500;
          const statusCodeClass = getStatusCodeClass(statusCode);
          const route = normalizeRoutePath(request);
          const projectId = request.project?.id || 'anonymous';

          // Record metrics
          httpRequestsTotal.inc({ method, route, status_code_class: statusCodeClass });
          httpRequestDurationSeconds.observe(durationSeconds, {
            method,
            route,
            status_code_class: statusCodeClass,
          });

          this.logger.warn({
            message: `${method} ${originalUrl} ${statusCode} ${durationMs.toFixed(2)}ms - ${error.message}`,
            method,
            url: originalUrl,
            route,
            statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
            projectId,
            correlationId,
            ip,
            error: error.message,
          });
        },
      }),
    );
  }
}
