# TomiHunt 安装程序设计方案（v2 · 无头插件 + 桌面 App）

> 状态：设计稿（未实现）· 目标版本：0.3.0
> 选型（已确认）：插件**无头化**（剥离全部用户操作 UI，只做传感器+执行器）；Agent UI 是**独立桌面 App**（Electron，仿 TomiLite，用户安装），窗口为 **OS 级无边框置顶悬浮窗**（浮在浏览器上方，**JD 工作台** = 左侧 JD 库 + 右侧聊天/匹配/面试/反馈 tab）；广告/营销移入 App 内广告位。
> LLM 适配：**只适配 DeepSeek**，UI 只留 DeepSeek 入口，底层抽象保留供未来扩展。
> 插件无头架构详见 [headless-agent-architecture.md](headless-agent-architecture.md)。

## 1. 目标

一个 `TomiHuntSetup.exe` 完成：

- 安装**桌面 App**（内置网关 Gateway + Agent UI 控制台 + 广告位）——用户无需知道 Node、无需命令行；
- 引导加载**无头浏览器插件**（Chrome / Edge，固定目录，开发者模式）；
- App **登录自启动**、后台常驻；
- 卸载时：停止 App、清理文件与注册表；插件由「引导 + 插件自感知」移除。

范围：Windows 10/11 x64。HR 端是独立 Web 应用，不在本安装器范围。

## 2. 两个浏览器硬性约束（不变，诚实对待）

Chrome / Edge 禁止任何外部程序**静默安装或删除**扩展，安装器拿不到这个能力：

| 动作 | 约束 | 本方案的做法 |
|---|---|---|
| 安装插件 | 不能自动装上 | 安装器把插件构建产物复制到**固定目录** `%LOCALAPPDATA%\TomiHunt\extension`，并自动打开 `chrome://extensions`（或 `edge://extensions`），用户只需「开发者模式 → 加载已解压 → 选目录」两步 |
| 卸载插件 | 不能自动删掉 | 只有用户能在 `chrome://extensions` 移除；插件可**自感知** App 网关消失后调 `chrome.management.uninstallSelf()` 一键移除自己（已确认：无需 `management` 权限、unpacked 可用，仅企业托管环境不可用） |

## 3. 形态变化（vs v1：Core + 浏览器控制台）

| 项 | v1（已废弃） | v2（本方案） |
|---|---|---|
| 安装器工具 | Inno Setup（装 node + core） | **electron-builder（NSIS）**，仿 TomiLite `pack` 脚本 |
| Agent UI 形态 | 浏览器打开 `127.0.0.1:34567/console` | **Electron OS 级悬浮窗**（无边框置顶，浮在浏览器上方；自带 Chromium + Node） |
| Node 运行时 | 打包便携 Node（~30MB）+ core 生产依赖 | **Electron 自带 Node**，无需单独打包 |
| 网关 | Core 独立进程 | App 主进程内 fork core 子进程（复用 `core/dist/index.js`） |
| 登录自启 | HKCU Run → wscript | **`app.setLoginItemSettings`**（App 内管理，可在设置关闭） |
| 卸载器 | Inno `unins000` | NSIS 卸载器 |
| 插件 UI | 网页内浮动面板 | **无头**（无面板、无设置页，设置移入 App） |
| 广告/营销 | 面板底部 | **App 内广告位**（推广返佣/打赏链接） |

插件固定目录、`tomihunt://` 协议、开发者模式引导、插件自感知移除、数据边界（`~/.tomi-job-hunt/`）全部延续 v1。

## 4. 目录布局

```
%LOCALAPPDATA%\Programs\TomiHunt\      ← electron-builder per-user 安装目录
├─ TomiHunt.exe        Electron 主程序（网关 + Agent UI + 托盘）
├─ resources\app\      主进程/渲染进程 bundle（含打包后的 core）
├─ uninstall.exe       NSIS 卸载器
└─ ...

%LOCALAPPDATA%\TomiHunt\extension\     ← 插件固定加载目录（不变，身份稳定）
~/.tomi-job-hunt\                      ← 配置 / Key / 简历 / JD 库 / 看板（卸载默认保留）
```

