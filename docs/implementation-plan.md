# TomiHunt 分阶段实现计划（无头插件 + 桌面 App）

> 目标版本：0.3.0 · 依据：[headless-agent-architecture.md](headless-agent-architecture.md) 的代码结构（§8）与 mockup（`docs/mockup/`）
> 技术栈（已确认）：Agent UI = **React + Vite**（与 TomiLite 一致）；桌面壳 = Electron；安装器 = electron-builder（NSIS）。
> 原则：**每阶段有可独立验证的产物**；先打通核心通信链路，再 UI，再壳；每阶段结束跑全量回归，不把问题带到下一阶段。

## 阶段总览

| 阶段 | 主题 | 核心产物 | 关键验收 |
|---|---|---|---|
| 0 | 基线快照 | git 基线 tag + 全量测试绿 | 三工作区测试全绿 |
| 1 | core 网关 + LLM 收窄 | `/agent` WS 路由、会话映射、Ack；只留 DeepSeek | WS 协议脚本全通过；旧功能不回归 |
| 2 | extension 无头化 | 删面板 UI + 后台 SW 全链路 | 页面零操作 UI；控制台→插件→页面全链路可发消息 |
| 3 | Agent UI（React+Vite） | 悬浮窗 JD 工作台（左 JD 库 + 右聊天/匹配/面试/反馈 tab）+ 广告位 | 悬浮窗连网关完成「生成话术 → 发送 → 会话更新」闭环 |
| 4 | Electron 壳 + 安装器 | 桌面 App、登录自启、托盘、NSIS 安装包 | 干净机装 App + 插件 → 全链路可用；卸载干净 |
| 5 | 收尾发布 | usage.md、版本、发布验证 | 完整验收矩阵通过 |

---

## 阶段 0：基线快照（0.5 天）

**目标**：确立"不回归"的参照系。

**动作**：
- `npm test -w core`、`npm test -w extension`、`npm test -w hr` 全绿；
- 记录失败/警告项（若有）；
- `git tag tomi-0.2.0-baseline`（含 git status 里的未提交改动先提交或说明）。

**验收**：三个工作区测试命令零失败；基线 tag 存在。

---

## 阶段 1：core 网关 + LLM 收窄（后端先行，2-3 天）

**目标**：core 具备「无头插件 Agent 通道」，并只适配 DeepSeek。

**改动文件**（对应架构 §8）：
| 文件 | 内容 |
|---|---|
| `core/src/ws/agent/types.ts` | 协议：`AgentMsg{hello, session, ping, ack}` / `ConsoleMsg{send}` / `Ack{requestId, ok, error?, domSnippet?}` / `failed{tab-closed\|tab-idle\|selector-failed\|tab-offline}` |
| `core/src/ws/agent/sessions.ts` | `Target_ID ↔ {tabId, connectionId, lastSeen}` 映射：增删查、跨 Tab 去重、离线标记；**连接断开→宽限期(60s)→清扫（浏览器崩溃兜底，不依赖 onRemoved/onUpdated）** |
| `core/src/ws/agent/router.ts` | 指令路由：目标在线直发；**离线入缓冲(TTL≈30s, 有界, 丢最旧) → SW 重连 flush → 再起 5s Ack 时钟** → 归集 Ack |
| `core/src/ws/agent/timeout.ts` | Ack 超时（5s，自实际下发起算）→ `failed{tab-closed\|tab-idle\|selector-failed\|tab-offline}` |
| `core/src/ws/server.ts` | 挂载 `/agent` WS 路由（复用现有 Hono app） |
| `core/src/index.ts` | `TOMI_AS_CHILD=1` 时 fork 模式：不自动开浏览器、供 Electron 子进程管理 |
| `core/src/config.ts` / `llm/factory.ts` | LLM 收窄：claude 依赖挪 `optionalDependencies` + 动态 `import`；`PROVIDER_ENUM`/presets 保留供未来扩展 |
| `core/src/http/setup.ts` | 向导只显示 DeepSeek 入口 |

