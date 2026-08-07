const healthPath = '/api/v1/health';

const requestPathname = request => {
  const rawUrl = request.raw?.url || request.url || '/';
  try {
    return new URL(rawUrl, 'http://sev.internal').pathname;
  } catch {
    return '/';
  }
};

// This bypass deliberately applies to one IP and one read-only endpoint only.
// Its time-bound configuration makes it inactive automatically after the test.
export const shouldBypassHealthRateLimit = (request, key, config, now = Date.now()) => (
  Boolean(config.loadTestHealthAllowedIp)
  && Number.isFinite(config.loadTestHealthBypassExpiresAt)
  && now < config.loadTestHealthBypassExpiresAt
  && request.method === 'GET'
  && requestPathname(request) === healthPath
  && key === config.loadTestHealthAllowedIp
);
