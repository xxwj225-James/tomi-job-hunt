# 使用指南

两种使用方式，按需选择：

- **方式一 · 直连模式（推荐普通用户）**：只装浏览器插件 + 粘贴 API Key，**不需要 Node、不需要启动任何服务**。覆盖核心闭环（JD 提取 / AI 标签 / 打招呼语 / 打分 / 面试准备）。
- **方式二 · 完整模式（进阶用户）**：额外运行本地 Core 服务，解锁语义搜索、求职看板、岗位雷达、情报网。Windows 用户双击 `start.bat` 即可，无需命令行。

---

## 方式一：直连模式（5 分钟上手）

1. 下载 Releases 中的 `extension.zip` 并解压（开发者可自行 `npm run build -w extension`）
2. `chrome://extensions`（Edge 为 `edge://extensions`）→ 开启**开发者模式** → **加载已解压的扩展程序** → 选择解压目录
3. 点击工具栏 🤖 图标 → **⚙️ 设置** → 选择服务商（DeepSeek / Kimi / Qwen / Claude）→ 粘贴 API Key → **保存并测试连接**
4. 打开 Boss 直聘岗位详情页 → 右下角 🤖 TomiHunt 面板自动工作；猎聘同理
5. 生成打招呼语后点「立即沟通」，在聊天页一键填入

API Key 获取地址：

| 服务商 | 地址 | 参考价格（输入/输出，每百万 token） |
|---|---|---|
| DeepSeek | platform.deepseek.com | ~¥0.5-2 / ~¥3-16 |
| Kimi | platform.moonshot.cn | ~¥4-8 / ~¥16-30 |
| Qwen | 阿里云百炼 bailian.console.aliyun.com | 免费额度 + 按量 |
| Claude | console.anthropic.com | $0.8-3 / $4-15 |

> Key 只保存在本机浏览器（chrome.storage.local），不发往任何中间服务器。

---

## 方式二：完整模式

## 第 1 步：环境准备

| 依赖 | 要求 |
|---|---|
| Node.js | ≥ 20（`node --version` 确认） |
| 浏览器 | Chrome 或 Edge |
| LLM API Key | 任选一家：Claude / DeepSeek / Kimi / Qwen（没有 key 也可先跑通服务，只是 AI 功能不可用） |

克隆并安装依赖：

```bash
git clone https://github.com/<your-name>/tomi-job-hunt.git
cd tomi-job-hunt
npm install
```

## 第 2 步：配置 LLM

### 方式 A：配置文件（推荐）

```bash
# 创建配置目录（Windows Git Bash / Linux / macOS 通用）
mkdir -p ~/.tomi-job-hunt

# 把仓库里的样例配置复制进去，然后编辑
cp config.example.json ~/.tomi-job-hunt/config.json
```

Windows 用户：`~` 即 `C:\Users\你的用户名`，完整路径为
`C:\Users\你的用户名\.tomi-job-hunt\config.json`。

编辑 `config.json`，选一家提供商：

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "apiKey": "sk-你的密钥"
}
```

### 可选提供商一览

| provider | 默认模型 | API Key 获取 | 特点 |
|---|---|---|---|
| `deepseek` | deepseek-v4-flash | platform.deepseek.com | 国内直连、成本最低；重任务可换 deepseek-v4-pro |
| `kimi` | kimi-k2.6 | platform.moonshot.cn | 可换 kimi-k2.7-code / kimi-k3 |
| `qwen` | qwen3.7-plus | 阿里云百炼（Model Studio） | 可换 qwen3.8-max（仅思考模式） |
| `claude-code` | claude-sonnet-5 | Anthropic | Agent 能力最强；也可直接 `claude login` 后用订阅凭据 |
| `claude-api` | claude-sonnet-5 | Anthropic | Messages API 直连，轻量便宜 |
| `openai-compatible` | 需手动指定 | — | 任意 OpenAI 兼容端点（自建网关、OneAPI、Ollama 等） |

### 方式 B：环境变量（也可两者混用）

```bash
export TOMI_PROVIDER=deepseek
export TOMI_API_KEY=sk-你的密钥
# 可选覆盖：
# export TOMI_MODEL=deepseek-v4-pro
# export TOMI_BASE_URL=https://自定义网关/v1
# export TOMI_PORT=3000
```

Claude 系（claude-code / claude-api）用 `ANTHROPIC_API_KEY`。

### 配置项完整参考

| config.json 字段 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `provider` | `TOMI_PROVIDER` | `claude-code` | 见上表 |
| `model` | `TOMI_MODEL` | 按 provider | 模型 ID，任意字符串 |
| `apiKey` | `TOMI_API_KEY` / `ANTHROPIC_API_KEY` | — | 也可以不放文件里，只用环境变量（更安全） |
| `baseUrl` | `TOMI_BASE_URL` | 按 provider 预设 | 预设：deepseek/kimi/qwen 已内置正确地址 |
| `thinking` | — | `false` | DeepSeek/Qwen 思考模式。默认关：更快更省、JSON 输出稳定 |
| `maxTokens` | — | 4096 | 单次输出上限（另有 provider 上限：deepseek 16000，其他 8192） |
| `temperature` | — | — | 0~2；deepseek 思考模式下无效 |
| `concurrency` | `TOMI_CONCURRENCY` | 2 | 并发 LLM 调用数；claude-code 每次调用会起一个子进程，不建议调太高 |
| `port` | `TOMI_PORT` | 3000 | 仅绑定 127.0.0.1 |
| `logLevel` | `TOMI_LOG_LEVEL` | `info` | debug / info / warn / error |

优先级：环境变量 > config.json > 内置默认。

## 第 3 步：配置简历（重要，直接影响话术质量）

```bash
# 把模板复制到配置目录，按真实经历填写
cp docs/resume.template.md ~/.tomi-job-hunt/resume.md
```

也支持直接把你的简历文件放进配置目录，Core 会自动解析（全部在本机完成，不上传）：

| 文件名 | 格式 | 解析方式 |
|---|---|---|
| `resume.md` / `resume.txt` | Markdown / 纯文本 | 直接读取（优先） |
| `resume.docx` | Word 文档 | 本机解析（mammoth） |
| `resume.pdf` | PDF | 本机解析（pdfjs；扫描件图片无法提取文本） |

优先级：`md > txt > docx > pdf`。没有简历也能用——话术会按 JD 通用生成，并提示你配置简历。模板见
[docs/resume.template.md](resume.template.md)。

## 第 4 步：启动 Core 服务

**Windows 用户**：直接双击项目根目录的 `start.bat` 即可（自动检测 Node、自动安装依赖、保持窗口运行即可）。关闭窗口即停止服务。

**命令行方式**：

```bash
# 日常使用（不监听文件变化）
npm start -w core

