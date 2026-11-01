import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import {
  extractTraceContext,
  createChildTraceparent,
  W3C_TRACEPARENT_HEADER,
  W3C_TRACESTATE_HEADER,
} from '@eventforge/common';

declare module 'express' {
  interface Request {
    correlationId?: string;
    traceparent?: string;
    tracestate?: string;
  }
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const rawHeader = req.headers['x-request-id'] || req.headers['x-correlation-id'];
    const correlationId =
      typeof rawHeader === 'string' && rawHeader.trim().length > 0
        ? rawHeader.trim()
        : randomUUID();

    req.correlationId = correlationId;
    res.setHeader('X-Request-Id', correlationId);

    // Extract or initialize W3C trace context
    const traceCtx = extractTraceContext(
      req.headers as Record<string, string | string[] | undefined>,
    );
    const traceparent = traceCtx.traceparent || createChildTraceparent(null);

    req.traceparent = traceparent;
    res.setHeader(W3C_TRACEPARENT_HEADER, traceparent);

    if (traceCtx.tracestate) {
      req.tracestate = traceCtx.tracestate;
      res.setHeader(W3C_TRACESTATE_HEADER, traceCtx.tracestate);
    }

    next();
  }
}
