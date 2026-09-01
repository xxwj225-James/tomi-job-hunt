# TomiHunt 无头插件 + 独立控制台架构

> 状态：设计稿（未实现）· 目标版本：0.3.0
> 核心转向：浏览器插件**剥离全部用户操作 UI**（无头化），只做"传感器 + 执行器"；Agent UI 是 **Electron 桌面 App**（仿 TomiLite，用户安装），窗口形态为 **OS 级无边框置顶悬浮窗**——浮在浏览器上方，用户浏览时 agent 同时操作。
> Agent UI 以 **JD 为单位**：左侧 JD 库列表（浏览时自动收集），选中一个 JD → 右侧是该 JD 的并行功能 tab（聊天 / 简历匹配 / 模拟面试 / 反馈）。翻看岗位仍在浏览器（⚡匹配 小标记），JD 库是本地工作台导航，**非浏览器镜像**。**广告位**在窗口底部。
> UI mockup 见 `docs/mockup/`；安装/卸载方案见 [installer-design.md](installer-design.md)。

## 1. 架构图

### 1.1 系统架构（运行态进程与通信）

```
┌────────────────────────────────────────────────────────────────────────┐
│  TomiHunt 桌面 App（Electron · 用户安装 · 登录自启 · 托盘常驻）             │
│                                                                        │
│  ┌─────────────────────────┐        ┌────────────────────────────────┐ │
│  │ 主进程 main.ts            │        │ core 子进程（网关 + Agent API）   │ │
│  │ 悬浮窗(frame:false+置顶)   │        │ ws://127.0.0.1:34567/agent     │ │
│  │ 托盘/单例/登录自启        │──fork──▶│ REST /v1/*（JD/匹配/看板/简历）  │ │
│  │ fork core · 安装引导      │        │ LLM provider（DeepSeek）       │ │
│  │ tomihunt:// 处理          │        │ Session 映射表 · Ack 超时       │ │
│  └─────────────────────────┘        └───────────────▲────────────────┘ │
│  ┌─────────────────────────┐                      │ ws/agent          │
│  │ 渲染进程 Agent UI         │                      │                   │
│  │ OS级悬浮窗(无边框·置顶)    │──REST+WS──▶ 127.0.0.1:34567（同上）      │
│  │ JD工作台: 左JD库+右功能tab │                      │                   │
│  │ （聊天/匹配/面试/反馈）     │                      │                   │
│  └─────────────────────────┘                      │                   │
└────────────────────────────────────────────────────┼───────────────────┘
                                                      │ ws://127.0.0.1:34567/agent
┌─────────────────────────────────────────────────────▼───────────────────┐
│  浏览器扩展（无头 · MV3）                                                │
│  ┌────────────────────────────┐      ┌───────────────────────────────┐  │
│  │ Background (Service Worker) │      │ Content Script（每页一个）       │  │
│  │ WS 保活/重连 · 会话上报      │      │ 静默监听（JD/新消息/会话 id）     │  │
│  │ 指令分发 chrome.tabs.send    │──▶  │ 隐形执行（原生 DOM 填值 + 点击）  │  │
│  └────────────────────────────┘      └───────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

**关键点**：
- **网关不在主进程**——直接扩展 core 子进程的 `ws/server.ts` 加 `/agent` WS 路由（core 已有 `/ws` 与 Hono 服务）。插件与 Agent UI 都连同一个 `127.0.0.1:34567`，主进程只做"壳"（悬浮窗/托盘/自启/生命周期），减少一层跳转、最大化复用 core。
- Agent UI（渲染进程）是标准 localhost Web 应用（REST + WS 连 core），与 TomiLite `apps/web` 连本地 API 同构。
- **Agent UI 窗口 = OS 级悬浮窗 + JD 工作台**：`frame:false` + `alwaysOnTop` + `skipTaskbar`，浮在浏览器上方；左侧 **JD 库**（浏览时自动收集，非浏览器镜像）+ 右侧选中 JD 的并行功能 tab（聊天 / 简历匹配 / 模拟面试 / 反馈）+ 窗头 ⚙️ 设置浮层；离开聊天页自动折叠成胶囊。跟随活跃 Tab：浏览器当前打开的 JD 自动高亮并切换。

### 1.2 部署形态（安装后）

```
TomiHuntSetup.exe（electron-builder NSIS）
├─ 安装 → %LOCALAPPDATA%\Programs\TomiHunt\   Electron App（TomiHunt.exe + resources\app\）
├─ 安装 → %LOCALAPPDATA%\TomiHunt\extension\  无头插件固定目录（Chrome 按此目录识别实例）
├─ 注册 → HKCU tomihunt://                    → App（外部唤起）
└─ 引导 → 打开 chrome://extensions             → 开发者模式 → 加载已解压
```

### 1.3 一次「发送」时序

```
Agent UI            core /agent（网关）     插件 SW            Content Script
   │   POST /v1/send {target,text}             │                   │
   ├──────────────────▶│  查映射表 target→tabId  │                   │
   │                   ├─────────指令 {requestId,text}─────────▶│ 填值+点击
   │                   │                                          │
   │                   │◀─────Ack {requestId,ok,error?,dom}───────┤
   │                   │  5s 超时→ failed{tab-closed|tab-idle|     │
   │                   │        selector-failed}                   │
   │◀──Ack {ok|failed}─┤                   │                        │
   │◀──WS 推送「消息已发送/对方回复」───────────────────────────│ MutationObserver
