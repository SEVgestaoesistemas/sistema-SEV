import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';
import { findSession, hashCsrfToken } from './service.js';
import { sessionCookieName } from '../security/session.js';
import { authenticateApiKey } from '../integrations/service.js';

export const requireAuth = async request => {
  const session = await findSession(request.server.db, request.cookies[sessionCookieName]);
  if (!session) {
    throw new AppError('Sessão inválida ou expirada.', { statusCode: 401, code: 'UNAUTHENTICATED' });
  }
  request.auth = session;
  request.tenantDb = request.server.db.forTenant({
    organizationId: session.organization.id,
    userId: session.id
  });
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

export const requireAccountAccess = async request => {
  if (request.auth.passwordChangeRequired) {
    throw new AppError('Troque sua senha temporária antes de acessar o sistema.', {
      statusCode: 403,
      code: 'PASSWORD_CHANGE_REQUIRED'
    });
  }
  if (request.auth.companySuspended) {
    throw new AppError('O acesso desta empresa está suspenso. Entre em contato com a SEV para regularizar.', {
      statusCode: 403,
      code: 'COMPANY_SUSPENDED'
    });
  }
  if (request.auth.planExpired) {
    throw new AppError('O plano desta empresa expirou. Entre em contato com a SEV para regularizar o acesso.', {
      statusCode: 403,
      code: 'PLAN_EXPIRED'
    });
  }
};

export const requirePlatformAdmin = async request => {
  if (!request.auth.isPlatformAdmin) {
    throw new AppError('Este recurso é exclusivo da administração da plataforma.', {
      statusCode: 403,
      code: 'PLATFORM_ADMIN_REQUIRED'
    });
  }
};

export const requireApiKey = async request => {
  const key = await authenticateApiKey(request.server.db, request.headers.authorization);
  request.apiAuth = key;
  request.tenantDb = request.server.db.forTenant({
    organizationId: key.organizationId,
    userId: null
  });
};

export const requireApiScope = scope => async request => {
  if (!request.apiAuth?.scopes?.includes(scope)) {
    throw new AppError('Esta chave nao possui o escopo necessario para esta operacao.', {
      statusCode: 403,
      code: 'API_SCOPE_FORBIDDEN',
      details: [{ path: 'scope', message: `Escopo necessario: ${scope}.` }]
    });
  }
};