插件目录放在 `Programs\TomiHunt\` 之外的原因：Chrome 按「加载目录」识别扩展实例，**必须始终同一条路径**——升级 = 覆盖同目录文件 + 点刷新，数据保留。

## 5. 安装流程

前置：Windows 10/11 x64，已装 Chrome 或 Edge。**无需管理员、无需预装 Node**。

1. 运行 `TomiHuntSetup.exe`（未签名 → SmartScreen 提示未知发布者，见 §14）；
2. electron-builder 复制 App 到 `%LOCALAPPDATA%\Programs\TomiHunt\`；
3. 复制插件 dist → `%LOCALAPPDATA%\TomiHunt\extension\`（先清旧文件再覆盖，固定目录不变）；
4. 注册 `tomihunt://`（HKCU）→ App（从插件/外部启动 App 的入口；登录自启由 App 内管理，安装器不写 Run 键）；
5. 首次启动 App：fork core 子进程（127.0.0.1:34567，端口顺延逻辑沿用 core）→ 打开 Agent UI 悬浮窗（无边框置顶，浮在浏览器上方）→ 未配置 LLM 时引导配置（只留 DeepSeek）；
6. 打开 `chrome://extensions`（或 `edge://extensions`），提示「开发者模式 → 加载已解压 → 选择 `%LOCALAPPDATA%\TomiHunt\extension`」；
7. 完成页说明：若已加载过同目录，只需点 🔄 刷新，数据保留；「打开扩展页」步骤也可随时在 App 设置里重做。

## 6. 登录自启动

- **入口**：`app.setLoginItemSettings({ openAtLogin: true })`——安装时默认开启，App 设置里可关闭（无需操作注册表）；
- 启动时 fork core 子进程（复用现有 `dist/index.js`，隐藏窗口），stdout/stderr → `~/.tomi-job-hunt/logs/core.log`；
- **单实例**：App 单例锁 + core 端口探测（34567–34570 顺延 + 写 `core-port.json`），双保险；
- **托盘**：关闭窗口收进托盘常驻（可选，App 设置控制）。

## 7. 卸载流程

NSIS 卸载器：

1. 停 App 进程并结束 core 子进程；
2. 关闭登录自启（`setLoginItemSettings({ openAtLogin: false })`）+ 删除 `tomihunt://` 注册表；
3. 删除 `%LOCALAPPDATA%\Programs\TomiHunt\`；
4. **删除插件目录前弹提示**：「请先在 `chrome://extensions` 移除插件，否则 Chrome 会显示『扩展已损坏』」→ 打开扩展页 → 移除后才删 `%LOCALAPPDATA%\TomiHunt\extension\`；
5. 询问是否同时删除配置数据 `~/.tomi-job-hunt\`（API Key 加密文件、简历、JD 库、看板）——**默认保留**；
6. **插件自感知兜底**：用户卸载时没手动删插件 → 插件下次探测到网关消失 → 提示「本地 agent 已卸载」→ 一键 `uninstallSelf()` 移除自己。

## 8. 插件自感知移除（延续 v1）

- manifest **无需新权限**（`uninstallSelf` 不要求 `management`）；
- `chrome.storage.local` 记录 `core-seen` 标记（首次探测网关成功时写入）。当 `detectBackend` 返回 offline **且** `core-seen` 存在 → 设置面（App 内）显示「本地 agent 未运行或已卸载」+「移除本插件」按钮 → 调 `chrome.management.uninstallSelf()`；
- 纯直连用户（从没配过 App）**不提示**；
- 企业托管环境 `uninstallSelf` 会失败 → 按钮退化为打开 `chrome://extensions`。

## 9. 运行时与 LLM（已收敛）

- Electron 自带 Node → v1 的「打包便携 Node」决策消失；
- core 依赖随 electron-builder 打包进 `resources\app`。**只适配 DeepSeek** → 移除 claude 相关依赖（`@anthropic-ai/claude-agent-sdk*` 305MB、`@anthropic-ai/sdk`、`@napi-rs`），生产依赖约 **60MB**；
- 未来扩展其他 LLM：`ChatProvider` + `openai-compat` 抽象保留，新增 provider 走动态 `import`，按需打包不撑大默认包体；
- 安装包体积约 **150–200MB**（Chromium + Node 是主要开销），远小于「Node-only + 便携 node」之外的多余部分。

## 10. 更新与升级