# 开发模式（文件变化自动重启）
npm run dev -w core
```

看到 `listening on http://127.0.0.1:3000 (provider: deepseek, ...)` 即启动成功。验证：

```bash
curl http://127.0.0.1:3000/health
# {"ok":true,"provider":"deepseek",...}
```

> Windows 首次启动若弹出防火墙提示，选择「允许访问」或直接取消均可——
> 服务只绑定本机 127.0.0.1，不需要外网入站。

## 第 5 步：构建并加载浏览器插件

```bash
npm run build -w extension
```

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本仓库的 `extension/dist/` 目录
4. 确认插件图标出现在工具栏

> 每次改动插件代码后重新 `npm run build -w extension`，再到扩展管理页点刷新。

---

## 使用流程

### Boss 直聘：完整闭环

1. **浏览岗位详情页**（`zhipin.com/job_detail/xxx.html`）——右下角出现 **🤖 TomiHunt** 浮动按钮
2. 插件自动导入 JD 并调用 AI 打结构化标签（技术栈 / 年限 / 学历 / 工时 / 风险词），完成后在面板中展示
3. 点击 **生成打招呼语** —— 80~120 字，结合你的本地简历直击 JD 硬性要求
4. 点击 **立即沟通** 进入聊天页 —— 话术已自动带到聊天页
5. 点击面板上的 **填入聊天框**，确认后按 Enter 发送

### 猎聘：JD 提取

浏览猎聘岗位详情页，插件自动提取并导入（猎聘无聊天框场景，不做话术生成）。

### 本地 API 使用（不装插件也能用）

| 端点 | 说明 |
|---|---|
| `GET /health` | 健康检查（provider / 队列状态） |
| `POST /v1/chat` | 通用对话（走所选 provider） |
| `POST /v1/jd/capture` | 存 JD + 异步打标签（202，结果经 `/ws` 推送 `jd/tagged`） |
| `POST /v1/jd/tag` | 同步标签化（调试用） |
| `GET /v1/jd` | 最近 JD 记录（`?limit=20`） |
| `GET /v1/jd/search?tags=java&workHours=双休` | 标签粗筛 |
| `GET /v1/jd/:jobUid` | 单条记录 + 社区报告 |
| `POST /v1/jd/:jobUid/report` | 提交结构化岗位报告（本地存储，自动脱敏） |
| `POST /v1/jd/semantic-search` | 自然语言语义搜索（`{"query":"不用加班、懂 RAG 的后端"}`） |
| `POST /v1/match` | 匹配度打分 0-100 + 优势/短板/避坑诊断 |
| `POST /v1/greeting` | 生成打招呼语（自动读取本地简历文件） |
| `POST /v1/interview-prep` | 预测 5-10 道面试题 + STAR 建议 |
| `POST /v1/resume/tailor` | 按 JD 定制简历（Markdown） |
| `POST /v1/resume/export` | 导出定制简历（`format: md / doc`，Word 可直接打开 .doc） |
| `GET/POST /v1/board` | 求职看板（本地 Kanban：已打招呼→已投递→面试→Offer） |
| `POST /v1/hunt/companies` | 技能 → 目标公司清单（含直连渠道建议） |
| `POST /v1/hunt/cold-email` | 生成直连自荐冷邮件 |
| `WS /ws` | 任务生命周期事件（queued → started → done / error / jd/tagged） |

