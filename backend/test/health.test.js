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
  assert.equal(limited.json().error.code, 'RATE_LIMITED');
  assert.match(limited.json().error.message, /Muitas tentativas/);
  await app.close();
});

test('aceita CF-Connecting-IP apenas após um salto Cloudflare confiável', async () => {
  const app = await buildApp({ config: { ...config, trustProxy: true }, db: database, logger: false });
  app.get('/test/client-ip', { config: { rateLimit: false } }, async request => ({
    requestIp: request.ip,
    clientIp: request.clientIp
  }));
  const response = await app.inject({
    method: 'GET',
    url: '/test/client-ip',
    remoteAddress: '127.0.0.1',
    headers: {
      'x-forwarded-for': '203.0.113.99, 104.23.209.49',
      'cf-connecting-ip': '203.0.113.99'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    requestIp: '104.23.209.49',
    clientIp: '203.0.113.99'
  });
  await app.close();
});

test('recuperação pública orienta o cliente ao fluxo manual e expõe somente o contato configurado', async () => {
  const app = await buildApp({
    config: { ...config, adminWhatsAppNumber: '5581997498046' },
    db: database,
    logger: false
  });
  const contact = await app.inject({ method: 'GET', url: '/api/v1/public/support-contact' });
  assert.equal(contact.statusCode, 200);
  assert.deepEqual(contact.json(), { whatsappNumber: '5581997498046' });

  const reset = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/password/reset',
    payload: { email: 'cliente@sev.test' }
  });
  assert.equal(reset.statusCode, 410);
  assert.equal(reset.json().error.code, 'MANUAL_PASSWORD_RESET_REQUIRED');
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

test('falhas de recuperação manual e do servidor retornam mensagens claras sem detalhes internos', async () => {
  const app = await buildApp({ config, db: database, logger: false });
  app.get('/test/unexpected-error', async () => { throw new Error('database credential must not leak'); });

  const manualReset = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/password/reset',
    payload: { email: 'cliente@sev.test' }
  });
  assert.equal(manualReset.statusCode, 410);
  assert.equal(manualReset.json().error.code, 'MANUAL_PASSWORD_RESET_REQUIRED');
  assert.match(manualReset.json().error.message, /suporte/);

  const unexpected = await app.inject({ method: 'GET', url: '/test/unexpected-error' });
  assert.equal(unexpected.statusCode, 500);
  assert.equal(unexpected.json().error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(unexpected.json().error.message, /credential/i);
  await app.close();
});

test('ações de empresa exigem uma sessão de administrador da plataforma', async () => {
  const app = await buildApp({ config, db: database, logger: false });
  const routes = [
    { method: 'PATCH', url: '/api/v1/platform/companies/00000000-0000-0000-0000-000000000000/suspension', payload: { suspended: true } },
    { method: 'POST', url: '/api/v1/platform/companies/00000000-0000-0000-0000-000000000000/temporary-password' },
    { method: 'GET', url: '/api/v1/platform/companies/00000000-0000-0000-0000-000000000000/users' },
    { method: 'POST', url: '/api/v1/platform/companies/00000000-0000-0000-0000-000000000000/users/00000000-0000-0000-0000-000000000001/temporary-password' },
    { method: 'DELETE', url: '/api/v1/platform/companies/00000000-0000-0000-0000-000000000000', payload: { confirmationName: 'Teste' } }
  ];
  for (const route of routes) {
    const response = await app.inject(route);
    assert.equal(response.statusCode, 401);
  }
  await app.close();
});
