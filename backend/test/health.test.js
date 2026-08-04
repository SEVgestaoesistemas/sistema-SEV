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
