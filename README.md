# dsh-devin-search

开源仓库：https://github.com/mimimaster/dsh-devin-search · MIT 许可证（第三方协议实现的来源见 `NOTICE`）。

**父项目：** [piwin](https://github.com/mimimaster/piwin) — 基于 pi 的桌面端 coding agent（Agent Runtime、编排、工具链与桌面壳）。本插件的 Devin 搜索能力最初在 piwin 中打磨，再抽成独立 DSH bundle，方便在 DeepSeek Harness 里单独安装使用。

独立的 **DSH npm ESM bundle**：浏览器登录 Devin 一次，由 DSH Host 持久化 session；原生 `web_search` 与新增 `code_search` 共用登录。保留原生 `web_fetch`（HTTP）和你的主模型，不修改 DSH/piwin，不依赖 piwin 私有包，不读取其他应用的 token。

> 新包名为 **`dsh-devin-search`**；不要再安装旧包名 `dsh-plugin-devin`。

> **注意数据边界：** 代码搜索会上传查询及所选代码到 Devin/Windsurf，请先确认你有权限。alpha DSH API 与非公开云端协议可能变更。

## 兼容与安装

- Node **>=22.19.0**，ESM。
- **运行时 peers（安装兼容）** 覆盖桌面 **0.1.7-rc.1 / 0.1.7-rc.2** 与较新的 **0.2.0-rc./*** / 0.2.1-alpha.1**；Cordis `>=4.0.4 <5`。开发依赖仍可用 0.2.1-alpha.1 做离线测试。
- 共享 Cordis/DSH 运行时使用 peers，不使用 `workspace:*`。
- 需要已有 base-backed DSH profile 提供 `credentials`（通常 credentials-local）、`authorization`、`commands`、`web`、`tools`、`fs`、`agents`。缺少服务会保持待注入状态，不提供自制文件授权 fallback。

### 在 DSH 桌面 / Web 安装（推荐）

1. 打开侧栏 **插件**（不是「设置 → 内置插件」——那是只读清单）。
2. **添加插件 / 安装第三方插件**。
3. 包名填：`dsh-devin-search`（可带版本，如 `dsh-devin-search@0.2.6`）。
4. 安装完成后 **启用**，必要时重启桌面端。

CLI（仅非 Electron 独占 profile，例如 web）：

```sh
dsh plugin --profile web add dsh-devin-search
```

本地 tarball / 开发目录：

```sh
npm ci && npm run check && npm pack
# 产生 dsh-devin-search-0.2.6.tgz
# Electron 独占 profile 只能从原生插件页安装，填 tarball 绝对路径。
# 以下手动方式仅适用于非 Electron 独占 profile：
# pnpm add /绝对路径/dsh-devin-search-0.2.6.tgz
# 并在 profile package.json 的 dsh.profile.bundles 追加 "dsh-devin-search"
```

bundle 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，先将已有 `web` 行设为 `{ searchProvider: devin, fetchProvider: http }`，再插入插件。此显式配置不受 `DSH_WEB_SEARCH_PROVIDER` 覆盖；更高优先级的 profile/home patch 可主动更改它。它不重复注册 `web_search`，也不注册主模型 adapter。仅依赖普通 Node host filesystem，不引入 SSH 判定包。

## 独立开关与原生 UI

桌面端：**插件 → dsh-devin-search → 搜索工具**，两个 DSH 原生开关独立控制，自动保存至当前 profile，立即生效，无需退出登录或重启。

- **网页搜索**：`webSearch`（默认 `true`）。关闭后通过 DSH 原生 per-agent restriction 从模型的工具列表隐藏 `web_search`，并拒绝直接调度；不影响 `web_fetch`。
- **代码搜索**：`codeSearch`（默认 `true`）。关闭后不注册 `code_search`；不影响网页搜索或已保存的登录。
- 原生 `ConfigForm` 提供版本冲突保护和持久化；开关使用 `.volatile()` 配置，不是只改变图标或 provider availability 的假开关。
- `code_search` 使用 DSH 原生工具行、展开的输入/输出和错误状态；本插件不注册 `tool.call.toolview` 覆盖。

也可在 profile 的 `cordis.patch.yml` 追加（patch 替换整行配置；若已有其他配置请合并保留）：

```yaml
- id: devin-search
  config:
    webSearch: true
    codeSearch: false
```

上述配置是“网页开、代码关”；要反过来，设置 `webSearch: false`、`codeSearch: true`。桌面界面操作会自动保存并应用；手动编辑文件后按 DSH 提示重新加载。内置 `tool-web.search` 若单独被关闭，插件不会重新开启它。

## 登录与清理

1. 在 DSH Web / 桌面交互界面运行 **`/devin-login`**。命令立即返回授权链接，不会在服务器上打开浏览器，也不会一直占着命令等待授权。
2. 在卡片点击 **在浏览器中打开授权**，完成 Devin 授权后复制官方页面显示的一次性授权码。
3. 回到卡片的 **一次性授权码**安全输入框粘贴，点击 **提交授权码**。授权码通过 DSH 现有受认证的同源 API 提交，不进入 slash 命令、聊天历史或日志；请勿把授权码/session token 发进模型对话。只有服务器完成交换和凭据写入后，卡片才显示成功。
4. **`/devin-status`** 查看状态；**`/devin-cancel`** 取消 pending；**`/devin-logout`** 同时取消本实例的登录/搜索、等待已进入 commit 的写入，然后只删除 `devin-search/session`。

**服务器 + 手机：** 默认使用 Devin 官方省略 `redirect_uri` 的授权码模式。Devin 的 CLI 页面只允许 `http://127.0.0.1:<端口>/callback`，不能直接改成服务器域名。授权码模式不创建回调监听；状态通过 DSH Connection API 同步，不会访问手机的临时 localhost 端口。依赖 DSH 的 Connection Fetch 路由及浏览器认证（已用 `0.2.1-alpha.1` SDK 验证）；远程传输请使用 HTTPS 或安全隧道，不能裸露未经保护的 HTTP。无 Web 通道的 CLI 请使用下面的原生授权交互。

**本机模式：** 浏览器确实与 DSH 在同一台机器时可使用 **`/devin-login local`**，仍需点击返回的授权链接。本机回调保留 `127.0.0.1:59653/callback`，占用则随机端口；错误 state 返回 400 但不终止合法尝试。DSH 原生授权 UI 的 Devin search 同时提供 Local browser callback 与 Paste authorization code 两个 PKCE 方法；原生码输入使用 `secret` prompt，共用同一 authorization flow 和凭据 commit。

两个模式都使用 PKCE S256、每次独立的 verifier/state 和最多 5 分钟的登录期限。回填绑定当前随机 attemptId，只接受一次；重试必须创建新尝试。取消/超时/unload 会退役等待和本机监听；成功交换后的 token 仅由服务器保存。

session 是 DSH `GrantRecord`，由 **credentials-local** 在 `$DSH_HOME/.credentials.yaml` 中保存（POSIX 0600、原子写与文件锁由 DSH 负责），不是普通 profile 配置 YAML。重启从该 store 恢复；任何 token 都不应进入日志、模型结果或普通配置。`/devin-logout` 不影响其他插件 credentials；卸载 bundle **不会**自动删 session，应先 logout。不要删除整个共享 credential 文件以清理本插件。

**没有 refresh grant / 不自动 refresh：** JWT 形式的 session 使用 `exp`（提前 60 秒视为过期）；opaque token 只保守记录 **24 小时**，不保证永久有效。401/403 将匹配的 session 标为 revoked，请重新登录；普通网络错误不清除登录。短期 GetUserJwt 是搜索专用缓存，按 session token/account 隔离，最多 5 分钟；本实例收到 credential rotation/logout 时清缓存、取消搜索。多进程只能共享 durable store，并不能取消另一进程的 pending 登录；避免同时跨进程登录/登出。

## code_search 与数据边界

模型参数仅：

```json
{"search_term":"定位 OAuth callback 的实现","search_folder_absolute_uri":"/绝对路径/当前工作区"}
```

- `exec.agent.session.header.cwd` 是权威 root；缺少 cwd 拒绝。先 canonicalize，再由 `ctx.fs.processPathFromHostPath` 确认映射等于 host canonical path；remote world 不因 Host 存在同名文件而读取它。
- 搜索 folder 必须为 root 内真实目录。cloud 只获得虚拟 `/codebase` 路径；最终结果重新 fence/read，返回真实文件、行号与 snippet。
- 最多 **3 tool turns + 1 final**，每轮 `restricted_exec` 最多 **4 structured commands**：`rg/readfile/tree/ls/glob`。这是 JSON 对象 allowlist，**不是任意 shell**，无 exec 子进程。
- `rg` 为 literal `includes`，不运行用户 regex；`glob` 仅 `*` / `?`，使用有界 DP，不执行任意正则。
- 每文件 **512 KiB**；最多 **512 files visited / 4096 entries / depth24**；每命令保留 **24 KiB**、全程最多 **192 KiB** command output；最终最多 **8 files / 16 ranges / 每 range400行 / 48 KiB snippets**；总期限 **90 秒**。超界明确失败，不默默扩大搜索。全模块串行 code search，DSH concurrency classifier 为 exclusive；web 可并发只读。
- 跳过 `.git`、node_modules、常见生成目录、`.env*`、credentials/secret/token/private-key 命名与 key/certificate 文件；不 follow symlinks；NUL/非 UTF-8 二进制与 oversized file 拒绝。命令执行与最终 snippets 二次校验路径/身份；文件打开使用 O_NOFOLLOW。
- 尊重 **搜索 folder 及子目录的 `.gitignore`**（通过 `ignore` 库），命令/最终结果都不能读已排除文件。**限制：不读 folder 祖先的 `.gitignore`、`.git/info/exclude` 或全局 Git ignore；子目录否定规则不能重新纳入被祖先排除的目录。** 请以项目 root 搜索，或在搜索 folder 内补充排除规则。
- 名称排除不是 secret/DLP 扫描：普通源码中的内嵌密钥可能随 snippet 上传。不要对有敏感内容的代码启用此云端搜索。此同进程只读 fence 也不是抵御本机恶意进程并发修改 filesystem 的 OS sandbox；请使用可信工作区。

## 云端协议与错误处理

web 请求两个主机，先 server.codeium.com，再 server.self-serve.windsurf.com；仅普通失败 fallback，abort 不继续。结果仅接受 http/https URL（禁止内嵌用户名密码），最多10条、bounded response/snippet；不 echo provider 错误正文/cause。

code search 私有 client 使用 `GetUserJwt` raw application/proto，以及 `GetDevstralStream` Connect-gzip。Metadata API key field3、user JWT21；message roles5/1/2/4，工具支持真实响应的 `[TOOL_CALLS]name{JSON}` 和兼容的 `[ARGS]` 分隔形式；去除终端 `</s>`。最终答案使用声明的 `ANSWER` 结构化工具（也兼容旧 XML），所有路径/行号仍由本地重新读取验证。按参考的当前 endpoint 默认 `swe-1-6-fast` 使用；未猜测额外 protobuf model 字段或注册主模型。严格校验 gzip、partial frame/protobuf、末帧 trailer/error，限制压缩/解压 bytes，取消时关闭 reader。云端若返回未知工具、非法参数或越界路径会 fail closed，而不会执行新的命令。工具失败通过 DSH 原生 `isError` 呈现，不伪装为无匹配结果。

## 离线检查

```sh
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

fixture 使用 localhost、合成 token 与独立临时目录，不读取真实 `.env`/token，也不调用付费 API：

- OAuth code/state/S256、wrong-state 抗干扰、port fallback、timeout/preabort、exchange 取消与 server cleanup。
- 远程无回调 PKCE、授权码一次性消费/错误尝试隔离/旧码不能用于新 verifier、认证 API 拒绝匿名请求、敏感输入不进入聊天记录、取消/过期/退出竞态、同源状态同步与安全输入卡片。
- 真正 Cordis authorization/commands/web/tools/fs services，native flow 与 slash login、注册/unload、原子 commit/logout 竞态、credentials-local 0600 和 restart/shared login。
- Web 双主机、aliases/schema/URL/result cap、abort/reader、失效与 error redaction。
- Protobuf/Connect/gzip、tool markers、trailer/partial/bytes cap、JWT 缓存跨账户/rotation/revocation。
- 真实临时代码多轮 loop、命令/最终 path fence、symlink/secret/binary/ignore、turn/output/file/range 配额及取消/并发。

**线上 smoke（2026-10-04，本机）：** 已用 DSH 存储的会话真实调用网页搜索；代码搜索在 `scripts/` 下经多轮云端工具调用返回 `build-client.mjs` 第 14–17 行，本地再次读取校验。这不代表非公开协议永久兼容，也不代表任意大型工作区可绕过上述搜索配额。

**远程登录隔离预览：** `npm run build` 后执行 `node scripts/preview-remote-login.mjs /安装目录/@deepseek-ai/dsh-client-connection/lib/index.js`（项目已安装该 SDK 时可省略路径），打开脚本输出的 loopback 测试入口。使用真实 DSH Connection 的 Host/Origin/浏览器认证、当前插件卡片/API 和独立临时凭据库，但提供方和授权码均为模拟值；该脚本仅用于本机 QA，不能部署为生产服务。

**未验证：** 真实 Devin 账号的无回调授权码签发/换码完整链路（隔离模拟不能替代）、服务默认模型/协议持续兼容、账户额度/计费、Windows 平台 ACL/路径行为。离线测试和线上 smoke 分开记录，不能相互替代。参考与许可见 `NOTICE` / `LICENSE`。

---

## 友情链接

[Linux.Do](https://linux.do) — 新的理想型社区

---

### License

[MIT](./LICENSE) — 所有源码、会话记录与凭证默认存储于用户本地，尊重代码主权与数据隐私。
