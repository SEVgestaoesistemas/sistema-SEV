import { BlockList, isIP } from 'node:net';

// Source: https://www.cloudflare.com/ips (reviewed on 2026-08-07).
// Keep this list aligned with Cloudflare's published IPv4 and IPv6 ranges.
const cloudflareCidrs = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32'
];

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

const blockListFromCidrs = cidrs => {
  const blockList = new BlockList();
  for (const cidr of cidrs) {
    const [address, prefixLength] = cidr.split('/');
    blockList.addSubnet(address, Number(prefixLength), isIP(address) === 4 ? 'ipv4' : 'ipv6');
  }
  return blockList;
};

const cloudflareProxyRanges = blockListFromCidrs(cloudflareCidrs);
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

export const isCloudflareProxyIp = value => isInRanges(cloudflareProxyRanges, value);

export const isTrustedInfrastructureProxyIp = value => (
  isInRanges(privateProxyRanges, value) || isInRanges(loopbackProxyRanges, value)
);

// In Render, Fastify's request.ip is derived by trusting only the immediate
// internal proxy (configured in app.js), so it stops at the first public address
// and does not blindly trust earlier X-Forwarded-For entries. CF-Connecting-IP
// is accepted only when it agrees with that independently resolved address.
export const isTrustedCloudflareRequest = request => {
  const directPeer = socketIp(request);
  if (isCloudflareProxyIp(directPeer)) return true;
  const forwardedIp = normalizeIp(request.ip);
  const cloudflareClientIp = normalizeIp(headerValue(request, 'cf-connecting-ip'));
  return isTrustedInfrastructureProxyIp(directPeer)
    && Boolean(forwardedIp)
    && cloudflareClientIp === forwardedIp;
};

export const getClientIp = request => {
  const cloudflareClientIp = normalizeIp(headerValue(request, 'cf-connecting-ip'));
  if (cloudflareClientIp && isTrustedCloudflareRequest(request)) return cloudflareClientIp;

  return normalizeIp(request.ip) || socketIp(request) || 'unknown';
};
