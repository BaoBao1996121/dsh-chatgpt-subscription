import { Agent, ProxyAgent, fetch as explicitFetch, Request as ExplicitRequest } from 'undici';

export function validateNetwork(value) {
  if (!value || !['direct', 'clash'].includes(value.mode)) throw new Error('请选择直连或 Clash。');
  const url = new URL(value.proxyUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Clash 地址须是本机 HTTP 代理，例如 http://127.0.0.1:21158。');
  }
  return { mode: value.mode, proxyUrl: url.origin };
}

export function isOpenAiRequest(input) {
  try {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    return url.protocol === 'https:' && ['auth.openai.com', 'chatgpt.com'].includes(url.hostname);
  } catch { return false; }
}

// Explicit dispatchers override Node's environment proxy; OS/TUN routing still applies.
export function installOpenAiNetwork(readConfig, target = globalThis, send = explicitFetch) {
  const previous = target.fetch;
  const direct = new Agent({ connect: { timeout: 15000 } });
  const proxies = new Map();
  let disposed = false;
  const fetch = function(input, init) {
    if (disposed || !isOpenAiRequest(input)) return previous.call(target, input, init);
    const config = validateNetwork(readConfig());
    let dispatcher = direct;
    if (config.mode === 'clash') {
      if (!proxies.has(config.proxyUrl)) proxies.set(config.proxyUrl, new ProxyAgent({ uri: config.proxyUrl, connect: { timeout: 15000 } }));
      dispatcher = proxies.get(config.proxyUrl);
    }
    // Use fetch from the same Undici version as its dispatcher. Electron's
    // built-in fetch can carry a different dispatcher handler protocol.
    const request = input instanceof globalThis.Request && !(input instanceof ExplicitRequest)
      ? new ExplicitRequest(input.url, { method: input.method, headers: input.headers,
          body: input.body, signal: input.signal, redirect: input.redirect, duplex: 'half' })
      : input;
    return send(request, { ...init, dispatcher });
  };
  target.fetch = fetch;
  return async () => {
    disposed = true;
    if (target.fetch === fetch) target.fetch = previous;
    await Promise.allSettled([direct.close(), ...[...proxies.values()].map(agent => agent.close())]);
  };
}