**验收标准**：
1. 自动：`npm test -w core` 全绿（含新增 `ws/agent/*` 单测：映射增删/去重/超时分类/**缓冲 TTL/flush**/**断连宽限清扫**）；
2. 手动 WS 协议脚本（新增 `scripts/ws-agent-check.mjs`）：
   - 连接 `/agent` → `hello` → 注册 `session{targetId,tabId}` → `ping`/`pong`；
   - 模拟控制台 `send{requestId,targetId,text}` → 路由到该连接 → 模拟 content 回 `ack{requestId,ok:true}` → 控制台侧收到 ok；
   - 不回 Ack → 5s 后控制台侧收到 `failed`，原因可分类；
   - 断开连接 → `sessions` 该 target 标记离线；
   - **离线缓冲**：断开 target 连接后发 send → 控制台侧收「等待中」→ 重新注册 session → 缓冲指令自动下发 → 收到 ok；
   - **缓冲超时**：不重连 → TTL(30s) 后收 `failed{tab-offline}`；
   - **脏映射清理**：注册 session → 断开且不重连 → 宽限期(60s)后 `sessions` 查询该 target 消失。
3. 回归：`/health`、`/v1/jd/*`、`/v1/greeting`、`/setup` 行为不变；`/setup` 只显示 DeepSeek。

**风险**：LLM 收窄动 `factory.ts`（动态 import）可能影响现有 provider 路径 → 用现有单测覆盖；`TOMI_AS_CHILD` 不影响默认启动路径。

---

## 阶段 2：extension 无头化 + 后台 SW 全链路（3-4 天）

**目标**：插件剥离全部用户操作 UI；SW 连网关完成「会话上报 → 指令分发 → 页面执行 → Ack」。

**改动文件**：
| 文件 | 内容 |
|---|---|
| `content/shared.ts` | 删除面板渲染（`ensurePanel`/`showPanel`/`setPanelHtml`/`PANEL_CSS`/`SUPPORT_URL` 迁 App）；保留 `fillChatBox`/`observeChatMessages`/方向检测/提取 |
| `content/zhipin-list.ts` | 高亮：`data-tomihunt-scored` → `WeakMap<Element, score>`，通用类名 |
| `content/zhipin-chat.ts` | 上报 `chatTargetId`（聊天 URL / DOM 中的 HR 标识）+ 新消息上报 |
| `content/agent-client.ts` | 执行入口：`chrome.runtime.onMessage` → 填值/点击 → `Ack{ok,error?,domSnippet}` |
| `background/index.ts` | SW 入口：注册 alarms/runtime/tabs 监听，启动 ws-client |
| `background/ws-client.ts` | WS 连候选端口 `[34567..34570]` 轮询（扩展沙箱读不到 `core-port.json`），断线指数退避重连；`host_permissions` 已含 `ws://127.0.0.1/*` 覆盖全部候选端口 |
| `background/heartbeat.ts` | `chrome.alarms` 30s 唤醒：保 WS + `ping`；配合 content script 低频 `runtime.sendMessage` 按需唤醒（缩睡眠间隙，可选增强） |
| `background/sessions.ts` | `tabs.query` + `onRemoved/onUpdated` 增量 → 上报网关 |
| `background/dispatch.ts` | 收网关指令 → `chrome.tabs.sendMessage` → 等 Ack（超时）→ 回网关 |
| `public/manifest.json` | 移除 `options_page`；`action` 无 popup（`onClicked` 唤起/展开悬浮窗，待确认）；permissions 增 `alarms`、`tabs` |

**验收标准**：
1. 自动：`npm test -w extension` 全绿——现有 content 测试（`fillChatBox`/`reply-observer`）适配无 UI 后保持；新增 background 测试用 mock `chrome`（ws-client 重连、dispatch 超时、sessions 上报）；
2. 手工加载 unpacked：
   - 列表页只显示匹配度小标记，**无浮动按钮/面板**；聊天页**零 UI**；
   - DevTools Network 看不到 content script 的额外 DOM 痕迹（面板相关 DOM 不存在）；
