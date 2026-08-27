# TomiHunt 🎯

> AI 求职雷达：本地语义标签、匹配度评分、高回复率打招呼语、去中心化求职情报网。
> **所有数据留在本地，隐私由你掌控。**

[English](#english) | [使用指南](docs/usage.md) | [法律与合规](#法律与合规) | [License](#license)

## 痛点

招聘平台本质是「卖曝光位的商业地产商」：搜索只能匹配公司名/岗位名、优质 JD 藏在付费曝光之后、求职者被困在盲目刷列表的消耗战里。

- 平台不让搜深层需求（「不用加班、懂 RAG、学历要求不严」搜不出来）
- 信息不对称：薪资虚标、外包伪装、挂职不招无法识别
- 海投简历没有针对性，HR 回复率低
- 不放心把个人简历交给云端求职工具

## 解决方案

TomiHunt 全部跑在你的电脑上，用 AI + 社区打破信息壁垒：

- **浏览器插件**（Chrome / Edge）：自动提炼 Boss 直聘 / 猎聘岗位详情，AI 结构化标签（技术栈/工时/风险词），打招呼语一键填入聊天框
- **本地 Core 服务**：本地 JD 库 + LLM 标签化 + 话术生成（支持 Claude / DeepSeek / Kimi / Qwen，自由切换）
- **去中心化情报网**（规划中）：匿名共享结构化求职情报（真实薪资、外包黑榜），零注册、零服务器

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

    LLM["LLM<br/>Claude / DeepSeek / Kimi / Qwen"]

    Ext -->|"HTTP / WebSocket (仅本机)"| Core
    Core -->|"API (仅 JD 与提示词)"| LLM
```

## ✨ 功能路线图

- [x] **阶段 0** — 项目基础 + 本地 Core 服务 + LLM 多 Provider 接入
- [x] **数据地基** — 统一 JD/情报 Schema + 本地 JD 库 + LLM 结构化标签 + PII 脱敏管线 + 合规文档
- [x] **阶段 1** — 插件闭环：Boss 直聘 JD 提取 + 打招呼语 + 聊天框一键填入；猎聘提取
- [x] **阶段 2** — 本地语义搜索（意图翻译 + 标签粗筛 + LLM 重排）+ 匹配度打分（0-100 诊断）+ 定制简历改写（MD/Word 导出）
- [x] **阶段 3** — 列表页降噪过滤（风险词规则）+ 卡片 AI 打分 + 面试提问准备（STAR 建议）
- [x] **阶段 4** — 隐形流量池雷达（HN/V2EX/GitHub → 每日日报）+ 求职看板（本地 Markdown Kanban）+ 多模型切换
- [x] **阶段 5** — 去中心化情报网（仓库 Feed 导出 + 结构化 Issue 模板 + Nostr 发布/订阅 + 可选 Cloudflare Worker 中转）
- [x] **阶段 6** — 反向求职引擎（目标公司图谱 + 直连自荐冷邮件）

> ⚠️ 插件侧（阶段 1/3）已在 fixture 层测试，但 Boss 直聘/猎聘真实页面的选择器建议按 [extension/README.md](extension/README.md) 实测一轮。

## 🚀 快速开始

### 方式一：纯插件直连（推荐，无需任何技术操作）

**不需要 Node、不需要启动服务**——装好插件、粘贴一个 API Key 即可：

1. 下载本仓库的 [Releases](https://github.com/<your-name>/tomi-job-hunt/releases) 中的 `extension.zip`，解压（或自行 `npm run build -w extension` 后用 `extension/dist/`）
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）→ 右上角开启**开发者模式** → **加载已解压的扩展程序** → 选择解压后的目录
3. 点击工具栏 🤖 图标 → **⚙️ 设置** → 选择服务商（DeepSeek / Kimi / Qwen / Claude 任选）→ 粘贴 API Key → **保存并测试连接**
4. 打开任意 Boss 直聘 / 猎聘岗位详情页 → 右下角 TomiHunt 面板自动导入 JD → 生成打招呼语 → 立即沟通 → 填入聊天框（或设置为自动发送）

直连模式覆盖核心闭环：JD 提取、AI 标签、打招呼语（Boss 直聘 + 猎聘）、匹配度打分、面试准备。发送方式可选：填入后自己确认发送（默认），或自动发送。

### 方式二：完整功能（开发者/进阶用户）

本地 Core 服务解锁语义搜索、求职看板、岗位雷达、情报网等全部功能：

```bash
# 1. 安装
git clone https://github.com/<your-name>/tomi-job-hunt.git
cd tomi-job-hunt && npm install

# 2. 配置 LLM（选一家，示例为 DeepSeek）
mkdir -p ~/.tomi-job-hunt
cp config.example.json ~/.tomi-job-hunt/config.json
#   编辑 config.json：填 provider / model / apiKey

# 3. 配置简历（可选，强烈建议——话术质量的关键）
cp docs/resume.template.md ~/.tomi-job-hunt/resume.md
#   也支持 resume.docx / resume.pdf（本机自动解析，不上传）

# 4. 启动本地 Core 服务（Windows 用户也可直接双击 start.bat）
npm start -w core

# 5. 构建插件并加载
npm run build -w extension
#   打开 chrome://extensions → 开发者模式 → 加载已解压 → 选择 extension/dist/
```

插件会自动探测 Core：在线则用完整功能，离线则自动退回直连模式。

**详细说明**（配置项参考、环境变量、API 列表、FAQ）见 [docs/usage.md](docs/usage.md)。

## 🔒 隐私声明

- **你的简历、偏好设置、浏览记录全部保存在本机**，Core 服务只绑定 `127.0.0.1`，不对外网开放
- 仅岗位描述（JD）与必要的提示词会发送给你选择的 LLM API
- 无遥测、无统计上报、无云端服务器。详见 [docs/privacy.md](docs/privacy.md)

## 🔄 自动更新（OTA）

- **插件**：每次打开 popup 自动检查仓库 `version.json`（每日一次），有新版本在 popup 顶部提示
- **本地 Core**：启动时 + 每 6 小时检查一次新版本，结果在 `/health` 与 setup 页显示；`start.bat` 每次启动前自动 `git pull` 拉取最新代码
- 将来插件上架 Chrome 商店后由浏览器自动静默更新

## 💝 支持项目

TomiHunt 永久免费开源（无广告、无遥测）。如果你愿意支持作者持续开发，可以通过推广链接购买云服务（作者获得返佣，你的价格不变）或请作者喝咖啡——见 [docs/support.md](docs/support.md)。

## ⚖️ 法律与合规

TomiHunt 是**用户端本地增强工具**：只解析你正在浏览的页面，不做批量爬取；共享管线在代码层面硬性排除原始 JD 文本与个人信息（`buildSharedIntel` 只允许结构化标签与事实通过）。

- 免责声明与合规设计：[docs/LEGAL.md](docs/LEGAL.md)
- 侵权内容通知-删除流程：[TAKEDOWN_POLICY.md](TAKEDOWN_POLICY.md)

## 📁 项目结构

```
core/       本地 Core 服务（TypeScript · Hono · LLM Provider · JD 库/标签化/脱敏）
extension/  浏览器插件（Chrome/Edge MV3 · Vite）
docs/       使用指南、架构、隐私与合规文档
```

## 🤝 贡献

欢迎贡献！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 📄 License

[MIT](LICENSE) © 2026 Tomi-Job-Hunt contributors

---

## English

TomiHunt is an AI-powered job-hunting assistant for the Chinese job market
(Boss直聘 / 猎聘). A browser extension extracts job descriptions and sends
them to a **local** Core service that tags them with structured metadata and
writes high-response-rate greeting messages. Provider-agnostic: Claude,
DeepSeek, Kimi and Qwen all work out of the box. A decentralized,
accountless community-intel feed (structured facts only — never raw JD text)
is on the roadmap.

**Everything runs on your machine.** No cloud servers, no telemetry — only
the JD text and prompts you choose to send reach your LLM API.

- **Quick start**: `npm install`, copy `config.example.json` to
  `~/.tomi-job-hunt/config.json` and set a provider, then
  `npm start -w core` and `npm run build -w extension` (load `extension/dist/`
  unpacked). Full guide: [docs/usage.md](docs/usage.md).
- **Status**: Phases 0-1 shipped — Core service, JD store + LLM tagging,
  sanitize pipeline, and the extension MVP (zhipin closed loop + liepin
  extraction). See the roadmap above.
- **Privacy**: [docs/privacy.md](docs/privacy.md). **Legal**:
  [docs/LEGAL.md](docs/LEGAL.md) and [TAKEDOWN_POLICY.md](TAKEDOWN_POLICY.md).

## License

[MIT](LICENSE) © 2026 Tomi-Job-Hunt contributors
