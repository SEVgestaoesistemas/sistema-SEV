import { createHmac, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

const privateProxyCidrs = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  'fc00::/7'
];

const loopbackProxyCidrs = [
  '127.0.0.0/8',
  '::1/128'
];

const workerHeaderNames = {
  ip: 'x-sev-client-ip',
  timestamp: 'x-sev-client-ip-timestamp',
  signature: 'x-sev-client-ip-signature'
};

const workerSignatureMaxAgeMs = 60 * 1000;

const blockListFromCidrs = cidrs => {
  const blockList = new BlockList();
  for (const cidr of cidrs) {
    const [address, prefixLength] = cidr.split('/');
    blockList.addSubnet(address, Number(prefixLength), isIP(address) === 4 ? 'ipv4' : 'ipv6');
  }
  return blockList;
};

const privateProxyRanges = blockListFromCidrs(privateProxyCidrs);
const loopbackProxyRanges = blockListFromCidrs(loopbackProxyCidrs);

const normalizeIp = value => {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate) return null;
  const ip = candidate.toLowerCase().startsWith('::ffff:') ? candidate.slice(7) : candidate;
  return isIP(ip) ? ip : null;
};

const isInRanges = (ranges, value) => {
  const ip = normalizeIp(value);
  if (!ip) return false;
  return ranges.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
};

const headerValue = (request, name) => {
  const value = request.headers?.[name];
  return typeof value === 'string' ? value.trim() : null;
};

const socketIp = request => normalizeIp(request.raw?.socket?.remoteAddress);

const requestPathname = request => {
  const rawUrl = request.raw?.url || request.url || '/';
  try {
    return new URL(rawUrl, 'http://sev.internal').pathname;
  } catch {
    return '/';
  }
};

const safeSignatureEquals = (expected, received) => {
  if (!/^[a-f0-9]{64}$/i.test(received || '')) return false;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(received, 'hex');
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const isTrustedInfrastructureProxyIp = value => (
  isInRanges(privateProxyRanges, value) || isInRanges(loopbackProxyRanges, value)
);

export const buildWorkerIpSignaturePayload = ({ timestamp, ip, method, pathname }) => (
  `sev-worker-ip-v1\n${timestamp}\n${ip}\n${method.toUpperCase()}\n${pathname}`
);

export const getSignedWorkerClientIp = (request, workerIpSignatureSecret, now = Date.now()) => {
  if (!workerIpSignatureSecret) return null;

  const ip = normalizeIp(headerValue(request, workerHeaderNames.ip));
  const timestamp = Number(headerValue(request, workerHeaderNames.timestamp));
  const signature = headerValue(request, workerHeaderNames.signature);
  if (!ip || !Number.isSafeInteger(timestamp) || !signature) return null;

  const timestampMs = timestamp * 1000;
  if (Math.abs(now - timestampMs) > workerSignatureMaxAgeMs) return null;

  const payload = buildWorkerIpSignaturePayload({
    timestamp,
    ip,
    method: request.method || 'GET',
    pathname: requestPathname(request)
  });
  const expectedSignature = createHmac('sha256', workerIpSignatureSecret).update(payload).digest('hex');
  return safeSignatureEquals(expectedSignature, signature) ? ip : null;
};

// A valid HMAC from the Worker is the only trusted source of the visitor IP.
// This does not rely on Cloudflare/Render forwarding CF-Connecting-IP and a
// caller that reaches the public Render hostname cannot forge the value.
export const getClientIp = (request, workerIpSignatureSecret, now) => (
  getSignedWorkerClientIp(request, workerIpSignatureSecret, now)
  || normalizeIp(request.ip)
  || socketIp(request)
  || 'unknown'
);
