import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../../src/security/password.js';

test('senha é armazenada com hash e aceita apenas a senha correta', async () => {
  const password = 'SenhaSegura2026';
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('SenhaIncorreta2026', hash), false);
});

test('hash malformado nunca autentica', async () => {
  assert.equal(await verifyPassword('SenhaSegura2026', 'invalido'), false);
});
