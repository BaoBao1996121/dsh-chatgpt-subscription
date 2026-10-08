# DSH ChatGPT Subscription

DeepSeek Harness 的 ChatGPT 订阅登录与网络设置插件。采用 MIT 许可证，由社区独立维护。

在 **设置 → ChatGPT 订阅** 中登录 OpenAI，选择直连或 Clash 本地代理，并把 ChatGPT 模型设为 DSH 主 Agent 的默认模型。

## 支持范围

- 已针对 **DSH Desktop 0.2.0-rc.2 / Windows** 开发和验证；不需要启动 DSH 源码版本。
- 浏览器登录入口支持本机 Chrome 或 Edge。其他系统尚未适配浏览器启动入口。
- 复用 DSH 内置 `openai-codex` 适配器、OAuth 登录服务、凭据存储和自动续期机制；不需要 OpenAI API Key。
- 提供 `gpt-6.1-sol` 文本模型选项。真实账户的接口已验证可用，其他账户仍以 OpenAI 实际授权为准。新型号使用 DSH 缺省容量，尚未验证其上下文上限或图像能力；仅声明文本输入和 low 推理档位。
- 新会话使用保存的默认模型；已有会话需在会话中切换模型。

## 安装

下载 [GitHub Release](https://github.com/BaoBao1996121/dsh-chatgpt-subscription/releases) 中的 `.tgz`，在 DSH 的插件管理中输入下载文件的绝对路径进行安装，或运行：

```sh
dsh plugin --profile desktop add /absolute/path/dsh-chatgpt-subscription-0.1.3.tgz
```

也可以从 GitHub 安装固定版本：

```sh
dsh plugin --profile desktop add github:BaoBao1996121/dsh-chatgpt-subscription#v0.1.3
```

安装后重启 DSH。打开 **设置 → ChatGPT 订阅**：

1. 选择网络方式，填写 Clash 的 HTTP/Mixed 端口，点击 **保存连接方式**。
2. 点击 **登录 OpenAI**，在打开的浏览器里自行完成登录。已经在 DSH 保存过 OpenAI 登录的用户可以直接使用。
3. 选择模型，点击 **设为主 Agent 默认模型**，再创建新会话。

默认代理地址 `http://127.0.0.1:21158` 是一个可修改的示例；请填写自己 Clash 设置中的实际端口。

## 网络方式

| 选项 | 应用行为 | Clash 的影响 |
| --- | --- | --- |
| 直连 | OpenAI 请求使用显式直接连接，忽略 Node 环境代理；登录浏览器使用 `--no-proxy-server` | Clash TUN、系统 VPN 或网络路由仍可能接管流量 |
| 使用 Clash | OpenAI 请求和登录浏览器都明确连接填写的本地 HTTP 代理 | 最终出口遵循 Clash 的规则；规则可能选择 DIRECT，Clash 关闭或端口错误会导致失败 |

模式切换影响之后发起的 OpenAI 请求；已有请求继续使用它开始时的连接。登录期间须先完成或取消登录，才能切换网络方式。插件不会改动 Clash 配置、Windows 系统代理或其他模型提供商的网络路径。

## 登录与凭据

登录使用 DSH 自带的 OAuth 流程；凭据保存在 DSH 的原生凭据文件中。设置页只显示是否保存了登录，不向浏览器返回访问令牌、刷新令牌或账户标识。访问令牌过期后，DSH 原生适配器尝试自动续期；撤销授权、账号变化或续期失败时需要重新登录。

选择直连和代理并不改变 OpenAI 的账户授权或地区可用性。

## 实现与配置影响

这是一个标准 `dsh.bundle`，附带 Host 和 Client 插件入口。

- 通过原生 Connection 的 `/api` 精确路由承载 RPC，所有设置操作由 DSH 身份验证保护。
- 通过 `settings.section` 插槽增加设置页。
- 对 `auth.openai.com` 和 `chatgpt.com` 的 HTTPS fetch 请求设置显式 Undici dispatcher；其他域名保持原路径。卸载时还原该 hook。
- DSH 内置 Codex WebSocket 路径不接受这个 fetch dispatcher，因此插件将 `llm-pi-ai.providers.openai-codex.transport` 持久设置为 `sse`，并补充模型目录。保留其他 provider 与已有模型字段。
- 配置变更在应用就绪后提交，避免阻塞 Cordis Loader 初始化。
- 登录浏览器使用 DSH_HOME 下独立的 `chatgpt-login-browser/<mode>` 用户目录。

插件卸载会移除登录页面与网络 hook；已保存的登录、默认模型和原生适配器配置会保留。需要回退时，请恢复安装前的 profile 配置或在 DSH 设置中重新选择原来的模型。勿公开上传 `.credentials.yaml` 或登录浏览器目录。

## 开发与验证

使用 Node.js 24：

```sh
npm install
npm test
npm pack
```

测试覆盖 OpenAI 域名匹配、直连与代理 dispatcher、其他域名隔离、卸载还原，以及真实 Cordis Context 中的凭据状态投影与错误处理。真实登录与模型请求使用本机 DSH 发布版验收，仓库不包含账户凭据或本机登录数据。

发布版的真实组合验收还确认了：匿名设置请求返回 HTTP 401；已有 OAuth 登录能被读取；直连和 Clash 设置都能保存；主 Agent 默认模型可切换为 `gpt-6.1-sol`。模型请求已返回预期验证文本。桌面窗口的按钮布局仍需用户重启后确认。

## 插件目录

仓库使用 `dsh-plugin` 和 `deepseek-harness` topics，npm manifest 带有同名关键词，供社区插件目录发现。GitHub 发布不代表已获任何市场收录或官方认证；收录取决于目录的扫描和审核规则。

## English

A community DSH bundle for ChatGPT subscription sign-in, explicit direct/Clash routing, and main-Agent model selection. Tested target: DSH Desktop 0.2.0-rc.2 on Windows, Chrome/Edge, Node.js 24. Uses DSH's native Codex OAuth credential store and refresh flow. No API key or DSH source checkout is required.

Install the release tarball with `dsh plugin --profile desktop add <absolute-tarball-path>`, restart DSH, and open **Settings → ChatGPT 订阅**. Direct mode bypasses application/environment HTTP proxies but cannot bypass OS-level TUN/VPN routing. Clash mode uses the configured local proxy and obeys its rules. The native Codex adapter is configured for SSE, and a text-only `gpt-6.1-sol` entry is added. Actual model access depends on the account; context/image capabilities of this added model are unverified.
