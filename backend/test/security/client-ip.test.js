import test from 'node:test';
import assert from 'node:assert/strict';
import { getClientIp, isCloudflareProxyIp, isTrustedCloudflareRequest, isTrustedInfrastructureProxyIp } from '../../src/security/client-ip.js';

const request = ({ remoteAddress, ip, headers = {} }) => ({
  raw: { socket: { remoteAddress } },
  headers,
  ip
});

test('usa CF-Connecting-IP quando a conexão vem de uma faixa oficial da Cloudflare', () => {
  const incoming = request({
    remoteAddress: '173.245.48.12',
    ip: '198.51.100.24',
    headers: { 'cf-connecting-ip': '198.51.100.24' }
  });

  assert.equal(isCloudflareProxyIp('173.245.48.12'), true);
  assert.equal(isTrustedCloudflareRequest(incoming), true);
  assert.equal(getClientIp(incoming), '198.51.100.24');
});

test('aceita CF-Connecting-IP pela cadeia Render privada quando o salto anterior pertence à Cloudflare', () => {
  const incoming = request({
    remoteAddress: '10.12.0.8',
    ip: '104.23.209.49',
    headers: {
      'x-forwarded-for': '198.51.100.24, 104.23.209.49',
      'cf-connecting-ip': '198.51.100.24'
    }
  });

  assert.equal(isTrustedCloudflareRequest(incoming), true);
  assert.equal(getClientIp(incoming), '198.51.100.24');
});

test('aceita CF-Connecting-IP pela cadeia Render em loopback quando o salto anterior pertence à Cloudflare', () => {
  const incoming = request({
    remoteAddress: '127.0.0.1',
    ip: '104.23.209.49',
    headers: {
      'x-forwarded-for': '198.51.100.24, 104.23.209.49',
      'cf-connecting-ip': '198.51.100.24'
    }
  });

  assert.equal(isTrustedCloudflareRequest(incoming), true);
  assert.equal(getClientIp(incoming), '198.51.100.24');
});

test('ignora CF-Connecting-IP forjado em uma conexão que não veio da Cloudflare', () => {
  const incoming = request({
    remoteAddress: '198.51.100.77',
    ip: '198.51.100.77',
    headers: {
      'x-forwarded-for': '173.245.48.12',
      'cf-connecting-ip': '203.0.113.99'
    }
  });

  assert.equal(isTrustedCloudflareRequest(incoming), false);
  assert.equal(getClientIp(incoming), '198.51.100.77');
});

test('ignora o spoofing no Render quando o salto anterior não pertence à Cloudflare', () => {
  const incoming = request({
    remoteAddress: '10.12.0.8',
    ip: '198.51.100.77',
    headers: {
      'x-forwarded-for': '203.0.113.99, 198.51.100.77',
      'cf-connecting-ip': '203.0.113.99'
    }
  });

  assert.equal(isTrustedCloudflareRequest(incoming), false);
  assert.equal(getClientIp(incoming), '198.51.100.77');
});

test('ignora header forjado no loopback quando o salto anterior não é da Cloudflare', () => {
  const incoming = request({
    remoteAddress: '127.0.0.1',
    ip: '198.51.100.77',
    headers: {
      'x-forwarded-for': '203.0.113.99, 198.51.100.77',
      'cf-connecting-ip': '203.0.113.99'
    }
  });

  assert.equal(isTrustedCloudflareRequest(incoming), false);
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