```

## 2. 模块职责

| 模块 | 形态 | 职责 | 技术实现 |
|---|---|---|---|
| Agent UI（悬浮窗 JD 工作台） | Electron 渲染进程（React/Vite），OS 级无边框置顶悬浮窗 | 以 JD 为单位：左侧 JD 库（浏览时自动收集）+ 右侧选中 JD 的并行 tab（聊天 / 简历匹配 / 模拟面试 / 反馈）；简历管理、LLM 配置（含 Key 获取指引）、**广告位** | `app/src/renderer/`；直连 DeepSeek 能力保留 |
| 网关 + Agent API | core 子进程 | `/agent` WS：Session 映射表、ping/pong、指令路由、Ack 超时；REST `/v1/*` 全部现有能力 | `core/src/ws/server.ts` 扩展 + `ws/agent/*` |
| 主进程（壳） | Electron 主进程 | 窗口/托盘/单例/登录自启/fork core/安装引导/tomihunt:// | `app/src/main/*` |
| 插件 Background | MV3 Service Worker | WS 连 `/agent`、心跳保活、会话上报、指令分发 + Ack | `extension/src/background/*` + `chrome.alarms` |
| Content Script | 无头，按 matches 注入 | 静默监听上报；执行原生 DOM 填值/点击并 Ack | `extension/src/content/*`（删 UI 后保留） |

## 3. 通信链路（一次「生成话术并发送」）

1. 用户浏览 Boss 直聘岗位页 → Content Script 静默提取 JD + 会话标识 `chatTargetId` → `chrome.runtime.sendMessage` → SW → WS → core 网关 → Agent UI；
2. Agent UI 展示 JD，调 LLM 打标签/匹配（core provider 或直连 DeepSeek）；
3. 用户点「生成打招呼语」→ Agent UI 调 LLM → 展示（可反复修改）；
4. 用户点「**发送**」→ Agent UI → 网关 → 查映射表找 `tabId` → 下发 `{requestId, text}` → SW → `chrome.tabs.sendMessage(tabId)` → Content Script 执行 `fillChatBox` + 点击发送 → `Ack {requestId, ok, error?}` 原路返回 Agent UI 更新会话状态；
5. Content Script 的 `MutationObserver` 监听到对方新消息 → 上报 → Agent UI 会话流实时更新 → 可选「智能回复」生成 → 回到第 4 步。

## 4. 关键工程难点

### 4.1 MV3 Service Worker 保活（心跳）

- SW 约 30s 空闲休眠，休眠时 JS 状态（含 WS）全丢；
- **保活**：`chrome.alarms`（最小 30s）周期性唤醒 SW → 确保 WS 已连（断则退避重连）→ 发 `ping`，网关回 `pong`；
- **网关兜底**：超时未收 ping → 标记该连接离线 → Agent UI 对应会话显示「不可用」并禁用发送；SW 重连后重新上报 Session（§4.2）；
- 诚实声明：SW 休眠无法根除，但 alarms + 重连让休眠对用户无感。

### 4.2 Session Mapping（Tab 页面映射）

- SW 连接建立后上报活跃会话：`chrome.tabs.query` 过滤聊天 URL + Content Script 上报的 `chatTargetId` → `{tabId, url, chatTargetId, domain}`；
- 网关维护 `Map<Target_ID, { tabId, connectionId, lastSeen }>`；跨 Tab 去重；
- 增量同步：`chrome.tabs.onRemoved` / `onUpdated`（离开聊天页）→ 上报网关更新/移除；
- **生命周期绑定连接（浏览器崩溃兜底）**：每个 Session 归属 `connectionId`。WS 异常断开 → 立即把该连接下全部 Session 标记离线（Agent UI 显示「不可用」并禁用发送）→ 宽限期（60s）内未重连（SW 重连会重报 Session 列表）→ 清扫删除。复用 ping 超时循环做周期清扫，防止浏览器崩溃（不触发 `onRemoved/onUpdated`）残留脏映射。

### 4.3 页面状态同步（Ack 不丢指令）

- 每条指令带 `requestId`；Content Script 执行完必回 Ack `{requestId, ok, error?, domSnippet?}`；
- 网关 5s 超时（**自实际下发时起算**）→ Agent UI 显示 `failed` + 原因分类：`tab-closed` / `tab-idle` / `selector-failed`；
- Agent UI 发送前先查映射：无目标 → 立即禁用发送并提示「该聊天窗口未打开」；
- **指令缓冲（SW 休眠期不丢发送）**：目标连接离线（SW 休眠/浏览器重启）时，`router.ts` 按目标入队缓冲——TTL ≈ 30s、有界、丢弃最旧；Agent UI 显示「等待插件唤醒…」；**flush-on-reconnect**：SW 重连并重报 Session 时，立即 flush 该目标缓冲指令，再启动 5s Ack 时钟；总时限 = 缓冲 TTL + 下发 + Ack；缓冲到期仍离线 → `failed{tab-offline}`（不丢指令，只明确失败）；

### 4.4 容错与可观测（黑盒不盲目）

- Content Script 异常捕获 → 上报错误类型 + 失败选择器 + 当前 DOM 片段（脱敏）；
- 可选执行截图：`chrome.tabs.captureVisibleTab`（需 `tabs`/`activeTab` + 截图 host 权限，待确认）→ 图片经网关回传 Agent UI 展示「失败现场」；
- 选择器漂移：沿用多候选策略（现有 `MSG_SELECTORS` / `CHAT_INPUT_SELECTORS`），"未命中"作为一级错误上报而非静默。

### 4.5 端口发现与重连（扩展侧轮询）

- **问题**：core 端口冲突会顺延 34567→34570，但 MV3 扩展沙箱**读不到本地 `~/.tomi-job-hunt/core-port.json`**，无法感知漂移；
- **方案**：`ws-client.ts` 维护候选端口 `[34567, 34568, 34569, 34570]`（与 core `PORT_RETRIES=4` 对齐）。连接失败按序尝试下一端口；整轮失败后指数退避重试；连上后固定该端口，异常断线重连时重新轮询；
- `host_permissions` 已含 `ws://127.0.0.1/*`，覆盖全部候选端口，**无需改 manifest**；
- **不对称提醒**：Agent UI（渲染进程）不轮询——经 preload/IPC 从主进程读 `core-port.json` 获得当前端口；只有扩展需要轮询。
- 可选增强（§4.1 配合）：聊天页 content script 低频 `chrome.runtime.sendMessage` 按需唤醒 SW，把有效唤醒延迟从 ≤30s 压到近 0——用户正浏览聊天页时点「发送」几乎即时，指令缓冲（§4.3）退化为纯兜底。

## 5. isTrusted 边界（诚实声明）

- Content Script `dispatchEvent` 的事件 `event.isTrusted === false`，真人操作为 `true`，**JS 无法伪造**；
- 已确认：发送走「自动填 + 自动点」→ **接受该风险**，缓解 = 行为克制（频率真人化、用户逐条在控制台确认、输入用原生 setter + `beforeinput → input → change` 正确序列——现有 `fillChatBox` 已实现）；
- **红线**：不绕过验证码、不伪装真人点击欺骗风控、不做「规避封号」功能。

## 6. Playwright 澄清（不需要）

Playwright 是 CDP 驱动框架，**无法运行在普通扩展 Content Script 中**（需自启浏览器，那就不叫浏览器插件，且是最强自动化检测特征）。「底层事件模拟」= 现有 `fillChatBox` 的原生 setter + InputEvent 序列，用于正确触发框架状态同步，不是绕过反作弊。**不引入 Playwright**。

## 7. 直连模式与网关必需

- 插件无 UI、只连网关 → **没有网关插件完全不工作** → 本地 App（网关）从「可选」变为**必需**；
- 直连能力上移：Agent UI 内保留「直连 DeepSeek / 走本地 provider」选择；
- 广告位在 App 内（底部/侧栏），沿用 `SUPPORT_URL` / `TOMILITE_URL`（推广返佣/打赏）迁入。

## 8. 代码结构（每个文件要实现的功能）

```
tomi-job-hunt/
├── app/                                    # 新增：Electron 桌面 App
│   ├── electron-builder.yml                # NSIS 打包配置：per-user、图标、产物 TomiHuntSetup.exe
│   ├── package.json                        # electron / electron-builder 依赖与 pack 脚本
│   └── src/
│       ├── main/
│       │   ├── main.ts                     # 主进程入口：单例锁、悬浮窗 BrowserWindow(frame:false+alwaysOnTop+skipTaskbar, 记住位置)、托盘、生命周期、登录自启(openAtLogin)、崩溃兜底
│       │   ├── core-host.ts                # fork core 子进程（node dist/index.js）：启动/看门狗重启/日志→~/.tomi-job-hunt/logs
│       │   ├── protocol.ts                 # tomihunt:// 注册(HKCU) 与 URL 处理（外部唤起→聚焦窗口；触发 core 启动）
│       │   ├── install-guide.ts            # 安装引导：复制插件→固定目录、打开 chrome://extensions、首启打开 Agent UI
│       │   ├── tray.ts                     # 托盘菜单：打开控制台 / 暂停 core / 退出
│       │   └── preload.ts                  # contextBridge 暴露最小 API（版本、登录自启开关、打开扩展页）
│       └── renderer/                       # Agent UI（React+Vite，仿 TomiLite apps/web，以 JD 为单位）
│           ├── index.html / vite.config.ts # base:'./'，产物供 electron-builder 打包
│           └── src/
│               ├── main.tsx                # React 挂载
│               ├── App.tsx                 # 布局：悬浮窗(工作台/折叠胶囊)+窗头+左侧JD库+右侧工作区(选中JD的tab)+广告位；跟随活跃Tab高亮JD
│               ├── lib/
│               │   ├── gateway.ts          # WS 客户端连 ws://127.0.0.1:34567/agent；发送指令+等 Ack
│               │   ├── api.ts              # REST 客户端连 core /v1/*（现有端点全部复用）
│               │   ├── llm.ts              # 直连 DeepSeek（直连模式，不依赖 core provider）
│               │   └── store.ts            # 前端状态：JD库/选中JD/会话流/匹配/面试/反馈/设置（zustand）
│               ├── pages/
│               │   ├── JdList.tsx          # 左侧 JD 库侧栏：搜索/筛选/⚡分/选中态（浏览时自动收集，非浏览器镜像）
│               │   ├── ChatPanel.tsx       # 选中 JD 的聊天 tab：气泡 + 话术 + 发送 + 👍👎
│               │   ├── MatchPanel.tsx      # 选中 JD 的简历匹配 tab：分环 + 优势/差距/避坑 + 技能标签
│               │   ├── InterviewPanel.tsx  # 选中 JD 的模拟面试 tab：逐题问答 + AI 点评 + 历史
│               │   ├── FeedbackPanel.tsx   # 选中 JD 的反馈 tab：匿名 👍👎 + 标签 + 备注 + 历史
│               │   └── SettingsPanel.tsx   # 窗头⚙️设置浮层：DeepSeek(含获取 Key 指引)/简历/自启/悬浮窗置顶/插件管理
│               └── components/
│                   ├── WindowFrame.tsx     # 悬浮窗窗头：拖拽区(-webkit-app-region:drag)/网关状态/折叠/设置/关闭
│                   ├── Tag.tsx             # 标签 chips（技术栈/风险词等）
│                   ├── ScoreRing.tsx       # 匹配度环形分
│                   ├── PitchEditor.tsx     # 话术生成/编辑/发送（含匿名反馈按钮）
│                   └── GatewayBadge.tsx    # 网关/DeepSeek 在线状态指示

├── core/                                   # 现有，改动集中在 ws/
│   └── src/
│       ├── index.ts                        # 入口：支持 TOMI_AS_CHILD=1（fork 模式：不自动开浏览器、父进程可管理）
│       └── ws/
│           ├── server.ts                   # 扩展：注册 /agent WS 路由（挂到现有 Hono app）
│           └── agent/
│               ├── types.ts                # 协议类型：AgentMsg{hello,session,ping,ack} / ConsoleMsg{send} / Ack{requestId,ok,error?} / failed{tab-closed|tab-idle|selector-failed|tab-offline}
│               ├── sessions.ts             # Target_ID↔{tabId,connectionId,lastSeen} 映射表：增删查、跨 Tab 去重、离线标记、连接断开→宽限(60s)清扫（浏览器崩溃兜底）
│               ├── router.ts               # 指令路由：目标在线直发；离线入缓冲(TTL≈30s, 有界) → 重连 flush → 归集 Ack
│               └── timeout.ts              # Ack 超时(5s, 自实际下发起算)→ failed{tab-closed|tab-idle|selector-failed|tab-offline}

├── extension/                              # 现有，无头化改造
│   └── src/
│       ├── background/
│       │   ├── index.ts                    # SW 入口：注册 chrome.alarms/runtime/tabs 监听，启动 ws-client
│       │   ├── ws-client.ts                # WS 连候选端口 [34567..34570] 轮询（沙箱读不到 core-port.json）；断线指数退避重连
│       │   ├── heartbeat.ts                # chrome.alarms 30s 唤醒：保 WS 活 + 发 ping
│       │   ├── sessions.ts                 # 汇总活跃会话：tabs.query + onRemoved/onUpdated 增量 → 上报网关
│       │   └── dispatch.ts                 # 收网关指令 → chrome.tabs.sendMessage → 等 Ack(超时) → 回网关
│       └── content/
│           ├── shared.ts                   # 删 UI 渲染后保留：fillChatBox、observeChatMessages、方向检测、JD/会话提取
│           ├── agent-client.ts             # 执行入口：chrome.runtime.onMessage → 填值/点击 → Ack{ok,error?,domSnippet}
│           ├── zhipin.ts / liepin.ts       # JD 提取（现有，去 UI 化）
│           ├── zhipin-chat.ts              # 聊天页：监听新消息上报 + 上报 chatTargetId
│           └── zhipin-list.ts              # 列表高亮：data-tomihunt-scored → WeakMap；通用类名
│       public/manifest.json                # 移除 options_page；action 唤起/展开悬浮窗；permissions: alarms,tabs,storage,activeTab

├── scripts/
│   ├── pack.mjs                            # 构建管线：build core → build Agent UI → electron-builder --win（仿 TomiLite pack）
│   └── package.py                          # 保留：源包 / 插件 zip（开发期分发）

└── docs/
    ├── headless-agent-architecture.md      # 本文档
    ├── installer-design.md                 # 安装/卸载方案
    └── mockup/                             # UI 设计稿（HTML 可预览）
```

## 9. UI mockup（设计稿）

- Agent UI 悬浮窗 mockup → `docs/mockup/agent-ui.html`（浏览器打开预览：JD 工作台 = 左侧 JD 库 + 右侧聊天/匹配/面试/反馈 tab + 窗头⚙️设置浮层；背景模拟浏览器）
- 插件 mockup（action 入口 + 无头说明 + 列表高亮）→ `docs/mockup/plugin.md`

## 10. 决策记录

**已确认**：
- Agent UI 技术栈：React + Vite（与 TomiLite 一致）。
- **Agent UI 窗口形态：OS 级无边框置顶悬浮窗**（`frame:false` + `alwaysOnTop` + `skipTaskbar`），浮在浏览器上方；跟随活跃 Tab；离开聊天页折叠成胶囊。
- **Agent UI 以 JD 为单位**：左侧 JD 库 + 右侧选中 JD 的并行功能 tab（聊天 / 简历匹配 / 模拟面试 / 反馈）；JD 库来自浏览时自动收集（非浏览器镜像），翻看岗位仍在浏览器。

**待确认（不影响阶段 1-2 开工）**：
1. **工具栏 action 行为**：点击唤起/展开悬浮窗 App（推荐）vs 无 action；
2. **执行截图权限**：是否开启 `captureVisibleTab`；
3. **列表高亮强度**：分数 + 颜色（现状）vs 仅分数；
4. **会话同步范围**：完整聊天记录同步进 Agent UI vs 只同步「新消息 + 已发送」摘要。
