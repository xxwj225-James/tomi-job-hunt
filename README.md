# TomiHunt 🎯

> AI 求职雷达：本地语义标签、匹配度评分、高回复率打招呼语、去中心化求职情报网。
> **所有数据留在本地，隐私由你掌控。**

> ⭐ **觉得这个工具对你有帮助？点个 Star 支持一下**，让更多正在求职的朋友看到它 →
> [⭐ 给 TomiHunt 一个 Star](https://github.com/xxwj225-James/tomi-job-hunt)

[English](#english) | [使用指南](docs/usage.md) | [法律与合规](#法律与合规) | [License](#license)

## 📸 界面预览

桌面 Agent（Windows）主界面预览 —— 左侧 JD 库，右侧是选中岗位的全部能力；配合浏览器插件后，浏览岗位即自动沉淀到本地 JD 库。

![TomiHunt Agent 桌面界面预览](docs/images/agent-ui.png)

## 痛点

刷 Boss直聘 / 猎聘 时，求职者被困在一连串重复、碎片的手工活里：

- 刷过的岗位转头就忘，好机会和废 JD 混在一起——没有沉淀，过几天没法回头再筛
- 一个岗位值不值得投、和自己匹不匹配，全靠肉眼对照，慢且主观
- 打招呼语千篇一律、不针对岗位，发出去回复率低
- 每投一个岗位简历都要手工改一遍，重复劳动、容易漏
- 面试前临时翻 JD 抱佛脚，没有针对这家公司的准备材料
- 而把简历和浏览记录交给云端求职 SaaS，隐私没有保障

## 解决方案

TomiHunt 全部跑在你的电脑上，用 AI 把你从重复手工活里解放出来：

- **桌面 Agent**（Windows）：一键安装、内置一切——悬浮对话窗 + Core 服务 + 浏览器插件 + 自动更新，只差你一个 API Key
- **浏览器插件**（Chrome / Edge）：自动提炼 Boss 直聘 / 猎聘岗位详情，AI 结构化标签（技术栈/工时/风险词），打招呼语一键填入聊天框
- **本地 Core 服务**：本地 JD 库 + LLM 标签化 + 匹配打分 + 定制简历 + 面试准备（DeepSeek / Qwen / Kimi / 任意 OpenAI 兼容端点，自由切换）
- **去中心化情报网**（规划中）：匿名共享结构化求职情报（如真实薪资、外包黑榜），零注册、零服务器——见下方功能地图的 🧱 状态

```mermaid
flowchart LR
    subgraph Browser["Chrome / Edge 浏览器"]
        Ext["插件<br/>(JD 提炼 · 标签展示 · 一键填入)"]
    end

    subgraph Local["本机 (数据不出本机)"]
        Core["Core 服务<br/>localhost（端口自动选择）"]
        Store["本地 JD 库<br/>(JSONL · 结构化标签)"]
        Data["你的数据<br/>resume.md / config.json"]
        Core -->|读写| Store
        Core -->|读取| Data
    end

    LLM["LLM<br/>DeepSeek / Qwen / Kimi / 通用"]

    Ext -->|"HTTP / WebSocket (仅本机)"| Core
    Core -->|"API (仅 JD 与提示词)"| LLM
```

## ✨ 功能地图（按真实完成度标注）

> 状态标签：✅ 已可用 · 🚧 部分（可用但未接通主流程）· 🧱 脚手架（能跑通、缺数据/未上线）

### ✅ 已可用（Windows 桌面 Agent + 插件完整闭环）

- **本地 JD 库沉淀** —— 插件在 Boss直聘 / 猎聘 浏览岗位时自动提炼，LLM 打结构化标签（技术栈/工时/风险词），完整存进本机 JSONL（数据不出本机），随时回看再筛
- **匹配度打分（0–100 诊断）** —— 对照简历给每个 JD 评分并说明理由，直接指出匹配/不匹配点
- **定制简历改写** —— 针对选中 JD 改写（MD / Word 导出），改前可校验
- **打招呼语一键填入** —— 高回复率开场白生成，并直接填入浏览器聊天框（你确认后才发送）
- **列表页降噪** —— 风险词规则把外包/单休/驻场等标灰；卡片可 AI 打分
- **面试准备 + 模拟面试** —— 按 JD 生成面试提问准备（STAR），可多轮模拟对话练习
- **求职看板** —— 本地 Markdown Kanban（「📊 投递」页），记录投递进度
- **多模型切换** —— DeepSeek / Qwen / Kimi / 任意 OpenAI 兼容端点，设置里随时换
- **悬浮对话窗常驻** —— 插件沉淀的新 JD 会出现在 Agent 列表并自动刷新；LLM 任务在后台排队执行，不阻塞浏览
- **可选匿名用量统计**（默认关闭）—— 开启后只按天上报功能使用次数，无简历/JD/聊天内容
- **HR 招聘方视图**（可选模块 `hr/`）—— 简历抽取 + 候选人评分/筛选面板

### 🚧 部分可用（后端已通，但未接入 UI 或未自动跑）

- **岗位雷达（HN/V2EX/GitHub → 每日日报）** —— Core 的 `watchdog` 能抓取生成日报，但只能 `npm run watch -w core` 手动跑，未接进 App/插件定时器
- **反向求职（目标公司 + 冷邮件）** —— `POST /v1/hunt/*` 路由已实现，但**没有 UI**（桌面 Agent 与插件界面都未接入），需靠 API 直调
- **语义搜索（意图翻译 + LLM 重排）** —— `POST /v1/jd/semantic-search` 路由已通，但**列表页目前仍是关键词本地过滤**，语义搜索未接到前端

### 🧱 脚手架（代码就绪，暂无真实数据/未部署）

- **去中心化情报网** —— 导出器、结构化 Issue 模板、Nostr 发布/订阅、Cloudflare Worker 聚合路由都在，但 `data/intel-feed.json` 为空（未接入真实数据源），Worker 未部署

> ⚠️ 插件选择器（JD 提炼 / 打招呼语 / 降噪）基于 fixture 层测试，Boss 直聘/猎聘真实页面结构会变，建议按 [extension/README.md](extension/README.md) 实测一轮。

## 🚀 快速开始

### 第 0 步：申请一个 LLM API Key（自备，费用由你的 Key 承担）

TomiHunt 永久免费开源、不含内置模型 Key。**只需自己到一家服务商申请 API Key**，粘贴进 App 即可用：

| 服务商 | 说明 | 申请入口 |
|---|---|---|
| **DeepSeek**（默认，性价比高） | 话术 / 匹配 / 定制全覆盖 | [platform.deepseek.com](https://platform.deepseek.com) → 注册 → 充值 → API Keys → 创建 |
| **Kimi（月之暗面）** | 同上 | [platform.moonshot.cn](https://platform.moonshot.cn) → API Keys |
| **通义千问 Qwen**（阿里云百炼） | 同上 | [bailian.console.aliyun.com](https://bailian.console.aliyun.com) → API-KEY 管理 |

> 💡 各平台新用户一般有赠送额度，可先零成本体验。API Key 只保存在你本机（系统加密存储），App 不上传、不经过任何服务器。

### 方式一：桌面 Agent ＋ 浏览器插件（推荐 · Windows · 完整体验）

**Agent 是中枢，插件是它在浏览器里的手——两者一起用才是 TomiHunt 的完整形态。**
App 一键安装，Core 服务、插件、自动更新全部内置，全程无需命令行：

1. 从 [Releases](https://github.com/xxwj225-James/tomi-job-hunt/releases) 下载最新的 **`TomiHuntSetup-<版本>.exe`** 并安装
2. 打开 **TomiHunt Agent** → ⚙ **设置** → 粘贴第 0 步的 API Key → **保存**（保存时自动测试连接）
3. 设置 → **浏览器插件** → 点 **「打开扩展页」**（Chrome/Edge 不允许程序自动跳转其内部页，因此不会重启浏览器：点一下会打开/激活浏览器并把 `chrome://extensions` 复制到剪贴板，在地址栏 Ctrl+L 粘贴回车即可到达；主窗口顶部也常驻这两个按钮）→ 开「开发者模式」→「加载已解压的扩展程序」→ 选择插件目录 `%LOCALAPPDATA%\TomiHunt\extension`（可点 **「打开插件目录」** 直接定位它）
4. 回到 App，列表出现 **「● 在线」** 即插件已联通——之后你在 Boss 直聘 / 猎聘浏览岗位时，插件负责**自动提炼 JD**，Agent 负责**沉淀到本地 JD 库、匹配打分、生成话术**并回填聊天框
5. 生成的话术填入聊天框 → **你确认后手动发送**

> 单靠插件能完成核心闭环，但没有 Agent 的 JD 库沉淀 / 匹配 / 看板 / 面试准备等能力，也不享受 App 自动更新。想要完整体验请用方式一。
> App 支持 GitHub Releases 自动更新；插件固定在上述目录，App 更新后到扩展页点 🔄 刷新即可（浏览器不允许外部程序静默重装插件）。

### 方式二：仅浏览器插件（轻量子集 —— 仅限无法安装 App 的场景）

**不推荐作为日常主路径。** 只有当你用的是 **macOS / Linux**（桌面 App 目前仅 Windows），或确实不想安装 App 时，才用纯插件：下载 Releases 的 `tomihunt-extension.zip` → 解压 → 双击 `install-extension.bat` → 点工具栏 🤖 图标 → ⚙ 设置 → 粘贴 API Key。覆盖核心闭环（JD 提炼、AI 标签、打招呼语、匹配打分、面试准备），但**缺少 JD 库沉淀、求职看板、岗位雷达等 Agent 能力**。

### 方式三：源码运行（开发者 / macOS / Linux）

```bash
git clone https://github.com/xxwj225-James/tomi-job-hunt.git
cd tomi-job-hunt && npm install

# —— 桌面 App（Electron，仅 Windows 打包，源码可跨平台跑）——
npm run dev -w app

# —— 或 纯 Core 服务 + 插件 ——
mkdir -p ~/.tomi-job-hunt && cp config.example.json ~/.tomi-job-hunt/config.json
#   编辑 config.json：填 provider / model / apiKey
cp docs/resume.template.md ~/.tomi-job-hunt/resume.md     # 可选但强烈建议（话术质量关键）
npm start -w core                                         # Windows 也可双击 start.bat
npm run build -w extension                                # 然后 chrome://extensions 加载 extension/dist/
```

插件会自动探测本地 Core：在线走完整功能，离线自动退回直连模式。

**详细说明**（配置项、环境变量、API 列表、FAQ）见 [docs/usage.md](docs/usage.md)。

## 🔒 隐私声明

- **你的简历、偏好设置、浏览记录全部保存在本机**，Core 服务只绑定 `127.0.0.1`，不对外网开放
- 仅岗位描述（JD）与必要的提示词会发送给你选择的 LLM API
- 默认无遥测、无统计上报：桌面 Agent 设置 → 应用 → 「帮助改进 TomiHunt」**默认关闭**。开启后仅在本地记录各功能使用次数，并按天合并成一份**匿名纯计数**上报（每台设备一个随机 ID + 功能名与次数，**不含简历 / JD / 聊天内容**），可随时关闭并清除本机计数；纯插件轻量子集（直连模式）无此开关、也不采集任何数据
- 匿名计数默认发往作者自建统计端点 `https://tomatovector.com/api/tomihunt-usage`（只存按天聚合、可供作者改进产品）；自托管用户可用环境变量 `TOMI_TELEMETRY_URL` 或 `~/.tomi-job-hunt/telemetry.json` 的 `collectorUrl` 指向自己的 collector（参考仓库内 [cloudflare/worker.js](cloudflare/worker.js) 的 `/usage` 路由）。详见 [docs/privacy.md](docs/privacy.md) 与 [docs/telemetry.md](docs/telemetry.md)

## 🔄 自动更新（OTA）

- **桌面 App**：electron-updater 走 GitHub Releases（启动后 + 每 4 小时检查；设置 → 关于 → 检查更新 / 下载 / 重启安装）
- **插件**：每次打开 popup 检查仓库 `version.json`（每日一次）；App 用户到扩展页点 🔄 刷新
- **纯源码模式（Core）**：`start.bat` 每次启动前 `git pull`；`/health` 与 setup 页显示版本
- 将来插件上架 Chrome 商店后由浏览器自动静默更新

## 💝 支持项目

TomiHunt 永久免费开源（MIT 协议）、默认不收集任何数据（可选匿名用量统计默认关闭，开启才上报纯功能计数）。觉得有用的话，**扫码请作者喝杯咖啡 ☕**：

<p align="center">
  <img src="docs/images/wechat-donate.jpg" width="200" alt="微信赞赏码">
  <img src="docs/images/alipay-donate.jpg" width="200" alt="支付宝收款码">
</p>

也可以订阅 [爱发电](https://afdian.com/a/jameswu) 支持长期开发。

### 其他支持方式

- ⭐ Star 本仓库（对开源项目最大的支持）
- 🐛 反馈问题、提交 PR（见 [CONTRIBUTING.md](CONTRIBUTING.md)）
- 📣 把 TomiHunt 推荐给正在找工作的朋友

*无论你是否通过以上方式支持，TomiHunt 的全部功能永远免费。你的数据永远只属于你。*

## ⚠️ 使用注意

- TomiHunt 是**用户端增强工具**：只在你本人登录、本人浏览的页面上工作，不爬取、不批量请求。请遵守各招聘平台的使用条款
- 平台有账号风控机制：本插件已做请求频率控制（每次打开岗位最多 1 次接口请求；收到风控挑战后自动停止接口调用、只读页面内容），但**没有任何工具能 100% 保证平台不风控**——若出现验证提示，按平台要求完成即可
- **设计红线**：插件不自动化浏览、不批量操作、不群发消息。TomiHunt **不会自动发送任何消息**——AI 生成的话术只会填入聊天框并高亮，由你亲自确认后按 Enter / 点击发送（2026 起已移除「自动发送」模式）。所有接口请求均由你的主动操作触发，频率与真实用户一致
- LLM API 调用会产生费用，费用由你的 API Key 承担

## ⚖️ 法律与合规

TomiHunt 是**用户端本地增强工具**：只解析你正在浏览的页面，不做批量爬取；共享管线在代码层面硬性排除原始 JD 文本与个人信息（`buildSharedIntel` 只允许结构化标签与事实通过）。

- 免责声明与合规设计：[docs/LEGAL.md](docs/LEGAL.md)
- 侵权内容通知-删除流程：[TAKEDOWN_POLICY.md](TAKEDOWN_POLICY.md)

## 📁 项目结构

```
app/        桌面 Agent（Electron · 悬浮对话窗 · 内置 core/插件/OTA）—— `scripts/pack.mjs` 打包 NSIS 安装包
core/       本地 Core 服务（TypeScript · Hono · LLM Provider · JD 库/标签化/脱敏）
extension/  浏览器插件（Chrome/Edge MV3 · Vite）
hr/         招聘方视图（可选模块）
server/     可选去中心化情报网中转
cloudflare/ 可选情报聚合 Worker
scripts/    打包 / 安装辅助脚本
docs/       使用指南、架构、隐私与合规文档
```

## 🤝 贡献

欢迎贡献！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 📄 License

[MIT](LICENSE) + 附加使用限制 © 2026 Tomi-Job-Hunt contributors

> MIT 基础上附加 **Use Restrictions**（见 [LICENSE](LICENSE)）：禁止将本项目用于批量抓取第三方平台内容、绕过平台风控/反爬、或自动化冒充真人群发消息。任何使用均须遵守所访问平台的用户条款与适用法律。

---

## English

TomiHunt is an AI-powered job-hunting assistant for the Chinese job market
(Boss直聘 / 猎聘). A browser extension extracts job descriptions and sends
them to a **local** Core service that tags them with structured metadata and
writes high-response-rate greeting messages. Provider-agnostic: DeepSeek,
Qwen, Kimi and any OpenAI-compatible endpoint work out of the box. A decentralized,
accountless community-intel feed (structured facts only — never raw JD text)
is on the roadmap.

**Everything runs on your machine.** No cloud servers. Telemetry is **opt-in
and OFF by default** (Settings → App → "Help improve TomiHunt"): when enabled,
only anonymous per-day feature-count aggregates are sent — never resumes, JDs,
or chat text. By default they go to the author's aggregation endpoint
(`https://tomatovector.com/api/tomihunt-usage`); self-hosters can redirect them
to their own collector with the `TOMI_TELEMETRY_URL` env var (see
[docs/telemetry.md](docs/telemetry.md)). Only the JD text and prompts you choose
to send reach your LLM API.

- **Windows**: download `TomiHuntSetup-<version>.exe` from
  [Releases](https://github.com/xxwj225-James/tomi-job-hunt/releases) — the Core
  service, browser extension and OTA are all bundled. Bring your **own API key**
  (DeepSeek / Qwen / Kimi / any OpenAI-compatible endpoint).
- **From source**: `npm install`, copy `config.example.json` to
  `~/.tomi-job-hunt/config.json` and set a provider, then
  `npm start -w core` and `npm run build -w extension` (load `extension/dist/`
  unpacked). Full guide: [docs/usage.md](docs/usage.md).
- **Status**: current as of the feature map above — Windows Agent installer
  (`TomiHuntSetup-<version>.exe`), Core with JD tagging / matching / tailored
  resume / interview & mock prep / board, the browser extension, and opt-in
  usage telemetry (OFF by default). Backend-only scaffolding exists for the
  company-hunt/cold-email routes, a semantic-search route and an HN/V2EX/GitHub
  radar (CLI-only, no UI hookup yet); the intel feed has no live data.
- **Privacy**: [docs/privacy.md](docs/privacy.md). **Legal**:
  [docs/LEGAL.md](docs/LEGAL.md) and [TAKEDOWN_POLICY.md](TAKEDOWN_POLICY.md).

## License

[MIT](LICENSE) © 2026 Tomi-Job-Hunt contributors
