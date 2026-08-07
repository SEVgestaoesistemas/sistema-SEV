import { createHmac } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkerIpSignaturePayload, getClientIp, getSignedWorkerClientIp, isTrustedInfrastructureProxyIp } from '../../src/security/client-ip.js';

const workerSecret = 'worker-secret-for-tests-with-at-least-32-characters';

const request = ({ remoteAddress, ip, headers = {}, method = 'PUT', url = '/api/v1/integrations/v1/products/item' }) => ({
  raw: { socket: { remoteAddress }, url },
  headers,
  ip,
  method,
  url
});

const signedHeaders = ({ timestamp, ip, method = 'PUT', pathname = '/api/v1/integrations/v1/products/item' }) => ({
  'x-sev-client-ip': ip,
  'x-sev-client-ip-timestamp': String(timestamp),
  'x-sev-client-ip-signature': createHmac('sha256', workerSecret)
    .update(buildWorkerIpSignaturePayload({ timestamp: String(timestamp), ip, method, pathname }))
    .digest('hex')
});

test('usa o IP real assinado pelo Worker como fonte de verdade', () => {
  const timestamp = 1_785_730_000;
  const visitorIp = '2804:7f7:df00:bafc:c5e6:2c71:bd77:1d1a';
  const incoming = request({
    remoteAddress: '127.0.0.1',
    ip: '104.23.209.49',
    headers: signedHeaders({ timestamp, ip: visitorIp })
  });

  assert.equal(getSignedWorkerClientIp(incoming, workerSecret, timestamp * 1000), visitorIp);
  assert.equal(getClientIp(incoming, workerSecret, timestamp * 1000), visitorIp);
});

test('ignora assinatura forjada ou reutilizada para outro método ou caminho', () => {
  const timestamp = 1_785_730_000;
  const incoming = request({
    remoteAddress: '127.0.0.1',
    ip: '104.23.209.49',
    method: 'PATCH',
    headers: signedHeaders({ timestamp, ip: '203.0.113.99', method: 'PUT' })
  });

  assert.equal(getSignedWorkerClientIp(incoming, workerSecret, timestamp * 1000), null);
  assert.equal(getClientIp(incoming, workerSecret, timestamp * 1000), '104.23.209.49');
});

test('ignora assinatura expirada e mantém o fallback seguro', () => {
  const timestamp = 1_785_730_000;
  const incoming = request({
    remoteAddress: '127.0.0.1',
    ip: '104.23.209.49',
    headers: signedHeaders({ timestamp, ip: '203.0.113.99' })
  });

  assert.equal(getSignedWorkerClientIp(incoming, workerSecret, (timestamp * 1000) + 60_001), null);
});

test('ignora cabeçalhos de Worker sem segredo configurado', () => {
  const timestamp = 1_785_730_000;
  const incoming = request({
    remoteAddress: '198.51.100.77',
    ip: '198.51.100.77',
    headers: signedHeaders({ timestamp, ip: '203.0.113.99' })
  });

  assert.equal(getSignedWorkerClientIp(incoming, undefined, timestamp * 1000), null);
  assert.equal(getClientIp(incoming), '198.51.100.77');
});

test('mantém o IP do socket como fallback no desenvolvimento local', () => {
  const incoming = request({ remoteAddress: '127.0.0.1' });

  assert.equal(getClientIp(incoming), '127.0.0.1');
});

test('reconhece somente faixas internas como proxy de infraestrutura confiável', () => {
  assert.equal(isTrustedInfrastructureProxyIp('10.235.25.235'), true);
  assert.equal(isTrustedInfrastructureProxyIp('127.0.0.1'), true);
  assert.equal(isTrustedInfrastructureProxyIp('198.51.100.77'), false);
});
