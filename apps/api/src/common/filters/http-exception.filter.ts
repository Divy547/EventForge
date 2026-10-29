import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '@eventforge/common';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  timestamp: string;
  errors?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail = 'An unexpected error occurred while processing the request.';
    let code = 'INTERNAL_SERVER_ERROR';
    let errorDetails: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        detail = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        detail = (resObj['message'] as string) || exception.message;
        errorDetails = Array.isArray(resObj['message']) ? resObj['message'] : undefined;
        if (Array.isArray(resObj['message'])) {
          detail = 'One or more validation constraints failed.';
        }
      }

      title = this.getStatusTitle(status);
      code = this.getStatusCode(status);
    } else if (exception instanceof DomainError) {
      status = exception.statusCode;
      title = this.getStatusTitle(status);
      detail = exception.message;
      code = exception.code;
      errorDetails = exception.details;
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled Exception: ${exception.message}`, exception.stack);
      detail = process.env.NODE_ENV === 'development' ? exception.message : detail;
    }

    const problem: ProblemDetails = {
      type: `https://api.eventforge.dev/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title,
      status,
      detail,
      instance: request.originalUrl || request.url,
      code,
      timestamp: new Date().toISOString(),
    };

    if (errorDetails) {
      problem.errors = errorDetails;
    }

    response.status(status).json(problem);
  }

  private getStatusTitle(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Bad Request';
      case HttpStatus.UNAUTHORIZED:
        return 'Unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'Forbidden';
      case HttpStatus.NOT_FOUND:
        return 'Not Found';
      case HttpStatus.CONFLICT:
        return 'Conflict';
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return 'Payload Too Large';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'Unprocessable Entity';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'Service Unavailable';
      default:
        return 'Error';
    }
  }

  private getStatusCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'AUTHENTICATION_REQUIRED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return 'PAYLOAD_TOO_LARGE';
      default:
        return 'INTERNAL_SERVER_ERROR';
    }
  }
}
