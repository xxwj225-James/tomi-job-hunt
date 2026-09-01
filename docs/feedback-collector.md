# 匿名反馈收集（Feedback Relay）

> 目的：让作者（你）能看到用户主动提交的产品反馈（👍/👎 + 标签 + 可选备注、HR 需求），
> **不依赖用户有 GitHub 账号、不需要自建登录体系、匿名**；上传默认开启、可一键关闭。
> **复用 tomatovector.com 已上线的反馈体系**，不新增任何独立服务。

## 架构

```
插件 options「匿名反馈」开关 = ON
   └─ addFeedback() ──fire-and-forget──▶ https://tomatovector.com/api/tomihunt-feedback
hr/ 网页「匿名反馈」勾选 = ON             │
   └─ feedbackSave() ──fire-and-forget──▶  └─ Express 新路由（路由级 CORS）
                                                    │  校验 + 每 IP 限速 + 邮件/webhook 通知
                                                    └→ SQLite 独立表 tomihunt_feedback（source 隔离）
你读取：浏览器打开 https://tomatovector.com/admin.html 登录 → 「TomiHunt 反馈」tab
       或 curl GET /api/tomihunt-feedback (Authorization: Bearer <admin token>) → JSON 列表
```

- **零新增第三方服务 / 零额外部署**：直接落在 `tomatolite-website`（tomatovector.com）的 Express 里，
  复用已有的 rate limiter / adminAuth / 邮件 / webhook 通知。
- **与官网表单反馈完全隔离**：TomiHunt 反馈写入**独立表** `tomihunt_feedback`，不触碰现有
  `feedback` 表与 `/api/feedback` 路由 —— 线上已上线的反馈数据与功能不受任何影响。
- **公开仓库里没有任何凭证**：admin 密码/通知配置都是 tomatovector 服务器环境变量，源码里没有。

## 上报端（本仓库）

| 位置 | 端点 |
|---|---|
| `extension/src/direct/feedback.ts` — `FEEDBACK_ENDPOINT` | `https://tomatovector.com/api/tomihunt-feedback` |
| `hr/src/main.ts` — `FEEDBACK_ENDPOINT` | 同上 |

- payload：`{ feature, ts, thumbs, tags, note }`；`feature` ∈ greeting / match / hr-needs，
  即**用户评价对应的操作类型**（打招呼语生成 / 简历匹配 / HR 需求）。
- 客户端逻辑零改动：`submitFeedback()` / `feedbackSave()` 已含全部字段，只换端点。
- extension 需在 `manifest.json` 的 `host_permissions` 含 `https://tomatovector.com/*`
  （MV3 content script 跨域 fetch 需要）；hr/ 网页跨域由服务端路由级 CORS 放行。

## 服务端行为（tomatolite-website）

`POST /api/tomihunt-feedback`：
- 校验：`feature` 必填（≤40）；`thumbs` ∈ up/down；`tags` 数组（每项 ≤40、≤20 项）；
  `note` ≤1000；全空 → 400。
- 落库 `tomihunt_feedback`（`tags` 存 JSON 文本；`created_at` 用服务器时间，忽略客户端 `ts`）。
- 通知：`sendEmail` + `sendWebhook`（飞书/钉钉/企微），正文带操作类型/👍👎/标签/备注。
- 限速：每 IP `RL_SENSITIVE`=20/min（沿用现有 `x-forwarded-for` 取真实 IP）。

`GET /api/tomihunt-feedback`（`adminAuth` Bearer token）→ 全部记录（新→旧）。

## 读取反馈

**网页管理页**：打开 `https://tomatovector.com/admin.html`，输入 admin 密码登录 →
切到 **「TomiHunt 反馈」** tab，表格列出 操作类型 / 评价 / 标签 / 备注 / 时间。

**命令行（JSON）**：

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://tomatovector.com/api/tomihunt-feedback | python -m json.tool
```

返回（新→旧）：`feature`、`thumbs`、`tags`（JSON 字符串）、`note`、`created_at`。
官网表单反馈仍在原 `feedback` 表 / 原「反馈列表」tab（互不影响）。

## 部署（一次性，tomatovector.com 侧）

1. 把 `tomatolite-website` 更新部署到服务器（既有发布流程）；重启后 `CREATE TABLE IF NOT EXISTS
   tomihunt_feedback` 自动建新表，现有数据零迁移、零改动。
2. 无需配置 `feedback.tomatovector.com` 子域 / systemd / nginx / 证书（旧方案已废弃；
   DNS 上已加的 `feedback` A 记录无害，可留可删）。

## 隐私与合规（红线）

- **默认开启、可一键关闭**：插件 options 页、hr/ 网页的「匿名反馈」开关默认勾选；
  取消勾选并保存后立即停止上传，数据留在本机。关闭状态会持久化（extension 存
  `chrome.storage.local` false；hr/ 存 localStorage `'0'`）。
- **绝不含简历内容 / JD 信息**：上报 payload 只有 feature/thumbs/tags/note，不传岗位/公司
  （隐私红线：不收集用户应聘了哪条 JD）。插件侧 `addFeedback` 传入的条目本身不含简历文本；
  hr/ 侧只传需求标签 + 说明。
- **私有存储**：`tomihunt_feedback` 表只在服务器本机 SQLite，不对外公开；`/api/tomihunt-feedback`
  读取需 admin Bearer token。
- **限速**：每 IP 每分钟 20 条；字段长度上限见上。防刷但不拦正常用户。
- 若某天不想收集：把两端 `FEEDBACK_ENDPOINT` 改回空串重新发布即可立即停用。

## 测试

- `npm test -w extension`：`feedback.test.ts` 覆盖 submitFeedback 的 opt-in / 端点 / 失败静默
  （测试用 mock endpoint，与默认端点常量无关）。
- 服务端无自动化测试（部署环境）；本地验证见 tomatolite-website 的 `node server.js` + curl
  （POST 表单 payload 与 TomiHunt payload 各一条，GET 带 token 读取，`feedback` 表数据零变化）。