- 升级 = 重新运行新版 `TomiHuntSetup.exe`（覆盖同路径）→ 停旧 App → 覆盖文件 → 重启 App → 提示插件点 🔄 刷新；
- 插件升级：安装器把新版 dist 覆盖进固定目录 → `chrome://extensions` 点刷新；
- 配置 / Key / 简历 / JD 库 / 看板全程不动（都在 `~/.tomi-job-hunt\` 与浏览器 `storage.local`）；
- 加分项（待确认）：`electron-updater` 在 App 内做「检查更新 + 自动下载安装」，替代手动重跑安装包。

## 11. 安全与隐私

- 网关只绑 127.0.0.1；Electron App 不写系统 PATH、不新增遥测/上传；
- API Key 仍走 DPAPI 加密（Windows CurrentUser 域），不因安装器改变；
- 卸载默认保留 `~/.tomi-job-hunt\`，删除需二次确认；
- Windows 防火墙对回环监听通常不弹窗。

## 12. 待建文件清单（实现阶段）

| 文件 | 说明 |
|---|---|
| `app/`（新增，Electron） | 主进程：fork core + 网关路由 + 登录自启 + 托盘 + 安装引导；渲染进程：Agent UI（React/Vite） |
| `app/electron-builder.yml` | NSIS 打包配置（per-user、图标、卸载器、`setLoginItemSettings` 配合项） |
| `scripts/pack.mjs` | 构建管线（仿 TomiLite `pack`）：build core → bundle → build Agent UI → electron-builder --win |
| `core/src/ws/server.ts` | 新增 `/agent` 路由：Session 映射表、ping/pong、指令路由、Ack 超时（见 headless 架构 §4） |
| extension 无头改造 | 删面板 UI；新增 SW（WS + alarms 心跳 + 会话上报 + 指令分发）；列表高亮改 `WeakMap`（见 headless 架构 §8） |
| `docs/usage.md` | 重写：安装 App + 加载插件 + 控制台操作流 |

## 13. 验证方案

1. **干净机（无 Node）**：装 App → 网关 `127.0.0.1:34567/health` ok → Agent UI 悬浮窗打开（无边框置顶，可拖动/折叠）→ `/setup` 只显示 DeepSeek；
2. **插件加载**：`chrome://extensions` 加载固定目录 → 无面板 UI → 控制台可发起全链路发送；
3. **全链路发送**：控制台点「发送」→ 映射命中 → 插件填值 + 点击 → Ack 回显成功；目标 Tab 关闭 → 控制台提示「聊天窗口未打开」；
4. **登录自启 / 单实例 / 端口冲突**：重启登录 App 自启；重复启动只保留一个实例；预占 34567 → core 顺延 34568；
5. **卸载**：App 停、注册表清、文件删；插件仍在 → 探测网关消失 → 一键移除（或手动）；
6. **升级**：装 0.3.0 → 覆盖装 0.3.1 → 断言数据保留。

## 14. 已知限制 / 风险（诚实）

| 限制 | 说明 |
|---|---|
| 开发者模式摩擦 | Chrome/Edge 周期性提示「停用开发者模式扩展」；企业策略可能禁止开发者模式加载。这是「不上架」的固有代价 |
| 插件不能自动安装/卸载 | 安装需用户点两下；卸载靠引导 + 插件自移除，托管环境下仍需手动 |
| 无代码签名 | 未签名 exe → SmartScreen「未知发布者」。建议后续购买代码签名证书（数百元/年）消除；electron-builder 原生支持签名 |
| Electron 包体 | ~150–200MB（Chromium + Node），免装 Node 的代价 |
| 杀软误报 | Electron 打包是常见特征，个别 AV 可能误报；签名可缓解 |
| 登录自启边界 | 用户未登录 / 域策略禁用时 App 不自启；插件无网关即静默（网关必需，见 headless 架构 §7） |
| `isTrusted` 边界 | 自动「填+点发送」由脚本触发，事件 `isTrusted=false` 理论可被网站检测；以频率克制 + 用户逐条确认缓解（headless 架构 §5） |

## 15. 待确认决策（实现前）

1. **Electron 包体**：接受 ~150–200MB（vs 纯 Node 服务 + 浏览器控制台的 ~60MB）——已按你的指示定为 Electron App；
2. **自动更新**：`electron-updater` 本轮做还是后补；
3. **代码签名**：本轮是否购买/配置证书；
4. **实现范围**：Electron App + 无头插件改造一次性做完，还是分步（先插件无头 + 简易本地控制台，再套 Electron 壳）。
