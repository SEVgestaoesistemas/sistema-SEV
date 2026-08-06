import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTemporaryPassword, login } from '../../src/auth/service.js';
import { requireAccountAccess } from '../../src/auth/middleware.js';
import { listCompanies } from '../../src/platform/service.js';
import { hashPassword } from '../../src/security/password.js';

test('senhas temporárias têm tamanho e composição suficientes para o primeiro acesso', () => {
  for (let index = 0; index < 30; index += 1) {
    const password = generateTemporaryPassword();
    assert.equal(password.length, 16);
    assert.match(password, /[a-z]/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[!@#$%*\-_]/);
  }
});

test('login recusa senha temporária expirada antes de criar uma sessão', async () => {
  const passwordHash = await hashPassword('TemporaryPassword2026!');
  const database = {
    query: async () => ({
      rows: [{
        user_id: '00000000-0000-0000-0000-000000000001',
        user_name: 'Cliente Teste',
        email: 'cliente@teste.invalid',
        password_hash: passwordHash,
        force_password_change: true,
        temporary_password_expired: true,
        organization_id: '00000000-0000-0000-0000-000000000002',
        organization_name: 'Empresa Teste',
        role: 'operator',
        plan_expired: false,
        is_suspended: false,
        is_platform_admin: false
      }]
    }),
    transaction: async () => { throw new Error('Nenhuma sessão deve ser criada.'); }
  };
  await assert.rejects(
    login(database, { email: 'cliente@teste.invalid', password: 'TemporaryPassword2026!' }, { sessionTtlDays: 7 }),
    error => error.code === 'TEMPORARY_PASSWORD_EXPIRED' && error.statusCode === 403
  );
});

test('acesso operacional é recusado até a troca obrigatória de senha e após expiração do plano', async () => {
  await assert.rejects(
    requireAccountAccess({ auth: { passwordChangeRequired: true, planExpired: false } }),
    error => error.code === 'PASSWORD_CHANGE_REQUIRED' && error.statusCode === 403
  );
  await assert.rejects(
    requireAccountAccess({ auth: { passwordChangeRequired: false, planExpired: true } }),
    error => error.code === 'PLAN_EXPIRED' && error.statusCode === 403
  );
  await assert.rejects(
    requireAccountAccess({ auth: { passwordChangeRequired: false, companySuspended: true, planExpired: false } }),
    error => error.code === 'COMPANY_SUSPENDED' && error.statusCode === 403
  );
  await requireAccountAccess({ auth: { passwordChangeRequired: false, planExpired: false } });
});

test('lista de empresas preserva datas retornadas pelo PostgreSQL como objetos Date', async () => {
  const database = {
    query: async () => ({
      rowCount: 1,
      rows: [{
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Empresa Teste',
        createdAt: new Date('2026-08-05T03:00:00.000Z'),
        planExpiresAt: new Date('2026-09-04T03:00:00.000Z'),
        planStatus: 'active',
        isSuspended: false,
        suspendedAt: null,
        containsPlatformAdmin: false,
        administratorId: '00000000-0000-0000-0000-000000000002',
        administratorName: 'Responsável Teste',
        administratorEmail: 'responsavel@teste.com'
      }]
    })
  };

  const [company] = await listCompanies(database);
  assert.equal(company.planExpiresAt, '2026-09-04');
});
