import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const config = {
  environment: 'test',
  port: 3333,
  host: '127.0.0.1',
  allowedOrigins: ['http://127.0.0.1:5500'],
  sessionTtlDays: 7,
  sessionSameSite: 'lax',
  loginRateLimitMax: 5,
  loginRateLimitWindow: '15 minutes',
  publicRegistrationEnabled: false,
  platformBootstrapToken: undefined,
  trustProxy: false,
  databaseUrl: undefined,
  databaseSsl: false,
  databaseSslCaFile: undefined,
  databaseSslCa: undefined
};

const database = {
  available: false,
  query: async () => { throw new Error('Banco não deve ser chamado neste teste.'); },
  transaction: async () => { throw new Error('Banco não deve ser chamado neste teste.'); },
  close: async () => {}
};

test('endpoint de saúde informa que a API está ativa', async () => {
  const app = await buildApp({ config, db: database, logger: false });
  const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: 'ok',
    service: 'sev-backend',
    database: 'not-configured'
  });
  await app.close();
});

test('login respeita o limite configurado por ambiente', async () => {
  const app = await buildApp({
    config: { ...config, loginRateLimitMax: 2, loginRateLimitWindow: '15 minutes' },
    db: database,
    logger: false
  });
  const request = () => app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} });

  assert.equal((await request()).statusCode, 400);
  assert.equal((await request()).statusCode, 400);
  const limited = await request();
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['x-ratelimit-limit'], '2');
  await app.close();
});

test('cadastro público é rejeitado quando a plataforma está em modo por assinatura', async () => {
  const app = await buildApp({ config, db: database, logger: false });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { organizationName: 'Empresa Teste', name: 'Usuário Teste', email: 'teste@sev.com', password: 'SenhaSegura2026' }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'REGISTRATION_DISABLED');
  await app.close();
});

test('ações de empresa exigem uma sessão de administrador da plataforma', async () => {
  const app = await buildApp({ config, db: database, logger: false });
  const routes = [
    { method: 'PATCH', url: '/api/v1/platform/companies/00000000-0000-0000-0000-000000000000/suspension', payload: { suspended: true } },
    { method: 'POST', url: '/api/v1/platform/companies/00000000-0000-0000-0000-000000000000/temporary-password' },
    { method: 'DELETE', url: '/api/v1/platform/companies/00000000-0000-0000-0000-000000000000', payload: { confirmationName: 'Teste' } }
  ];
  for (const route of routes) {
    const response = await app.inject(route);
    assert.equal(response.statusCode, 401);
  }
  await app.close();
});
