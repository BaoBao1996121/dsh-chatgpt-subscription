import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import * as plugin from '../index.js';

test('real Cordis mount exposes only projected login state and sanitizes failures', async () => {
  const originalFetch = globalThis.fetch;
  const ctx = new Context();
  let handler;
  ctx.reflect.provide('credentials', { describeRecord: async () => ({ configured: true, kind: 'grant', privateField: 'test-placeholder-never-return' }) });
  ctx.reflect.provide('llm', { listModels: async () => [{ id: 'gpt-6-sol', name: 'GPT-6 Sol' }] });
  ctx.reflect.provide('configEditor', { entries: () => [], edit: async () => {} });
  const routes = new Map();
  ctx.reflect.provide('connection', { fetch: { register(route) { routes.set(route.path, route); } } });
  handler = async (endpoint, payload) => {
    const method = 'chatgpt-subscription.' + endpoint;
    const response = await routes.get('/api/' + method).fetch(new Request('http://localhost/api/' + method, {
      method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'test-request', method, payload }),
    }));
    return (await response.json()).result;
  };
  ctx.reflect.provide('webServer', {});
  const fiber = ctx.plugin(plugin, { mode: 'clash', proxyUrl: 'http://127.0.0.1:21158' });
  await fiber;
  try {
    const status = await handler('status', {});
    assert.equal(status.ok, true);
    assert.equal(status.value.configured, true);
    assert.equal(JSON.stringify(status).includes('test-placeholder-never-return'), false);
    assert.equal((await handler('settings', { mode: 'clash', proxyUrl: 'http://external.example:1234' })).ok, false);
    assert.equal((await handler('login', {})).ok, false);
  } finally { await fiber.dispose(); }
  assert.equal(globalThis.fetch, originalFetch);
});

test('configuration preparation waits for app readiness and preserves other providers', async () => {
  const ctx = new Context();
  let ready;
  let saved;
  const entry = { options: { id: 'llm-pi-ai' } };
  const raw = { providers: { example: { baseURL: 'https://example.org' }, 'openai-codex': {} } };
  ctx.reflect.provide('appReady', { onReady(callback) { ready = callback; return () => {}; } });
  ctx.reflect.provide('credentials', { describeRecord: async () => ({ configured: true, kind: 'grant' }) });
  ctx.reflect.provide('llm', { listModels: async () => [] });
  ctx.reflect.provide('configEditor', { entries: () => [entry], edit: async (actual, update) => { assert.equal(actual, entry); saved = update(raw); } });
  ctx.reflect.provide('connection', { fetch: { register() {} } });
  ctx.reflect.provide('webServer', {});
  const fiber = ctx.plugin(plugin, { mode: 'direct', proxyUrl: 'http://127.0.0.1:21158' });
  await fiber;
  try {
    assert.equal(saved, undefined);
    ready();
    await Promise.resolve();
    assert.deepEqual(saved.providers.example, raw.providers.example);
    assert.equal(saved.providers['openai-codex'].transport, 'sse');
    assert.equal(saved.providers['openai-codex'].models.some(model => model.id === 'gpt-6.1-sol'), true);
  } finally { await fiber.dispose(); }
});
