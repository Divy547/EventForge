import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface SsrfValidationResult {
  isValid: boolean;
  reason?: string | undefined;
  resolvedIp?: string | undefined;
}

export interface SsrfValidationOptions {
  allowLocal?: boolean | undefined;
}

export const CLOUD_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.internal',
  'instance-data',
  '100.100.100.200', // Alibaba metadata
]);

/**
 * Checks whether an IPv4 address is within private, loopback, or reserved ranges.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed IP treated as unsafe
  }

  const [b0 = 0, b1 = 0] = parts;

  // 0.0.0.0/8 (Broadcast/Current network)
  if (b0 === 0) return true;

  // 10.0.0.0/8 (Private network)
  if (b0 === 10) return true;

  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;

  // 169.254.0.0/16 (Link-local / Cloud metadata)
  if (b0 === 169 && b1 === 254) return true;

  // 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // 192.168.0.0/16 (Private network)
  if (b0 === 192 && b1 === 168) return true;

  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
  if (b0 >= 224) return true;

  return false;
}

/**
 * Checks whether an IPv6 address is loopback, unique local, link-local, or IPv4-mapped private.
 */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback (::1) and Unspecified (::)
  if (normalized === '::1' || normalized === '::') return true;

  // Unique local addresses (fc00::/7)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // Link-local addresses (fe80::/10)
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (normalized.startsWith('::ffff:')) {
    const ipv4 = normalized.slice(7);
    if (isIP(ipv4) === 4) {
      return isPrivateIPv4(ipv4);
    }
  }

  return false;
}

/**
 * Checks whether an IP address (IPv4 or IPv6) is considered unsafe or private.
 */
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // Not a valid IP
}

/**
 * Validates a target URL against Server-Side Request Forgery (SSRF) threats.
 * Resolves all DNS entries to ensure target host does not point to internal,
 * link-local, or cloud metadata endpoints.
 */
export async function validateDestinationUrl(
  urlString: string,
  options?: SsrfValidationOptions,
): Promise<SsrfValidationResult> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(urlString);
  } catch {
    return { isValid: false, reason: 'Invalid URL format' };
  }

  // Enforce HTTP / HTTPS protocol only
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      isValid: false,
      reason: `Unsupported protocol '${parsedUrl.protocol}'. Only http: and https: are allowed.`,
    };
  }

  // Reject embedded credentials in URL
  if (parsedUrl.username || parsedUrl.password) {
    return { isValid: false, reason: 'Credentials in URL are strictly prohibited' };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Check known cloud metadata hostnames
  if (CLOUD_METADATA_HOSTS.has(hostname) || hostname.endsWith('.internal')) {
    return { isValid: false, reason: 'Destination hostname is blacklisted (cloud metadata)' };
  }

  // Reject localhost or 0.0.0.0 explicitly
  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    if (!options?.allowLocal) {
      return { isValid: false, reason: 'Loopback and localhost destinations are prohibited' };
    }
  }

  // Resolve DNS to verify all destination IP addresses
  try {
    const resolvedAddresses = await lookup(hostname, { all: true });

    if (!resolvedAddresses || resolvedAddresses.length === 0) {
      return { isValid: false, reason: 'Failed to resolve destination hostname' };
    }

    for (const entry of resolvedAddresses) {
      const { address, family } = entry;

      if (options?.allowLocal) {
        continue;
      }

      if (family === 4 && isPrivateIPv4(address)) {
        return {
          isValid: false,
          reason: `Destination resolves to prohibited private or loopback IPv4 address: ${address}`,
          resolvedIp: address,
        };
      }

      if (family === 6 && isPrivateIPv6(address)) {
        return {
          isValid: false,
          reason: `Destination resolves to prohibited private or loopback IPv6 address: ${address}`,
          resolvedIp: address,
        };
      }
    }

    return {
      isValid: true,
      resolvedIp: resolvedAddresses[0]?.address,
    };
  } catch (error) {
    return {
      isValid: false,
      reason: `DNS lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
