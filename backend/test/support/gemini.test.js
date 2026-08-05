import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiChat } from '../../src/support/gemini.js';

test('Gemini recebe somente a pergunta e a chave fica no cabeçalho do backend', async () => {
  let call;
  const fakeFetch = async (url, options) => {
    call = { url, options };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        inScope: true,
        needsHuman: false,
        answer: 'Acesse Estoque e selecione cadastrar produto.'
      }) }] } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const chat = createGeminiChat({
    geminiApiKey: 'gemini-secret-never-in-browser',
    geminiModel: 'gemini-2.5-flash-lite'
  }, fakeFetch);

  const answer = await chat('Como cadastro um produto?');

  assert.deepEqual(answer, {
    inScope: true,
    needsHuman: false,
    answer: 'Acesse Estoque e selecione cadastrar produto.'
  });
  assert.match(call.url, /models\/gemini-2\.5-flash-lite:generateContent$/);
  assert.equal(call.url.includes('gemini-secret-never-in-browser'), false);
  assert.equal(call.options.headers['x-goog-api-key'], 'gemini-secret-never-in-browser');
  const payload = JSON.parse(call.options.body);
  assert.equal(payload.contents[0].parts[0].text, 'Como cadastro um produto?');
  assert.equal(payload.contents[0].parts[0].text.includes('organization_id'), false);
});

test('chat sem chave não faz chamada externa', async () => {
  const chat = createGeminiChat({ geminiApiKey: undefined, geminiModel: 'gemini-2.5-flash-lite' }, async () => {
    throw new Error('não deve chamar o provedor');
  });

  await assert.rejects(chat('Como acesso Vendas?'), error => error.code === 'SUPPORT_NOT_CONFIGURED');
});

test('erro de autenticação do Gemini é identificado sem registrar a chave ou a pergunta', async () => {
  const logs = [];
  const chat = createGeminiChat({
    geminiApiKey: 'AQ.private-auth-key',
    geminiModel: 'gemini-2.5-flash-lite'
  }, {
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        status: 'UNAUTHENTICATED',
        details: [{
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED'
        }]
      }
    }), { status: 401, headers: { 'content-type': 'application/json' } }),
    wait: async () => {}
  });

  await assert.rejects(
    chat('Como cadastro um produto?', { warn: fields => logs.push(fields) }),
    error => error.code === 'SUPPORT_PROVIDER_AUTH_REJECTED'
  );
  assert.deepEqual(logs, [{
    geminiFailure: 'http',
    geminiHttpStatus: 401,
    geminiAttempt: 1,
    providerStatus: 'UNAUTHENTICATED',
    providerReason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED'
  }]);
});

test('uma falha transitória do Gemini é repetida uma vez antes de responder', async () => {
  let calls = 0;
  const chat = createGeminiChat({
    geminiApiKey: 'AQ.private-auth-key',
    geminiModel: 'gemini-2.5-flash-lite'
  }, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 });
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ inScope: true, needsHuman: false, answer: 'Use Estoque.' }) }] } }]
      }), { status: 200 });
    },
    wait: async () => {}
  });

  assert.equal((await chat('Como cadastro um produto?')).answer, 'Use Estoque.');
  assert.equal(calls, 2);
});
