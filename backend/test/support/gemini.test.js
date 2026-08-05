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
