import { z } from 'zod';
import { AppError } from '../errors.js';
import {
  changePassword,
  deleteSession,
  login,
  registerOrganizationOwner
} from '../auth/service.js';
import { requireAuth, requireCsrf } from '../auth/middleware.js';
import { cookieOptions, createCsrfToken, hashSessionToken, sessionCookieName } from '../security/session.js';
import { acceptInvitation } from '../team/service.js';
import { emailSchema, passwordSchema, validate } from './validation.js';

const registrationSchema = z.object({
  organizationName: z.string().trim().min(2).max(100),
  name: z.string().trim().min(3).max(100),
  email: emailSchema,
  password: passwordSchema
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128)
});

const acceptInvitationSchema = z.object({
  token: z.string().min(40).max(128),
  name: z.string().trim().min(3).max(100),
  password: passwordSchema
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema
});

const manualPasswordResetRequired = () => new AppError(
  'Para redefinir a senha, fale com o suporte da SEV. A administração enviará uma senha temporária por um canal seguro.',
  { statusCode: 410, code: 'MANUAL_PASSWORD_RESET_REQUIRED' }
);

const setSessionCookie = (reply, session, config) => {
  reply.setCookie(sessionCookieName, session.token, cookieOptions(config, session.expiresAt));
};

export const registerAuthRoutes = async app => {
  app.post('/register', {
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } }
  }, async (request, reply) => {
    if (!app.config.publicRegistrationEnabled) {
      throw new AppError('O cadastro de empresas é feito pela administração da plataforma.', {
        statusCode: 403,
        code: 'REGISTRATION_DISABLED'
      });
    }
    const payload = validate(registrationSchema, request.body);
    const account = await registerOrganizationOwner(app.db, payload, app.config);
    setSessionCookie(reply, account.session, app.config);
    return reply.code(201).send({ user: account.user, csrfToken: account.session.csrfToken });
  });

  app.post('/login', {
    config: {
      rateLimit: {
        max: app.config.loginRateLimitMax,
        timeWindow: app.config.loginRateLimitWindow
      }
    }
  }, async (request, reply) => {
    const payload = validate(loginSchema, request.body);
    const account = await login(app.db, payload, app.config);
    setSessionCookie(reply, account.session, app.config);
    return { user: account.user, csrfToken: account.session.csrfToken };
  });

  app.post('/invitations/accept', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }
  }, async (request, reply) => {
    const payload = validate(acceptInvitationSchema, request.body);
    const account = await acceptInvitation(app.db, payload, app.config);
    setSessionCookie(reply, account.session, app.config);
    return reply.code(201).send({ user: account.user, csrfToken: account.session.csrfToken });
  });

  app.get('/me', { preHandler: [requireAuth] }, async request => ({
    user: {
      id: request.auth.id,
      name: request.auth.name,
      email: request.auth.email,
      organization: request.auth.organization,
      passwordChangeRequired: request.auth.passwordChangeRequired,
      planExpired: request.auth.planExpired,
      companySuspended: request.auth.companySuspended,
      isPlatformAdmin: request.auth.isPlatformAdmin
    }
  }));

  app.post('/csrf', { preHandler: [requireAuth] }, async request => {
    const csrfToken = createCsrfToken();
    await app.db.query('UPDATE sessions SET csrf_token_hash = $1 WHERE id = $2', [
      hashSessionToken(csrfToken),
      request.auth.sessionId
    ]);
    return { csrfToken };
  });

  app.post('/logout', { preHandler: [requireAuth, requireCsrf] }, async (request, reply) => {
    await deleteSession(app.db, request.auth.sessionId);
    reply.clearCookie(sessionCookieName, cookieOptions(app.config));
    return reply.code(204).send();
  });

  app.post('/password/change', { preHandler: [requireAuth, requireCsrf] }, async request => {
    const payload = validate(changePasswordSchema, request.body);
    await changePassword(app.db, {
      userId: request.auth.id,
      sessionId: request.auth.sessionId,
      organizationId: request.auth.organization.id,
      currentPassword: payload.currentPassword,
      newPassword: payload.newPassword
    });
    return { updated: true };
  });

  app.post('/password/reset', {
    config: { rateLimit: { max: 3, timeWindow: '15 minutes' } }
  }, async () => {
    throw manualPasswordResetRequired();
  });

  app.post('/password/reset/confirm', {
    config: { rateLimit: { max: 3, timeWindow: '15 minutes' } }
  }, async () => {
    throw manualPasswordResetRequired();
  });
};
