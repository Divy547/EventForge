export interface LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void;
  error(message: unknown, ...optionalParams: unknown[]): void;
  warn(message: unknown, ...optionalParams: unknown[]): void;
  debug?(message: unknown, ...optionalParams: unknown[]): void;
  verbose?(message: unknown, ...optionalParams: unknown[]): void;
}

const SENSITIVE_KEYS_REGEX =
  /^(x[_-]?api[_-]?key|api[_-]?key|key|secret|signing[_-]?secret|authorization|password|token|bearer)$/i;

/**
 * Recursively redacts sensitive keys and values from objects, handling circular references safely.
 */
export function sanitizeLogData(data: unknown, seen = new WeakSet<object>()): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // If a string looks like an authorization header or API key
    if (data.startsWith('Bearer ') || data.startsWith('ef_live_') || data.startsWith('ef_test_')) {
      return '[REDACTED]';
    }
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: data.stack,
    };
  }

  if (data instanceof Date) {
    return data.toISOString();
  }

  if (seen.has(data)) {
    return '[Circular Reference]';
  }
  seen.add(data);

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEYS_REGEX.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeLogData(value, seen);
    }
  }

  return result;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface StructuredLoggerOptions {
  service: string;
  environment?: string | undefined;
  logLevel?: LogLevel | undefined;
}

export interface StructuredLogOutput {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  service: string;
  environment: string;
  context?: string | undefined;
  message: string;
  correlationId?: string | undefined;
  projectId?: string | undefined;
  eventId?: string | undefined;
  deliveryId?: string | undefined;
  subscriptionId?: string | undefined;
  durationMs?: number | undefined;
  statusCode?: number | null | undefined;
  errorCode?: string | null | undefined;
  attemptNumber?: number | undefined;
  maxAttempts?: number | undefined;
  delayMs?: number | undefined;
  error?: unknown;
  [key: string]: unknown;
}

/**
 * Structured JSON Logger implementing NestJS LoggerService.
 * Formats all log entries as deterministic, single-line JSON with standardized fields.
 */
export class StructuredLogger implements LoggerService {
  private readonly service: string;
  private readonly environment: string;
  private readonly minLevelPriority: number;

  constructor(options: StructuredLoggerOptions) {
    this.service = options.service;
    this.environment = options.environment || process.env.NODE_ENV || 'development';
    const level = (
      options.logLevel ||
      (process.env.LOG_LEVEL as LogLevel) ||
      'info'
    ).toLowerCase() as LogLevel;
    this.minLevelPriority = LOG_LEVEL_PRIORITY[level] ?? LOG_LEVEL_PRIORITY.info;
  }

  private shouldLog(level: LogLevel): boolean {
    return (LOG_LEVEL_PRIORITY[level] ?? 0) >= this.minLevelPriority;
  }

  private output(
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
    message: unknown,
    context?: string,
    extra?: Record<string, unknown>,
  ): void {
    const stream = level === 'ERROR' ? process.stderr : process.stdout;

    let textMessage = '';
    let structuredFields: Record<string, unknown> = {};

    if (typeof message === 'string') {
      textMessage = message;
    } else if (typeof message === 'object' && message !== null) {
      const sanitized = sanitizeLogData(message) as Record<string, unknown>;
      if (typeof sanitized.message === 'string') {
        textMessage = sanitized.message;
        const { message: _, ...rest } = sanitized;
        structuredFields = rest;
      } else {
        textMessage = JSON.stringify(sanitized);
      }
    } else {
      textMessage = String(message);
    }

    if (extra) {
      structuredFields = {
        ...structuredFields,
        ...(sanitizeLogData(extra) as Record<string, unknown>),
      };
    }

    const logEntry: StructuredLogOutput = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      environment: this.environment,
      ...(context ? { context } : {}),
      message: textMessage,
      ...structuredFields,
    };

    stream.write(JSON.stringify(logEntry) + '\n');
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    if (!this.shouldLog('info')) return;
    const { context, extra } = this.extractContextAndExtra(optionalParams);
    this.output('INFO', message, context, extra);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    if (!this.shouldLog('error')) return;
    const { context, extra, stack } = this.extractContextAndExtra(optionalParams);
    const combinedExtra = stack ? { ...extra, stack } : extra;
    this.output('ERROR', message, context, combinedExtra);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    if (!this.shouldLog('warn')) return;
    const { context, extra } = this.extractContextAndExtra(optionalParams);
    this.output('WARN', message, context, extra);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    if (!this.shouldLog('debug')) return;
    const { context, extra } = this.extractContextAndExtra(optionalParams);
    this.output('DEBUG', message, context, extra);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    if (!this.shouldLog('debug')) return;
    const { context, extra } = this.extractContextAndExtra(optionalParams);
    this.output('DEBUG', message, context, extra);
  }

  private extractContextAndExtra(params: unknown[]): {
    context?: string | undefined;
    extra?: Record<string, unknown> | undefined;
    stack?: string | undefined;
  } {
    let context: string | undefined;
    let extra: Record<string, unknown> | undefined;
    let stack: string | undefined;

    for (const param of params) {
      if (typeof param === 'string') {
        // If it looks like a stack trace
        if (param.includes('\n    at ') || param.startsWith('Error: ')) {
          stack = param;
        } else if (!context) {
          context = param;
        } else {
          context = `${context}:${param}`;
        }
      } else if (typeof param === 'object' && param !== null) {
        if (param instanceof Error) {
          stack = param.stack;
          extra = { ...(extra ?? {}), error: { name: param.name, message: param.message } };
        } else {
          extra = { ...(extra ?? {}), ...(param as Record<string, unknown>) };
        }
      }
    }

    return { context, extra, stack };
  }
}
