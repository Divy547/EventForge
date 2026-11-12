/**
 * Sandbox mode: a public demo where a visitor sends test events to a built-in receiver that
 * succeeds, fails a few times, always fails, or never answers in time.
 *
 * The receiver lives inside the API at `<SANDBOX_RECEIVER_URL>/<scenario>`. That address is
 * usually private (e.g. `http://api:3000` on the Docker network), which the SSRF protection
 * would normally refuse, so the worker is allowed to reach exactly the URLs that
 * `isSandboxReceiverUrl` accepts and nothing else.
 */

/** Slug of the one project the sandbox runs in. */
export const SANDBOX_PROJECT_SLUG = 'sandbox';

/** How long a key minted for a sandbox visitor stays valid. */
export const SANDBOX_KEY_TTL_MS = 60 * 60 * 1000;

/** The flaky receiver answers 503 this many times per delivery, then 200. */
export const SANDBOX_FLAKY_FAILURES = 2;

/**
 * The slow receiver holds the connection until the caller gives up, for at most this long. Any
 * webhook timeout below this makes every attempt time out.
 */
export const SANDBOX_SLOW_MAX_HOLD_MS = 60_000;

export const SANDBOX_SCENARIOS = ['succeed', 'flaky', 'fail', 'slow'] as const;
export type SandboxScenario = (typeof SANDBOX_SCENARIOS)[number];

export interface SandboxScenarioInfo {
  id: SandboxScenario;
  label: string;
  description: string;
  /** Event type sent for this scenario; its subscription listens for exactly this type. */
  eventType: string;
  /** Name of the subscription created for this scenario in the sandbox project. */
  subscriptionName: string;
}

export const SANDBOX_SCENARIO_INFO: Record<SandboxScenario, SandboxScenarioInfo> = {
  succeed: {
    id: 'succeed',
    label: 'Always succeeds',
    description: 'The receiver answers 200 straight away.',
    eventType: 'sandbox.succeed',
    subscriptionName: 'Sandbox: always succeeds',
  },
  flaky: {
    id: 'flaky',
    label: `Fails ${SANDBOX_FLAKY_FAILURES} times, then succeeds`,
    description: `The receiver answers 503 for the first ${SANDBOX_FLAKY_FAILURES} attempts; the retries get through.`,
    eventType: 'sandbox.flaky',
    subscriptionName: 'Sandbox: flaky',
  },
  fail: {
    id: 'fail',
    label: 'Always fails',
    description:
      'The receiver answers 500 every time, so the delivery ends in the dead-letter queue.',
    eventType: 'sandbox.fail',
    subscriptionName: 'Sandbox: always fails',
  },
  slow: {
    id: 'slow',
    label: 'Too slow',
    description: 'The receiver takes longer than the delivery timeout, so every attempt times out.',
    eventType: 'sandbox.slow',
    subscriptionName: 'Sandbox: too slow',
  },
};

export function isSandboxScenario(value: unknown): value is SandboxScenario {
  return typeof value === 'string' && (SANDBOX_SCENARIOS as readonly string[]).includes(value);
}

/** The delivery URL of a scenario under the configured receiver base. */
export function sandboxReceiverUrl(receiverBase: string, scenario: SandboxScenario): string {
  return `${receiverBase.replace(/\/+$/, '')}/${scenario}`;
}

/**
 * True only for `<receiverBase>/<scenario>` with a known scenario: same protocol, host and port as
 * the base, no credentials, query or fragment. URLs are compared after WHATWG parsing, so
 * `..` and `%2e%2e` segments are already resolved and cannot climb out of the receiver path.
 */
export function isSandboxReceiverUrl(targetUrl: string, receiverBase: string | undefined): boolean {
  if (!receiverBase) return false;
  let target: URL;
  let base: URL;
  try {
    target = new URL(targetUrl);
    base = new URL(receiverBase);
  } catch {
    return false;
  }
  if (target.username || target.password || target.search || target.hash) return false;
  if (target.protocol !== base.protocol || target.host !== base.host) return false;
  const prefix = `${base.pathname.replace(/\/+$/, '')}/`;
  if (!target.pathname.startsWith(prefix)) return false;
  return isSandboxScenario(target.pathname.slice(prefix.length));
}
