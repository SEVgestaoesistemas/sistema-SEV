const headerNames = {
  ip: 'x-sev-client-ip',
  timestamp: 'x-sev-client-ip-timestamp',
  signature: 'x-sev-client-ip-signature'
};

const signaturePayload = ({ timestamp, ip, method, pathname }) => (
  `sev-worker-ip-v1\n${timestamp}\n${ip}\n${method.toUpperCase()}\n${pathname}`
);

const toHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

const sign = async (secret, payload) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
};

export default {
  async fetch(request, env) {
    if (!env.ORIGIN_URL || !env.WORKER_IP_SIGNATURE_SECRET) {
      return new Response('Configuração do proxy indisponível.', { status: 503 });
    }

    // When Pseudo IPv4 overwrites CF-Connecting-IP, Cloudflare preserves the
    // true IPv6 address in CF-Connecting-IPv6. Prefer it when available.
    const visitorIp = request.headers.get('CF-Connecting-IPv6')
      || request.headers.get('CF-Connecting-IP');
    if (!visitorIp) {
      return new Response('Não foi possível identificar o IP de origem.', { status: 503 });
    }

    const incomingUrl = new URL(request.url);
    const originUrl = new URL(env.ORIGIN_URL);
    originUrl.pathname = incomingUrl.pathname;
    originUrl.search = incomingUrl.search;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers = new Headers(request.headers);
    headers.delete(headerNames.ip);
    headers.delete(headerNames.timestamp);
    headers.delete(headerNames.signature);
    headers.set(headerNames.ip, visitorIp);
    headers.set(headerNames.timestamp, timestamp);
    headers.set(headerNames.signature, await sign(env.WORKER_IP_SIGNATURE_SECRET, signaturePayload({
      timestamp,
      ip: visitorIp,
      method: request.method,
      pathname: incomingUrl.pathname
    })));

    const init = { method: request.method, headers, redirect: 'manual' };
    if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
    return fetch(originUrl.toString(), init);
  }
};