示例：

```bash
# 捕获一条 JD（自动异步打标签）
curl -X POST http://127.0.0.1:3000/v1/jd/capture \
  -H "Content-Type: application/json" \
  -d '{"source":"manual","url":"https://example.com/job/1","title":"高级后端工程师","company":"某某科技","salaryText":"20-30K·14薪","requirements":"熟悉 Java、K8s，3-5 年经验，本科以上"}'

# 语义搜索本地 JD 库
curl -X POST http://127.0.0.1:3000/v1/jd/semantic-search \
  -H "Content-Type: application/json" \
  -d '{"query":"找一个不用加班、深入懂 RAG 但对学历要求不严的后端岗位"}'

# 匹配度打分
curl -X POST http://127.0.0.1:3000/v1/match \
  -H "Content-Type: application/json" \
  -d '{"jd":{"title":"高级后端工程师","company":"某某科技","salaryText":"20-30K","requirements":"熟悉 Java、K8s"}}'
```

## 进阶功能

### 隐形岗位日报（Job Watchdog）

聚合非传统招聘渠道（Hacker News Who-is-hiring / V2EX 酷工作 / GitHub 招聘仓库），AI 抽取结构化岗位，生成 Markdown 日报 + Windows 桌面通知：

```bash
npm run watch -w core
# 日报写入 ~/.tomi-job-hunt/digest/YYYY-MM-DD.md
# 已看过的帖子自动去重（watchdog-state.json）
```

> 适合配合系统计划任务（Windows 任务计划程序 / cron）每日定时执行。

### 去中心化情报网（Intel Network）

匿名共享结构化求职情报（真实薪资、外包真相、HR 刷 KPI），零注册、零服务器：

```bash
npm run intel -w core export      # 把本地脱敏情报合并到 data/intel-feed.json
npm run intel -w core keygen      # 生成专用 Nostr 密钥对（仅用于情报共享）
npm run intel -w core publish     # 发布本地情报到 Nostr relay
npm run intel -w core subscribe   # 订阅社区情报
```

- **贡献情报**：在 GitHub Issue 里用「Job intel report」模板提交（纯勾选事实，无自由文本）
- **共享边界**：只共享结构化标签与事实，原始 JD 文本 / HR 姓名 / 联系方式在代码层被硬性排除
- 完整架构与部署说明：[docs/intel-network.md](intel-network.md)

---

## 常见问题（FAQ）

| 现象 | 原因与解决 |
|---|---|
| 面板提示「无法连接本地 Core 服务」 | Core 没启动：`npm start -w core`；或端口被占用（见下一条） |
| 启动报 `EADDRINUSE` | 端口被占：`netstat -ano \| findstr :3000` 找到 PID 后 `taskkill /PID <pid> /F`，或改 `TOMI_PORT` |
| 启动即退出，报缺少 API Key | config.json 的 `apiKey` 没填，或 `TOMI_API_KEY` 没导出；provider 与 key 的对应关系见第 2 步 |
| 面板标签化失败 | 检查 Core 日志（`logLevel: "debug"` 可看细节）；多为 LLM 输出格式异常，会自动重试 1 次 |
| 岗位页没有出现浮动按钮 | 只支持岗位详情页（`job_detail/*`）；确认插件已加载且页面已登录；刷新试试 |
| 提取的薪资是乱码/不对 | Boss 直聘薪资有动态字体反爬，插件优先走 API 取明文；若 API 路径失效，反馈 issue |
| 填入聊天框没反应 | 先点「立即沟通」进入聊天页，等聊天窗口完全加载后再点「填入聊天框」；仍未生效请把页面结构反馈到 issue |
| 猎聘提取不到内容 | 详情内容为 AJAX 注入，插件会轮询等待 8 秒；仍为空请把 DevTools 中的实际 class 反馈到 issue |
| 切换模型后没生效 | 重启 Core；或确认 `TOMI_MODEL` 覆盖了 config.json |

---

## English Quick Reference

1. **Prereqs**: Node.js ≥ 20, Chrome/Edge, an LLM API key (Claude / DeepSeek / Kimi / Qwen).
2. **Install**: `git clone … && cd tomi-job-hunt && npm install`
3. **Configure**: `cp config.example.json ~/.tomi-job-hunt/config.json`, set
   `provider`, `model`, `apiKey` (see provider table above). Env-var
   alternative: `TOMI_PROVIDER` / `TOMI_API_KEY` / `TOMI_MODEL`.
4. **Resume (optional but recommended)**: `cp docs/resume.template.md ~/.tomi-job-hunt/resume.md`
5. **Run Core**: `npm start -w core` → `curl http://127.0.0.1:3000/health`
6. **Build & load extension**: `npm run build -w extension` →
   `chrome://extensions` → Developer mode → Load unpacked → `extension/dist/`
7. **Use**: open a zhipin job detail page → TomiHunt panel auto-imports and
   tags the JD → generate a greeting pitch → 立即沟通 → fill the chat box.
   Liepin detail pages are extracted the same way (no pitch step).
