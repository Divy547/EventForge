import { describe, it, expect } from '@jest/globals';
import { isSandboxReceiverUrl, sandboxReceiverUrl } from '@eventforge/common';

const BASE = 'http://api:3000/sandbox/receiver';

describe('isSandboxReceiverUrl', () => {
  it.each(['succeed', 'flaky', 'fail', 'slow'] as const)('accepts the %s receiver', (scenario) => {
    expect(isSandboxReceiverUrl(sandboxReceiverUrl(BASE, scenario), BASE)).toBe(true);
  });

  it('tolerates a trailing slash on the configured base', () => {
    expect(isSandboxReceiverUrl('http://api:3000/sandbox/receiver/succeed', `${BASE}/`)).toBe(true);
  });

  it('is off when no receiver is configured', () => {
    expect(isSandboxReceiverUrl('http://api:3000/sandbox/receiver/succeed', undefined)).toBe(false);
  });

  it.each([
    ['another host', 'http://evil.example/sandbox/receiver/succeed'],
    ['another port', 'http://api:3001/sandbox/receiver/succeed'],
    ['another protocol', 'https://api:3000/sandbox/receiver/succeed'],
    ['another path on the API', 'http://api:3000/v1/events'],
    ['an unknown scenario', 'http://api:3000/sandbox/receiver/admin'],
    ['the bare receiver path', 'http://api:3000/sandbox/receiver'],
    ['a deeper path', 'http://api:3000/sandbox/receiver/succeed/extra'],
    ['a query string', 'http://api:3000/sandbox/receiver/succeed?x=1'],
    ['a fragment', 'http://api:3000/sandbox/receiver/succeed#x'],
    ['credentials', 'http://user:pw@api:3000/sandbox/receiver/succeed'],
    ['dot segments climbing out', 'http://api:3000/sandbox/receiver/../../v1/events'],
    ['encoded dot segments', 'http://api:3000/sandbox/receiver/%2e%2e/%2e%2e/v1/events'],
    ['a look-alike prefix', 'http://api:3000/sandbox/receiver-x/succeed'],
    ['garbage', 'not a url'],
  ])('rejects %s', (_label, url) => {
    expect(isSandboxReceiverUrl(url, BASE)).toBe(false);
  });
});
