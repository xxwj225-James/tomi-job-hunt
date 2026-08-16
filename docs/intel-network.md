# 去中心化情报网（Intel Network）

> 目标：用分布式求职者的力量击碎虚假招聘信息。**零注册、零服务器、无法被封杀。**

## 核心原则

1. **只共享结构化事实**——枚举标签 + ≤100 字脱敏备注。原始 JD 文本、HR 姓名、联系方式在代码层被硬性排除（`buildSharedIntel`，见 `core/src/jd/sanitize.ts`）
2. **零注册**——读侧完全免鉴权；写侧分阶段实现（见下）
3. **避风港**——TomiHunt 只是协议与工具，内容由共享者自行负责（[TAKEDOWN_POLICY.md](../TAKEDOWN_POLICY.md)）

## 数据格式（Feed 条目）

```json
{
  "jobUid": "sha256(公司|岗位) 前16位 — 跨用户去重键",
  "source": "zhipin | liepin | manual",
  "capturedAt": "ISO8601",
  "tags": { "techStack": [], "workHours": "双休", "riskFlags": [], "summary": "" },
  "reports": [{ "type": "salary_mismatch", "note": "≤100字脱敏事实", "ts": "" }]
}
```

## 三阶段架构

| 阶段 | 写侧 | 读侧 | 状态 |
|---|---|---|---|
| **A · 仓库 Feed** | 有 GitHub 账号的贡献者（Issue 表单 / PR） | `raw.githubusercontent.com`（免鉴权 CDN） | ✅ 已实现 |
| **B · Nostr** | 任何人（本地密钥对签名，无需账号） | 公共 relay 订阅（kind 30078, `#t tomihunt-intel`） | ✅ 已实现 |
| **C · Worker 中转**（可选） | Cloudflare Worker POST（匿名） | 每日 Action 聚合为静态 feed | ✅ 代码就绪，需自行部署 |

### Phase A — 仓库 Feed（零基础设施）

1. 用户在本机运行 `npm run intel -w core export`，把本地脱敏情报合并进 `data/intel-feed.json`，提交 PR
2. 或直接用 GitHub Issue 的「Job intel report」模板提交（纯勾选，无自由文本）
3. 其他用户/客户端直接读仓库的 `data/intel-feed.json`

### Phase B — Nostr（免鉴权写）

```bash
npm run intel -w core keygen    # 生成专用密钥对（只用于情报共享！）
# 把输出的 privateKey 填入 ~/.tomi-job-hunt/config.json:
#   { "intel": { "nostr": { "privateKey": "<hex>", "relays": ["wss://relay.damus.io"] } } }
npm run intel -w core publish   # 发布本地情报
npm run intel -w core subscribe # 订阅社区情报
```

- 事件：kind 30078，`d` tag = `tomihunt-intel`，内容为单条脱敏 Feed 条目
- 无中心服务器 → 招聘平台无法通过投诉/封禁关停网络

### Phase C — Worker 中转（规模化可选）

- `cloudflare/worker.js`：接收匿名 POST `/submit`，写入 R2（含基本 PoU 形状校验 + 每 IP 限速；**拒绝**携带原始 JD/HR 姓名的载荷）
- `.github/workflows/intel-feed.yml`：每日拉取 R2 → 合并去重 → 更新 `data/intel-feed.json` 并提交
- 部署：`wrangler r2 bucket create tomi-intel` → `wrangler deploy` → 配置 4 个仓库 secrets（见 workflow 文件注释）

## 反垃圾设计（四层）

1. **结构化 UI**：Issue 模板/插件表单只有勾选项 + 限长补充框——不给自由文本空间
2. **本地 AI 合规化**：粗口/情绪词在本地被替换为客观事实表述（`sanitizeReportNote`）
3. **数据分流**：结构化数字/标签进 Feed；自由讨论只存在于 GitHub Discussions（避风港）
4. **使用量证明（PoU）**：提交需携带 jobUid + capturedAt；Worker 做形状校验与限速
