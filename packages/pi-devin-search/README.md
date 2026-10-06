# pi-devin-search

适用于 [Pi Coding Agent](https://pi.dev) 的原生扩展，提供基于 Devin 官方接口的联网搜索（`web_search`）与本地代码库只读检索（`code_search`）。

本扩展独立运行于 Pi CLI 环境，无需图形界面支持，不依赖 DeepSeek Harness 运行时。

## 功能特性

- **联网搜索 (`web_search`)**：通过 Devin 服务检索公开互联网信息并返回结构化引用来源。
- **本地代码检索 (`code_search`)**：受控只读代码检索，在当前工作区（cwd）内执行有界结构化搜索，支持代码库定位。
- **标准认证体系**：基于 PKCE 协议实现授权码登录，凭据在本地严格隔离存储。
- **细粒度工具控制**：支持按需独立启用或禁用特定搜索工具。

## 安装指南

### 从 npm 安装（推荐）

在 Pi 终端中执行：

```bash
pi install npm:pi-devin-search
```

### 本地路径安装（开发与调试）

指定扩展包本地路径安装：

```bash
pi install /path/to/dsh-plugin-devin/packages/pi-devin-search
```

或在单次会话中临时加载：

```bash
pi -e /path/to/dsh-plugin-devin/packages/pi-devin-search/dist/extension.js
```

## 命令与认证

扩展注册了以下交互管理命令：

| 命令 | 说明 |
| :--- | :--- |
| `/devin-login` | 发起 PKCE 授权流程。获取授权码后在专用交互输入框中提交。 |
| `/devin-login local` | 本机环境专用：通过本地临时回调（`127.0.0.1`）完成登录。 |
| `/devin-status` | 查看当前会话状态及有效期（脱敏展示，不输出敏感令牌）。 |
| `/devin-settings` | 交互式查看并调整工具启用状态。 |
| `/devin-settings web on\|off` | 开启或禁用 `web_search` 工具。 |
| `/devin-settings code on\|off` | 开启或禁用 `code_search` 工具。 |
| `/devin-logout` | 取消在途请求并删除本地持久化凭据。 |
| `/devin-cancel` | 取消等待中的登录交互流程。 |

> **安全须知**：请勿将授权码直接附加在命令参数或输入在对话内容中。系统会在独立安全的输入界面中接收授权码。

## 工具行为与运行约束

- **默认状态**：初次安装或登录后，`web_search` 与 `code_search` 默认均为开启状态。
- **启动白名单 (`--tools`) 兼容说明**：
  若启动 Pi 时显式指定了 `--tools` 过滤参数，Pi 将基于全局白名单过滤所有工具（含扩展工具）。此时必须将所需工具显式加入参数，例如：
  ```bash
  pi --tools read,web_search,code_search
  ```
  修改启动参数需完全重启 Pi 进程生效（`/reload` 不会变更进程级参数白名单）。
- **代码检索安全沙箱**：
  - 检索范围严格限定在启动 Pi 时的当前工作目录（cwd）以内，禁止跨目录逃逸。
  - 严格遵守目录内 `.gitignore` 规则，自动跳过敏感配置文件（如 `.env`、密钥凭据及私钥证书）与大型二进制文件。
  - 所有工具调用均为只读模式（`readOnlyHint: true`），不具备文件写入与系统命令执行权限。

## 凭据存储与隐私

- **存储路径**：`<getAgentDir()>/devin-search/credentials.json`
- **文件权限**：采用 POSIX `0600` 严格权限模式。不读取 Pi 系统自带的 `auth.json`，与宿主其他凭据完全解耦。
- **配置持久化**：用户功能配置独立持久化于 `devin-search/settings.json`。

---

## 友情链接

[Linux.Do](https://linux.do) — 新的理想型社区

---

### License

[MIT](./LICENSE) — 所有源码、会话记录与凭证默认存储于用户本地，尊重代码主权与数据隐私。
