import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTemporaryPassword } from '../../src/auth/service.js';
import { requireAccountAccess } from '../../src/auth/middleware.js';

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
