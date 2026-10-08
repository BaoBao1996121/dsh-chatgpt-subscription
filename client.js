window.__ModuleLoader__.load({
  id: 'dsh-chatgpt-subscription',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    const inject = ['slots', 'connection'];
    function Section({ call }) {
      const [state, setState] = React.useState(null);
      const [mode, setMode] = React.useState('clash');
      const [proxyUrl, setProxy] = React.useState('http://127.0.0.1:21158');
      const [model, setModel] = React.useState('gpt-6-sol');
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const mounted = React.useRef(false);
      const sync = async (endpoint, payload) => {
        try {
          const next = await call(endpoint, payload);
          if (mounted.current) { setState(next); setError(''); }
          return next;
        } catch (e) { if (mounted.current) setError(e.message); }
      };
      React.useEffect(() => {
        mounted.current = true;
        sync('status').then(next => { if (next && mounted.current) {
          setMode(next.mode); setProxy(next.proxyUrl); setModel(next.model || 'gpt-6-sol');
        } });
        return () => { mounted.current = false; };
      }, []);
      React.useEffect(() => {
        if (state?.loginState !== 'pending') return;
        const timer = setInterval(() => sync('status'), 1500);
        return () => clearInterval(timer);
      }, [state?.loginState]);
      const act = async (endpoint, payload) => { setBusy(true); await sync(endpoint, payload); if (mounted.current) setBusy(false); };
      const button = (label, endpoint, payload, disabled = false) => h('button', { type: 'button', disabled: busy || disabled,
        style: { padding: '8px 14px', border: '1px solid var(--dsw-alias-border-l3, #aaa)', borderRadius: 8, cursor: 'pointer', background: 'var(--dsw-alias-bg-layer-1, white)', color: 'inherit' },
        onClick: () => act(endpoint, payload) }, label);
      const fieldStyle = { width: '100%', padding: 8, margin: '6px 0 12px', borderRadius: 6, border: '1px solid #aaa', background: 'var(--dsw-alias-bg-layer-1, white)', color: 'inherit', boxSizing: 'border-box' };
      return h('section', { style: { maxWidth: 620, lineHeight: 1.7, color: 'var(--dsw-alias-label-primary)' } },
        h('h3', { style: { marginTop: 0 } }, 'ChatGPT 订阅'),
        h('p', null, '使用 ChatGPT 订阅驱动 DSH 主 Agent。登录凭据由 DSH 原生凭据服务保存。'),
        h('p', { role: 'status' }, state ? (state.configured ? '● 已保存 OpenAI 登录' : '○ 尚未登录 OpenAI') : '读取登录状态…'),
        h('div', { style: { display: 'flex', gap: 8 } },
          button(state?.configured ? '重新登录 OpenAI' : '登录 OpenAI', 'login', {}, state?.loginState === 'pending'),
          state?.loginState === 'pending' ? button('取消登录', 'cancel', {}) : button('刷新状态', 'status', {})),
        state?.message && h('p', { role: 'status' }, state.message),
        h('hr', { style: { margin: '22px 0', opacity: 0.2 } }),
        h('label', null, 'OpenAI 连接方式', h('select', { value: mode, style: fieldStyle, disabled: state?.loginState === 'pending', onChange: e => setMode(e.target.value) },
          h('option', { value: 'direct' }, '直连（不使用应用代理）'), h('option', { value: 'clash' }, '使用 Clash 本地代理'))),
        mode === 'clash' && h('label', null, 'Clash HTTP / Mixed 端口', h('input', { value: proxyUrl, style: fieldStyle, onChange: e => setProxy(e.target.value) })),
        h('p', { style: { fontSize: 12, opacity: 0.75 } }, mode === 'clash' ? '登录浏览器和模型请求都会连接这个代理。最终出口由 Clash 的规则决定；Clash 未运行时请求会失败。' : '应用会忽略系统/环境 HTTP 代理。Clash 的 TUN 或其他系统 VPN 仍可能接管流量。'),
        button('保存连接方式', 'settings', { mode, proxyUrl }, state?.loginState === 'pending'),
        h('hr', { style: { margin: '22px 0', opacity: 0.2 } }),
        h('label', null, '主 Agent 模型', h('select', { value: model, style: fieldStyle, onChange: e => setModel(e.target.value) },
          ...(state?.models || []).map(item => h('option', { key: item.id, value: item.id }, item.name || item.id)))),
        button('设为主 Agent 默认模型', 'select-model', { model }, !state?.configured),
        h('p', { style: { fontSize: 12, opacity: 0.75 } }, '模型目录来自当前 DSH 适配器。后续新会话使用此默认模型；已有会话请在会话中切换。登录一般可自动续期，授权失效后需重新登录。'),
        error && h('p', { role: 'alert', style: { color: '#d33' } }, error));
    }
    function apply(ctx) {
      const call = async (endpoint, payload = {}) => {
        const result = await ctx.connection.rpc.call('/chatgpt-subscription', endpoint, payload);
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'chatgpt-subscription', order: 12,
        label: () => 'ChatGPT 订阅', inject: () => ({ call }),
      }, Section));
    }
    return { inject, apply };
  },
});