3. 全链路（配合阶段 1 的网关）：
   - SW 连上 `/agent`，上报活跃会话，网关 `sessions` 有记录；
   - `ws-agent-check.mjs` 模拟控制台 `send` → 页面聊天框被填入话术并点击发送 → Ack `ok` 回网关；
   - 关掉目标 Tab → 网关映射移除 → 模拟 send → `failed{tab-closed}`；
   - 停网关 → SW 断开 → 30s 内 alarms 唤醒重连（观察日志）；
   - **端口漂移**：预占 34567 重启 core → 端口顺延 34568 → 插件自动轮询连上新端口并恢复会话上报；
   - **休眠期缓冲**：SW 休眠断开期间 send → 网关缓冲 → SW 唤醒重连 → 缓冲指令自动下发执行（不丢失）；
4. 回归：岗位页 JD 提取、聊天监听仍工作（日志可查）。

**风险**：删面板影响现有测试断言（大量用例依赖面板 DOM）→ 先删 UI 再改测试，保留核心函数单测；`chrome.alarms` 在开发机最小 30s 周期验证较慢 → 提供 `TOMI_HEARTBEAT_MS` 测试覆写。

---

## 阶段 3：Agent UI（React + Vite 独立应用，3-4 天）

**目标**：悬浮窗 JD 工作台实现 mockup——左侧 JD 库 + 右侧选中 JD 的并行功能 tab（聊天 / 简历匹配 / 模拟面试 / 反馈）；开发态作为独立 Vite 应用直连 `127.0.0.1:34567`。

**改动文件**（对应架构 §8 `app/src/renderer/`）：`main.tsx` / `App.tsx` / `lib{gateway,api,llm,store}` / `pages{JdList,ChatPanel,MatchPanel,InterviewPanel,FeedbackPanel,SettingsPanel}` / `components{WindowFrame,Tag,ScoreRing,PitchEditor,GatewayBadge}` / `vite.config.ts`。

**验收标准**：
1. `vite dev` 启动，与 [agent-ui.html](mockup/agent-ui.html) 一致：
   - 左侧 JD 库：搜索/筛选/⚡分/选中态，数据来自 `GET /v1/jd`（浏览时自动收集，非浏览器镜像）；
   - 选中 JD → 右侧四 tab 并行：
     - 💬 聊天：气泡（`WS /agent` 推送实时渲染）+ 话术（`/v1/greeting` 或 `lib/llm.ts`，80-120 字校验）+ 发送 + 👍👎；
     - 📄 简历匹配：分环 + 优势/差距/避坑 + 技能标签（`/v1/match`），可「生成话术并发送」「开始模拟面试」「打开该会话」；
     - 🎤 模拟面试：基于选中 JD + 简历，逐题问答 → AI 点评（`lib/llm.ts` 或新增 `/v1/interview`）+ 历史；
     - 💬 反馈：匿名 👍👎 + 标签 + 备注 + 本 JD 反馈历史，落到现有反馈通道（`submitFeedback` 同 payload）；
2. 发送链路：点「发送」→ 网关 →（阶段 2 的插件）→ 页面发出 → 会话流更新 + 「已发送」；目标会话未打开 → 按钮禁用 + 提示；离开聊天页 → 折叠成胶囊；
3. 跟随活跃 Tab：浏览器当前 JD 聊天 → 左侧该项自动高亮 + 右侧自动切到该 JD；
4. 窗头 ⚙️ 设置浮层：DeepSeek Key/模型（**含获取 API Key 三步指引**）、简历上传、登录自启、悬浮窗置顶、插件管理；
5. 直连 DeepSeek（`lib/llm.ts`）在无 core provider 配置时单独可用；广告位在窗口底部渲染（占位链接，含 **社区入口**）。

**风险**：React 组件测试需要 jsdom + mock gateway/api → 组件只测纯渲染与 store 逻辑，通信 mock；真实通信靠手工验收。窗口置顶/无边框视觉在阶段 4 的 Electron 里验证，阶段 3 用普通浏览器窗口即可。

---

## 阶段 4：Electron 壳 + 安装器（3-4 天）

**目标**：把 core + Agent UI 打包成可安装桌面 App；登录自启、托盘、卸载干净。

