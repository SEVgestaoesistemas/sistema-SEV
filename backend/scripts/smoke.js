import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/database.js';

if (process.env.ALLOW_DATABASE_SMOKE !== 'true') {
  throw new Error('Defina ALLOW_DATABASE_SMOKE=true para executar o teste de banco controlado.');
}

const config = loadConfig();
const db = createDatabase(config);
const suffix = randomUUID().slice(0, 10);
const password = 'TesteSeguro2026';
let organizationId;
let userId;
let app;

const request = (method, url, options = {}) => app.inject({ method, url, ...options });

try {
  app = await buildApp({ config, db, logger: false });
  const registration = await request('POST', '/api/v1/auth/register', {
    payload: {
      organizationName: `Validação SEV ${suffix}`,
      name: 'Usuário de Validação',
      email: `validation-${suffix}@example.invalid`,
      password
    }
  });
  assert.equal(registration.statusCode, 201);
  const account = registration.json();
  userId = account.user.id;
  organizationId = account.user.organization.id;
  const cookie = registration.headers['set-cookie'].split(';')[0];
  const csrfHeaders = { cookie, 'x-csrf-token': account.csrfToken };

  const me = await request('GET', '/api/v1/auth/me', { headers: { cookie } });
  assert.equal(me.statusCode, 200);

  const profile = await request('PATCH', '/api/v1/profile', {
    headers: csrfHeaders,
    payload: { name: 'Usuário SEV Validado' }
  });
  assert.equal(profile.statusCode, 200);

  const settings = await request('PATCH', '/api/v1/settings', {
    headers: csrfHeaders,
    payload: { companyShortName: 'VALIDAÇÃO', criticalStockAlerts: false }
  });
  assert.equal(settings.statusCode, 200);

  const invitation = await request('POST', '/api/v1/team/invitations', {
    headers: csrfHeaders,
    payload: { name: 'Integrante Convidado', email: `invite-${suffix}@example.invalid`, role: 'finance' }
  });
  assert.equal(invitation.statusCode, 201);

  const product = await request('POST', '/api/v1/products', {
    headers: csrfHeaders,
    payload: { name: 'Produto de validação', sku: `TEST-${suffix}`, quantity: 3, minimumQuantity: 3 }
  });
  assert.equal(product.statusCode, 201);

  const expense = await request('POST', '/api/v1/expenses', {
    headers: csrfHeaders,
    payload: {
      supplierName: 'Fornecedor de validação',
      supplierCnpj: '12345678000190',
      documentNumber: `TEST-${suffix}`,
      issueDate: '2026-08-04',
      dueDate: '2026-08-15',
      category: 'Operacional',
      description: 'Despesa criada pelo teste controlado',
      amountCents: 284750
    }
  });
  assert.equal(expense.statusCode, 201);

  const products = await request('GET', '/api/v1/products', { headers: { cookie } });
  const expenses = await request('GET', '/api/v1/expenses', { headers: { cookie } });
  const team = await request('GET', '/api/v1/team', { headers: { cookie } });
  const notifications = await request('GET', '/api/v1/notifications', { headers: { cookie } });
  assert.equal(products.statusCode, 200);
  assert.equal(expenses.statusCode, 200);
  assert.equal(team.statusCode, 200);
  assert.equal(notifications.statusCode, 200);
  assert.equal(products.json().products.length, 1);
  assert.equal(expenses.json().expenses.length, 1);
  assert.equal(team.json().members.length, 2);
  assert.equal(notifications.json().notifications.length, 1);
  const readAll = await request('POST', '/api/v1/notifications/read-all', { headers: csrfHeaders });
  assert.equal(readAll.statusCode, 200);
  console.log('Teste controlado concluído: autenticação, perfil, configurações, equipe, estoque, despesas e notificações funcionaram.');
} finally {
  if (organizationId) await db.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
  if (userId) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  if (app) await app.close();
  else await db.close();
}
