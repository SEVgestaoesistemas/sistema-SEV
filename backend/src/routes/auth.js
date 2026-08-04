import { z } from 'zod';
import { AppError } from '../errors.js';
import { deleteSession, login, registerOrganizationOwner } from '../auth/service.js';
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

const setSessionCookie = (reply, session, config) => {
  reply.setCookie(sessionCookieName, session.token, cookieOptions(config, session.expiresAt));
};

export const registerAuthRoutes = async app => {
  app.post('/register', {
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } }
  }, async (request, reply) => {
    const payload = validate(registrationSchema, request.body);
    const account = await registerOrganizationOwner(app.db, payload, app.config);
    setSessionCookie(reply, account.session, app.config);
    return reply.code(201).send({ user: account.user, csrfToken: account.session.csrfToken });
  });

  app.post('/login', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }
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
      organization: request.auth.organization
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

  app.post('/password/reset', async () => {
    throw new AppError('A recuperação de senha será habilitada após a configuração do serviço de e-mail.', {
      statusCode: 501,
      code: 'NOT_IMPLEMENTED'
    });
  });
};
