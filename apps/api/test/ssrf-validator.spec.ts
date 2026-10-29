import { describe, it, expect } from '@jest/globals';
import { validateDestinationUrl } from '../src/common/utils/ssrf-validator.js';

describe('SSRF Protection Validator', () => {
  it('should reject non-HTTP protocols', async () => {
    const res1 = await validateDestinationUrl('ftp://example.com/webhook');
    expect(res1.isValid).toBe(false);
    expect(res1.reason).toContain('Unsupported protocol');

    const res2 = await validateDestinationUrl('file:///etc/passwd');
    expect(res2.isValid).toBe(false);
  });

  it('should reject embedded credentials in URL', async () => {
    const res = await validateDestinationUrl('https://admin:secret@example.com/webhook');
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('Credentials in URL are strictly prohibited');
  });

  it('should reject loopback addresses (127.0.0.1, localhost)', async () => {
    const res1 = await validateDestinationUrl('http://127.0.0.1:8080/hook');
    expect(res1.isValid).toBe(false);

    const res2 = await validateDestinationUrl('http://localhost:3000/hook');
    expect(res2.isValid).toBe(false);
  });

  it('should reject AWS / Cloud metadata service (169.254.169.254)', async () => {
    const res = await validateDestinationUrl('http://169.254.169.254/latest/meta-data');
    expect(res.isValid).toBe(false);
    expect(res.reason).toBeDefined();
  });

  it('should reject private network IP ranges (RFC 1918)', async () => {
    const res10 = await validateDestinationUrl('http://10.0.1.5/webhook');
    expect(res10.isValid).toBe(false);

    const res172 = await validateDestinationUrl('http://172.20.0.1/webhook');
    expect(res172.isValid).toBe(false);

    const res192 = await validateDestinationUrl('http://192.168.1.100/webhook');
    expect(res192.isValid).toBe(false);
  });

  it('should reject 0.0.0.0 and broadcast addresses', async () => {
    const res = await validateDestinationUrl('http://0.0.0.0:8000');
    expect(res.isValid).toBe(false);
  });

  it('should allow local destinations when explicitly permitted for testing', async () => {
    const res = await validateDestinationUrl('http://127.0.0.1:4000/webhook', {
      allowLocal: true,
    });
    expect(res.isValid).toBe(true);
  });
});
