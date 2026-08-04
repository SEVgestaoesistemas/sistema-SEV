import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const sessionCookieName = 'sev_session';

export const createSessionToken = () => randomBytes(32).toString('base64url');
export const createCsrfToken = () => randomBytes(32).toString('base64url');
export const hashSessionToken = token => createHash('sha256').update(token).digest('hex');
export const createSessionId = () => randomUUID();

export const cookieOptions = (config, expires) => ({
  httpOnly: true,
  secure: config.environment === 'production' || config.sessionSameSite === 'none',
  sameSite: config.sessionSameSite,
  path: '/api',
  expires
});
