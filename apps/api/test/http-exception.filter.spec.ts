import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { ConflictError, NotFoundError } from '@eventforge/common';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockRequest = {
      originalUrl: '/v1/events',
      url: '/v1/events',
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };
  });

  it('should format HttpException into RFC 7807 Problem Details', () => {
    const exception = new BadRequestException('Validation failed');
    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'https://api.eventforge.dev/errors/validation-error',
        title: 'Bad Request',
        status: 400,
        detail: 'Validation failed',
        instance: '/v1/events',
        code: 'VALIDATION_ERROR',
      }),
    );
  });

  it('should format DomainError (ConflictError) into RFC 7807 response', () => {
    const exception = new ConflictError('Idempotency collision');
    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'https://api.eventforge.dev/errors/conflict',
        title: 'Conflict',
        status: 409,
        detail: 'Idempotency collision',
        code: 'CONFLICT',
      }),
    );
  });

  it('should format NotFoundError into 404 RFC 7807 response', () => {
    const exception = new NotFoundError('Event', 'evt-123');
    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'https://api.eventforge.dev/errors/not-found',
        title: 'Not Found',
        status: 404,
        code: 'NOT_FOUND',
      }),
    );
  });
});
