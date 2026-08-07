import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldBypassHealthRateLimit } from '../../src/security/load-test-bypass.js';

const activeConfig = {
  loadTestHealthAllowedIp: '179.187.246.60',
  loadTestHealthBypassExpiresAt: Date.parse('2026-08-08T03:00:00.000Z')
};

const request = ({ method = 'GET', url = '/api/v1/health' } = {}) => ({
  method,
  raw: { url }
});

test('libera apenas o IP de teste no health enquanto a exceção estiver ativa', () => {
  assert.equal(
    shouldBypassHealthRateLimit(request(), '179.187.246.60', activeConfig, Date.parse('2026-08-08T02:00:00.000Z')),
    true
  );
});

test('não libera outro IP, rota, método ou exceção expirada', () => {
  const now = Date.parse('2026-08-08T02:00:00.000Z');
  assert.equal(shouldBypassHealthRateLimit(request(), '179.187.246.61', activeConfig, now), false);
  assert.equal(shouldBypassHealthRateLimit(request({ url: '/api/v1/auth/login' }), '179.187.246.60', activeConfig, now), false);
  assert.equal(shouldBypassHealthRateLimit(request({ method: 'POST' }), '179.187.246.60', activeConfig, now), false);
  assert.equal(
    shouldBypassHealthRateLimit(request(), '179.187.246.60', activeConfig, Date.parse('2026-08-08T03:00:00.000Z')),
    false
  );
});
