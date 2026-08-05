import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('limite de login usa padrão seguro quando variáveis não são informadas', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  assert.equal(config.loginRateLimitMax, 5);
  assert.equal(config.loginRateLimitWindow, '15 minutes');
});

test('limite de login aceita configuração temporária por ambiente', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOGIN_RATE_LIMIT_MAX: '20',
    LOGIN_RATE_LIMIT_WINDOW: '15 minutes'
  });

  assert.equal(config.loginRateLimitMax, 20);
  assert.equal(config.loginRateLimitWindow, '15 minutes');
});
