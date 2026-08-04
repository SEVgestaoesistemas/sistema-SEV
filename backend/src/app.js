import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AppError } from './errors.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/database.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerProductRoutes } from './routes/products.js';
import { registerExpenseRoutes } from './routes/expenses.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerTeamRoutes } from './routes/team.js';
import { registerNotificationRoutes } from './routes/notifications.js';

export const buildApp = async (options = {}) => {
  const config = options.config || loadConfig();
  const db = options.db || createDatabase(config);
  const app = Fastify({
    logger: options.logger ?? config.environment !== 'test',
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorateRequest('auth', null);

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origem não permitida.'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token']
  });
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    ban: 2,
    keyGenerator: request => request.ip
  });

  app.get('/', async () => ({ service: 'sev-backend', version: 'v1' }));
  await app.register(registerHealthRoutes, { prefix: '/api/v1' });
  await app.register(registerAuthRoutes, { prefix: '/api/v1/auth' });
  await app.register(registerProductRoutes, { prefix: '/api/v1' });
  await app.register(registerExpenseRoutes, { prefix: '/api/v1' });
  await app.register(registerProfileRoutes, { prefix: '/api/v1' });
  await app.register(registerSettingsRoutes, { prefix: '/api/v1' });
  await app.register(registerTeamRoutes, { prefix: '/api/v1' });
  await app.register(registerNotificationRoutes, { prefix: '/api/v1' });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' }
  }));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error.code === '23505') {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Já existe um registro com estes dados.' } });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: { code: 'BAD_REQUEST', message: 'Não foi possível processar a solicitação.' } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro interno.' } });
  });

  app.addHook('onClose', async () => {
    await db.close();
  });

  return app;
};