**改动文件**：
| 文件 | 内容 |
|---|---|
| `app/src/main/main.ts` | 单例锁、悬浮窗 BrowserWindow（`frame:false` + `alwaysOnTop` + `skipTaskbar`、记住位置）、生命周期、登录自启（`setLoginItemSettings`）、崩溃兜底 |
| `app/src/main/core-host.ts` | fork `core/dist/index.js`（`TOMI_AS_CHILD=1`）：启动/看门狗/日志 |
| `app/src/main/protocol.ts` | `tomihunt://` 注册（HKCU）+ 唤起处理 |
| `app/src/main/install-guide.ts` | 复制插件→固定目录、打开 `chrome://extensions`、首启流程 |
| `app/src/main/tray.ts` / `preload.ts` | 托盘菜单 / IPC 桥 |
| `app/electron-builder.yml` | NSIS：per-user、图标、产物 `TomiHuntSetup.exe` |
| `scripts/pack.mjs` | 构建管线：build core → build renderer → electron-builder --win（仿 TomiLite `pack`） |
| extension 插件自移除 | `core-seen` 标记 + `uninstallSelf` 按钮（App 设置页触发） |

**验收标准**：
1. `npm run pack` 产出 `TomiHuntSetup.exe`（NSIS）；
2. 干净机（无 Node）：
   - 装 App → core 子进程起 → `http://127.0.0.1:34567/health` ok → Agent UI 窗口打开；
   - 安装器把插件复制到固定目录并打开 `chrome://extensions` → 加载后全链路（阶段 2+3 场景）可用；
3. 登录自启：开关生效（重启/注销再登录 App 自启）；关闭窗口收托盘；
4. 卸载：App 停、core 子进程结束、登录自启项与 `tomihunt://` 清除、文件删除；插件仍在 → 探测网关消失 → App 设置提示一键移除；
5. 升级覆盖安装 → 数据（`~/.tomi-job-hunt/`）保留；
6. 悬浮窗形态：无边框置顶（浮在浏览器上方）、窗头可拖动、JD 工作台 / 折叠胶囊切换、关闭收托盘、记住位置。

**风险**：electron-builder 首次打包需下载 Electron 二进制；NSIS per-user 安装路径；AV 误报属已知限制（架构 §14）。

---

## 阶段 5：收尾发布（1 天）

**动作**：重写 `docs/usage.md`（安装 App + 加载插件 + 控制台操作流）；版本号统一 `0.3.0`；`version.json` 更新；`scripts/package.py` 调整；清理废弃脚本（`install-core.bat`/`launch-core.bat`/`install-extension.bat` 的处置）。

**验收**：发布验证矩阵全过：
1. 全新装机（无 Node）走完安装 → 使用 → 卸载全程；
2. 登录自启 / 单实例 / 端口冲突 / 网关断连重连；
3. 三工作区测试全绿；`isTrusted` 与开发者模式限制已如实写入 README/FAQ。

---

## 阶段间依赖

```
阶段0 → 阶段1（core 网关）→ 阶段2（插件无头全链路）→ 阶段3（Agent UI 接网关）
                                                          ↓
阶段4（Electron 壳打包 core+UI）→ 阶段5（发布）
```

阶段 2 可用阶段 1 的 `ws-agent-check.mjs` 作为控制台替代验收，无需等 UI；阶段 3 直接连 core，无需 Electron。

## 待确认（不影响阶段 1-2 开工）

- 架构 §10 待确认：action 行为、截图权限、高亮强度、会话同步范围。
- 安装器 §15：electron-updater 本轮是否做；代码签名本轮是否做。
- **社区入口（已定方向，URL 待定）**：未来社区平台入口两处——tomatovector.com 导航加「社区」tab（占位）；Agent UI 底部广告条加社区链接。URL 未定前用占位。

已确认（架构 §10）：Agent UI 技术栈 React+Vite；Agent UI 为 **OS 级无边框置顶悬浮窗**（跟随活跃 Tab，离开聊天页折叠成胶囊）；Agent UI **以 JD 为单位**（左侧 JD 库 + 右侧选中 JD 的并行功能 tab：聊天 / 简历匹配 / 模拟面试 / 反馈）。

建议：**先做阶段 0 + 阶段 1**（后端网关 + LLM 收窄，改动收敛、验收明确），同时把上面的待确认定了，再进入阶段 2。
