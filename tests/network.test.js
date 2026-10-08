import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installOpenAiNetwork, isOpenAiRequest, validateNetwork } from '../network.js';

test('OpenAI route uses explicit mode; other providers keep their original request', async () => {
  let config = { mode: 'clash', proxyUrl: 'http://127.0.0.1:21158' };
  const calls = [];
  const original = async (input, init) => { calls.push({ input, init }); return 'ok'; };
  const target = { fetch: original };
  const dispose = installOpenAiNetwork(() => config, target, original);
  try {
    await target.fetch('https://chatgpt.com/backend-api/codex/responses');
    assert.equal(calls.at(-1).init.dispatcher.constructor.name, 'ProxyAgent');
    config = { ...config, mode: 'direct' };
    await target.fetch('https://auth.openai.com/oauth/token');
    assert.equal(calls.at(-1).init.dispatcher.constructor.name, 'Agent');
    const unchanged = { headers: { 'x-example': 'test' } };
    await target.fetch('https://example.com/model', unchanged);
    assert.equal(calls.at(-1).init, unchanged);
    await target.fetch(new Request('https://auth.openai.com/oauth/token', { method: 'POST', body: 'example' }));
    assert.equal(calls.at(-1).input.url, 'https://auth.openai.com/oauth/token');
    assert.equal(calls.at(-1).input.method, 'POST');
  } finally { await dispose(); }
  assert.equal(target.fetch, original);
});

test('domain and local-proxy boundaries reject unrelated destinations', () => {
  assert.equal(isOpenAiRequest('https://chatgpt.com'), true);
  for (const input of ['http://chatgpt.com', 'https://chatgpt.com.example.org', 'https://api.example.org', 'invalid']) {
    assert.equal(isOpenAiRequest(input), false);
  }
  assert.throws(() => validateNetwork({ mode: 'clash', proxyUrl: 'http://example.org:7897' }));
  assert.throws(() => validateNetwork({ mode: 'other', proxyUrl: 'http://127.0.0.1:7897' }));
  assert.throws(() => validateNetwork({ mode: 'clash', proxyUrl: 'http://user:password@127.0.0.1:7897' }));
});

test('proxy failure is returned and does not silently fall back to direct', async () => {
  const target = { fetch: async () => 'original' };
  let attempts = 0;
  const dispose = installOpenAiNetwork(() => ({ mode: 'clash', proxyUrl: 'http://127.0.0.1:21158' }), target, async () => {
    attempts++; throw new Error('proxy unavailable');
  });
  try { await assert.rejects(target.fetch('https://chatgpt.com'), /proxy unavailable/); assert.equal(attempts, 1); }
  finally { await dispose(); }
});
