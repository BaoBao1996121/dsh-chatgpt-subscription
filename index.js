import z from '@deepseek-ai/schemastery';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { installOpenAiNetwork, validateNetwork } from './network.js';

export const name = 'chatgpt-subscription';
export const inject = ['credentials', 'llm', 'configEditor'];
export const Config = z.object({
  mode: z.union([z.const('direct'), z.const('clash')]).default('clash').volatile(),
  proxyUrl: z.string().default('http://127.0.0.1:21158').volatile(),
});
const KEY = 'llm-pi-ai/openai-codex';
const ENDPOINTS = ['status', 'login', 'cancel', 'settings', 'select-model'];

export function browserCommand(url, network, home = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'auth.openai.com') throw new Error('登录地址不是 OpenAI 官方认证地址。');
  if (process.platform !== 'win32') throw new Error('此版本的浏览器登录入口面向 Windows。');
  const candidates = [
    join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  const command = candidates.find(existsSync);
  if (!command) throw new Error('未找到 Chrome 或 Edge，无法按所选代理方式打开登录。');
  return {
    command,
    args: [
      '--user-data-dir=' + join(home, 'chatgpt-login-browser', network.mode),
      network.mode === 'clash' ? '--proxy-server=' + network.proxyUrl : '--no-proxy-server',
      '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
      '--no-first-run', '--no-default-browser-check', '--new-window', parsed.href,
    ],
  };
}

export function apply(ctx, config) {
  const read = () => ({ mode: config.mode.get(), proxyUrl: config.proxyUrl.get() });
  validateNetwork(read());
  // Keep the native adapter and its refresh/replay/tool translation. Its fetch path
  // honors our explicit dispatchers; its separate WebSocket transport does not.
  let preparation;
  const prepare = () => preparation ||= (async () => {
    const entry = ctx.configEditor.entries().find(row => row.options.id === 'llm-pi-ai');
    if (!entry) return;
    await ctx.configEditor.edit(entry, raw => {
    const providers = raw.providers || {};
    const profile = providers['openai-codex'] || {};
    if (profile.transport === 'sse' && profile.models?.some(model => model.id === 'gpt-6.1-sol')) return raw;
    const models = profile.models || [
      'gpt-5.3-codex-spark', 'gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol',
      'gpt-5.6-terra', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol',
    ].map(id => ({ id }));
    return { ...raw, providers: { ...providers, 'openai-codex': {
      ...profile, transport: 'sse', models: models.some(model => model.id === 'gpt-6.1-sol') ? models : [
        ...models, { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', input: ['text'], reasoningEfforts: { low: 'low' } },
      ],
    } } };
    });
  })().catch(error => { preparation = undefined; throw error; });
  ctx.effect(() => installOpenAiNetwork(read), 'ChatGPT subscription: OpenAI-only network routing');
  ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)));
  let login;
  let loginState = 'idle';
  let message = '';
  // A profile edit can wait for Loader settlement. Run it after appReady rather
  // than await it during apply, which would make settlement wait for itself.
  ctx.effect(() => ctx.get('appReady')?.onReady(() => {
    void prepare().catch(() => { message = '模型配置尚未就绪，请点击刷新状态重试。'; });
  }), 'ChatGPT subscription: configure native adapter after boot');

  const status = async () => {
    await prepare();
    const info = await ctx.credentials.describeRecord(KEY);
    const models = await ctx.llm.listModels('openai-codex');
    const selection = ctx.get('agentDefaultModel')?.currentSelection();
    return {
      configured: info.configured && info.kind === 'grant',
      loginState, message, ...read(),
      models: models.map(model => ({ id: model.id, name: model.name })),
      model: selection?.provider === 'openai-codex' ? selection.model : null,
    };
  };

  const startLogin = () => {
    if (login) return;
    const authorization = ctx.get('authorization');
    if (!authorization?.describe(KEY)) throw new Error('DSH 未加载 OpenAI 原生登录服务。');
    // Freeze the browser and token-exchange network mode for this login attempt.
    const network = validateNetwork(read());
    const controller = new AbortController();
    login = controller;
    loginState = 'pending';
    message = '请在浏览器中完成 ChatGPT 登录。';
    const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    void authorization.begin({
      key: KEY, method: 'oauth', signal: controller.signal,
      interaction: {
        notify(notice) {
          if (!notice.url) return;
          const launch = browserCommand(notice.url, network);
          const child = spawn(launch.command, launch.args, { detached: true, stdio: 'ignore', windowsHide: true });
          child.on('error', () => controller.abort());
          child.unref();
        },
        prompt(prompt) {
          if (prompt.type === 'select') return Promise.resolve('browser');
          return new Promise((_, reject) => {
            const signal = prompt.signal || controller.signal;
            const abort = () => reject(new Error('Login prompt withdrawn'));
            if (signal.aborted) abort();
            else signal.addEventListener('abort', abort, { once: true });
          });
        },
      },
    }).then(outcome => {
      loginState = outcome.status === 'authorized' ? 'success' : 'cancelled';
      message = outcome.status === 'authorized' ? '登录已保存，可使用 ChatGPT 订阅模型。' : '登录已取消或超时，可以重试。';
    }, () => {
      loginState = 'failed';
      message = '登录失败。请检查网络方式和 Clash，再重新登录。';
    }).finally(() => { clearTimeout(timer); login = undefined; });
  };

  ctx.effect(() => () => login?.abort(), 'ChatGPT subscription: cancel pending login on unload');
  const dispatch = async (endpoint, payload) => {
      try {
        if (endpoint === 'status') return { ok: true, value: await status() };
        if (endpoint === 'login') startLogin();
        else if (endpoint === 'cancel') login?.abort();
        else if (endpoint === 'settings') {
          if (login) throw new Error('请先完成或取消登录，再更改网络方式。');
          const next = validateNetwork(payload);
          await ctx.configEditor.edit(ctx.fiber.entry, () => next);
        } else if (endpoint === 'select-model') {
          await prepare();
          const models = await ctx.llm.listModels('openai-codex');
          if (!models.some(model => model.id === payload?.model)) throw new Error('请选择目录中可用的模型。');
          const defaults = ctx.get('agentDefaultModel');
          if (!defaults) throw new Error('DSH 未加载主 Agent 的默认模型设置。');
          await defaults.saveSelection({ provider: 'openai-codex', model: payload.model, reasoningEffort: 'low' });
        } else throw new Error('未知操作。');
        return { ok: true, value: await status() };
      } catch (error) {
        // Never serialize OAuth error payloads or the credential record.
        const safeMessage = ['settings', 'select-model', 'login'].includes(endpoint) &&
          /^(请选择|Clash 地址|请先|DSH 未|未找到|此版本|登录地址)/.test(error.message || '')
          ? error.message : '操作失败，请检查 DSH 配置或网络后重试。';
        return { ok: false, error: { code: 'chatgpt/operation-failed', message: safeMessage, details: {} } };
      }
  };
  // This release's generic rpc.handle reads webServer from a Context that did
  // not inject it. Exact routes use the existing authenticated /api carrier.
  ctx.inject(['connection'], connected => {
    for (const endpoint of ENDPOINTS) connected.connection.fetch.register({
      path: '/api/chatgpt-subscription.' + endpoint, methods: ['POST'],
      async fetch(request) {
        const message = await request.json();
        if (message.type !== 'client-request' || typeof message.rpcId !== 'string' ||
            message.method !== 'chatgpt-subscription.' + endpoint) return new Response('invalid request', { status: 400 });
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result: await dispatch(endpoint, message.payload) });
      },
    });
  });
}
