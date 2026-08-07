import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { generateApiKey, hashApiKey, hashPayload, stableStringify } from '../src/integrations/service.js';

test('integrações usam limites seguros por empresa e aceitam configuração por ambiente', () => {
  const defaults = loadConfig({ NODE_ENV: 'test' });
  assert.equal(defaults.integrationApiRateLimitMax, 30);
  assert.equal(defaults.integrationApiDailyLimit, 2000);

  const configured = loadConfig({
    NODE_ENV: 'test',
    INTEGRATION_API_RATE_LIMIT_MAX: '45',
    INTEGRATION_API_DAILY_LIMIT: '3500'
  });
  assert.equal(configured.integrationApiRateLimitMax, 45);
  assert.equal(configured.integrationApiDailyLimit, 3500);
});

test('chaves de integração são aleatórias e somente o hash é persistível', () => {
  const first = generateApiKey();
  const second = generateApiKey();

  assert.match(first.secret, /^sev_live_[A-Za-z0-9_-]{32,}$/);
  assert.notEqual(first.secret, second.secret);
  assert.equal(first.hash, hashApiKey(first.secret));
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(first.prefix, first.secret.slice(0, 17));
});

test('hash de payload é estável mesmo quando as propriedades chegam em outra ordem', () => {
  const first = { customer: { id: 'c-1', name: 'Cliente' }, items: [{ id: 'p-1', quantity: 2 }] };
  const second = { items: [{ quantity: 2, id: 'p-1' }], customer: { name: 'Cliente', id: 'c-1' } };

  assert.equal(hashPayload(first), hashPayload(second));
  assert.equal(stableStringify(first), stableStringify(second));
});
