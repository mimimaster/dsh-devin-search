# dsh-devin-search / pi-devin-search

面向 AI 编程智能体的 Devin 搜索集成套件，包含适用于 **DeepSeek Harness (DSH)** 的运行时插件与面向 **[Pi Coding Agent](https://pi.dev)** 的原生 CLI 扩展。两个生态共享经安全审计的 Devin 认证流程与只读本地代码检索沙箱。

开源仓库：https://github.com/mimimaster/dsh-devin-search · MIT 许可证（第三方协议实现的来源见 `NOTICE`）
相关生态：[piwin](https://github.com/mimimaster/piwin) · [Linux.Do](https://linux.do)

> **注意：** 本仓库 DSH 插件包名为 `dsh-devin-search`（请勿使用已废弃的旧包名 `dsh-plugin-devin`）；Pi 原生扩展包名为 `pi-devin-search`（位于 `packages/pi-devin-search`）。
> **数据边界提示：** `code_search` 会将检索查询与经筛选的相关代码片段发送至 Devin 云端服务，请确保已取得对应代码资产的访问与使用授权。

---

## 架构与交付物

| 交付组件 | 适用环境 | 分发形式 | 核心能力 |
| :--- | :--- | :--- | :--- |
| **`dsh-devin-search`**（根目录） | DeepSeek Harness 桌面端 / Web 端 | DSH ESM Bundle (`npm:dsh-devin-search`) | 原生设置面板、OAuth 认证卡片、Connection API 状态同步、`web_search` 与 `code_search` |
| **`pi-devin-search`**（子包） | Pi Coding Agent 原生终端环境 | Pi Package (`npm:pi-devin-search`) | 纯 CLI 终端运行、PKCE 交互认证、进程级参数兼容、独立凭据隔离 |

两套集成均基于共享核心模块实现：
- **认证核心**：PKCE S256 流程，支持远程代码回填与本地端口回调，会话长期有效管理（默认 365 天）。
- **联网检索**：双云端端点容灾（`server.codeium.com` / `server.self-serve.windsurf.com`），自动结构化解析与来源过滤。
- **本地代码检索**：严格限制在当前工作目录（cwd）内的只读 AST/关键词有界扫描，强制执行敏感文件排除与 `.gitignore` 规则。

---

## 1. DeepSeek Harness (DSH) 插件使用指南

### 环境兼容要求

- Node.js `>=22.19.0` (ESM)
- Cordis `>=4.0.4 <5.0.0`
- 支持 DSH 运行时基础服务（提供 `credentials`、`authorization`、`commands`、`web`、`tools`、`fs` 等接口）。

### 安装与配置

#### 桌面端 / Web 端安装（推荐）

1. 进入侧边栏 **插件**（Plugins）页面。
2. 点击 **添加插件 / 安装第三方插件**。
3. 输入包名 `dsh-devin-search`（可指定版本，例如 `dsh-devin-search@0.2.9`）并安装。
4. 安装完成后启用插件，必要时重启应用。

#### CLI 与手动部署

```bash
# Web profile 安装
dsh plugin --profile web add dsh-devin-search

# 本地源码打包安装
npm ci && npm run check && npm pack
```

#### 声明式配置与独立开关

在桌面端 **插件 → dsh-devin-search → 搜索工具** 面板中，提供两个独立开关（即时生效，无需退出登录或重启）：
- **网页搜索 (`webSearch`)**：默认启用。关闭后对模型隐藏 `web_search`，保留基础 `web_fetch`。
- **代码搜索 (`codeSearch`)**：默认启用。关闭后注销 `code_search` 工具。

亦可在 Profile 的 `cordis.patch.yml` 中声明：

```yaml
- id: devin-search
  config:
    webSearch: true
    codeSearch: false
```

### 认证流程与凭据安全

1. 执行 `/devin-login`：系统即时返回授权链接与认证卡片。
2. 浏览器打开官方授权页完成登录，复制一次性授权码。
3. 在认证卡片的专用安全输入框中提交授权码。
4. 执行 `/devin-status` 查看状态；执行 `/devin-logout` 取消在途请求并清除会话；执行 `/devin-cancel` 取消进行中的登录。

**远程与本地模式：**
- **远程 / 移动端**：默认采用无 `redirect_uri` 的授权码模式，通过 DSH Connection API 安全同步，不监听本地端口。
- **本机环境**：支持 `/devin-login local`，通过 `127.0.0.1:59653/callback` 自动接收回调。

**凭据持久化：** 会话存储为 DSH `GrantRecord`（POSIX `0600` 权限），位于 `$DSH_HOME/.credentials.yaml`。无 `exp` 字段的 Opaque 会话凭据默认记录 365 天有效期，令牌绝不写入普通配置文件或模型对话上下文。

---

## 2. Pi Coding Agent 原生扩展使用指南

详细文档请参阅 [子包专有说明文档](./packages/pi-devin-search/README.md)。

### 安装方式

```bash
# 方式 A：从 npm 安装
pi install npm:pi-devin-search

# 方式 B：从本地路径安装
pi install /path/to/dsh-plugin-devin/packages/pi-devin-search

# 方式 C：单次会话临时加载
pi -e /path/to/dsh-plugin-devin/packages/pi-devin-search/dist/extension.js
```

### 常用命令

| 命令 | 说明 |
| :--- | :--- |
| `/devin-login` | 启动 PKCE 授权流程并在安全交互弹窗中输入授权码 |
| `/devin-status` | 查看当前登录状态与有效期限（脱敏输出） |
| `/devin-settings` | 交互式查看与配置开关 |
| `/devin-settings web on\|off` | 开启或关闭联网搜索 |
| `/devin-settings code on\|off` | 开启或关闭代码检索 |
| `/devin-logout` | 退出登录并安全移除本地凭据 |

### 关键配置须知

- **启动白名单参数**：若使用 `pi --tools ...` 启动 Pi，该参数为全局强校验白名单，必须包含两个扩展工具名（例如 `pi --tools read,web_search,code_search`）。变更白名单需重启进程，`/reload` 无法修改启动参数。
- **凭据路径**：独立保存在 `~/.pi/agent/devin-search/credentials.json`（POSIX `0600`），与 Pi 核心 `auth.json` 物理隔离。

---

## 3. 代码检索 (`code_search`) 安全沙箱与数据边界

为保障本地代码库安全，代码检索模块实施了多层只读安全围栏：

### 目录与路径约束
- **绝对工作区限制**：以当前进程工作目录（cwd）为绝对根边界，严禁跨目录访问或路径穿越。
- **软链接防御**：不跟随（No follow）符号链接，文件系统操作使用 `O_NOFOLLOW`。

### 敏感数据与忽略规则
- **`.gitignore` 过滤**：自动递归加载并执行检索范围内的 `.gitignore` 规则。
- **敏感文件拦截**：硬性跳过版本控制（`.git`）、依赖目录（`node_modules`）、环境配置（`.env*`）、密钥凭据（包含 `credentials`、`secret`、`token`、`private-key` 命名）及各类私钥证书。
- **二进制过滤**：自动拒绝非 UTF-8 编码文本与 NUL 字符二进制文件。

### 有界执行沙箱
- 结构化命令白名单：仅允许执行结构化 JSON 查询（`rg`、`readfile`、`tree`、`ls`、`glob`），**严禁拉起系统 Shell 或执行任意命令**。
- 配额保护：单文件体积上限 512 KiB，单次检索最多遍历 512 个文件 / 深度 24，全程命令输出总量上限 192 KiB，单次请求总超时 90 秒。

---

## 4. 离线验证与工程测试

本项目提供完整的单元测试、类型检查及端到端离线模拟环境（所有测试均采用本地 Mock，不发起付费网络请求或读取真实私有凭据）：

```bash
# 根目录完整检查（含 DSH 插件构建与全部 18 个测试套件）
npm run check

# 子包专用检查（类型检查、单元测试与发布构建）
npm run check --prefix packages/pi-devin-search

# 打包发布预检
npm pack --dry-run
cd packages/pi-devin-search && npm pack --dry-run
```

---

## 友情链接

[Linux.Do](https://linux.do) — 新的理想型社区

---

### License

[MIT](./LICENSE) — 所有源码、会话记录与凭证默认存储于用户本地，尊重代码主权与数据隐私。
