import { describe, it, expect, jest } from '@jest/globals';
import { sanitizeLogData, StructuredLogger } from '@eventforge/common';

describe('StructuredLogger and Sanitization', () => {
  describe('sanitizeLogData', () => {
    it('should redact sensitive keys recursively', () => {
      const input = {
        apiKey: 'ef_live_1234567890abcdef',
        signingSecret: 'sec_abcdef123456',
        authorization: 'Bearer secret_token',
        password: 'super_secret_password',
        token: 'jwt.token.value',
        normalField: 'safe_value',
        nested: {
          x_api_key: 'nested_secret',
          publicId: 'proj-123',
        },
      };

      const sanitized = sanitizeLogData(input) as Record<string, any>;

      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.signingSecret).toBe('[REDACTED]');
      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.normalField).toBe('safe_value');
      expect(sanitized.nested.x_api_key).toBe('[REDACTED]');
      expect(sanitized.nested.publicId).toBe('proj-123');
    });

    it('should redact string tokens that match API key formats', () => {
      expect(sanitizeLogData('ef_live_secret123')).toBe('[REDACTED]');
      expect(sanitizeLogData('Bearer my_secret_token')).toBe('[REDACTED]');
      expect(sanitizeLogData('normal string')).toBe('normal string');
    });

    it('should handle circular references safely', () => {
      const obj: Record<string, unknown> = { name: 'test' };
      obj.self = obj;

      const sanitized = sanitizeLogData(obj) as Record<string, any>;
      expect(sanitized.name).toBe('test');
      expect(sanitized.self).toBe('[Circular Reference]');
    });
  });

  describe('StructuredLogger Output', () => {
    it('should write structured JSON to stdout', () => {
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const logger = new StructuredLogger({
        service: 'eventforge-api',
        environment: 'test',
        logLevel: 'info',
      });

      logger.log('Test message', 'TestContext', { eventId: 'evt-123', apiKey: 'secret-key' });

      expect(stdoutSpy).toHaveBeenCalled();
      const call = stdoutSpy.mock.calls[0];
      expect(call).toBeDefined();
      const output = JSON.parse(call![0] as string);

      expect(output.level).toBe('INFO');
      expect(output.service).toBe('eventforge-api');
      expect(output.environment).toBe('test');
      expect(output.context).toBe('TestContext');
      expect(output.message).toBe('Test message');
      expect(output.eventId).toBe('evt-123');
      expect(output.apiKey).toBe('[REDACTED]');
      expect(output.timestamp).toBeDefined();

      stdoutSpy.mockRestore();
    });

    it('should write errors to stderr with stack', () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const logger = new StructuredLogger({
        service: 'eventforge-worker',
        environment: 'test',
        logLevel: 'debug',
      });

      const err = new Error('Database connection failed');
      logger.error('Failed to connect', err, 'DBContext');

      expect(stderrSpy).toHaveBeenCalled();
      const call = stderrSpy.mock.calls[0];
      expect(call).toBeDefined();
      const output = JSON.parse(call![0] as string);

      expect(output.level).toBe('ERROR');
      expect(output.service).toBe('eventforge-worker');
      expect(output.message).toBe('Failed to connect');
      expect(output.context).toBe('DBContext');
      expect(output.stack).toBeDefined();
      expect(output.error.message).toBe('Database connection failed');

      stderrSpy.mockRestore();
    });
  });
});
