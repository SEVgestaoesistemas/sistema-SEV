import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';
import { findSession, hashCsrfToken } from './service.js';
import { sessionCookieName } from '../security/session.js';

export const requireAuth = async request => {
  const session = await findSession(request.server.db, request.cookies[sessionCookieName]);
  if (!session) {
    throw new AppError('Sessão inválida ou expirada.', { statusCode: 401, code: 'UNAUTHENTICATED' });
  }
  request.auth = session;
};

export const requireCsrf = async request => {
  const providedToken = request.headers['x-csrf-token'];
  if (typeof providedToken !== 'string') {
    throw new AppError('Confirmação de segurança ausente.', { statusCode: 403, code: 'CSRF_REJECTED' });
  }
  const expectedHash = Buffer.from(request.auth.csrfTokenHash, 'utf8');
  const receivedHash = Buffer.from(hashCsrfToken(providedToken), 'utf8');
  if (expectedHash.length !== receivedHash.length || !timingSafeEqual(expectedHash, receivedHash)) {
    throw new AppError('Confirmação de segurança inválida.', { statusCode: 403, code: 'CSRF_REJECTED' });
  }
};

export const requireRoles = roles => async request => {
  if (!roles.includes(request.auth.organization.role)) {
    throw new AppError('Você não tem permissão para esta ação.', { statusCode: 403, code: 'FORBIDDEN' });
  }
};
