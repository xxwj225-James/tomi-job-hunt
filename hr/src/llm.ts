/**
 * Direct LLM layer for the HR screening page — a plain-browser re-implementation
 * of extension/src/direct/llm.ts (no chrome.*, no service worker). Config lives
 * in localStorage; resume data never leaves the browser; only the JD + prompt
 * text is sent to the user's chosen LLM API.
 *
 * Providers: deepseek / qwen / kimi (OpenAI-compatible, preset base URLs) and
 * 通用 (generic — user-provided OpenAI-compatible base URL + model).
 */

export type HrProviderId = 'deepseek' | 'qwen' | 'kimi' | 'generic';

export interface HrLlmConfig {
  provider: HrProviderId;
  model: string;
  apiKey: string;
  /** Custom endpoint for the generic provider (or to override a preset). */
  baseUrl?: string;
}

export interface HrChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface HrChatResult {
  text: string;
  model: string;
}

export class HrLlmError extends Error {}

const CONFIG_KEY = 'tomihunt-hr-llm-config';

const PRESETS: Record<string, { baseUrl: string; defaultModel: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-v4-flash' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2.6' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen3.7-plus' },
};

export function presetFor(provider: HrProviderId): { baseUrl: string; defaultModel: string } | undefined {
  return PRESETS[provider];
}

export function loadConfig(): HrLlmConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as HrLlmConfig;
    return cfg?.apiKey ? cfg : null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: HrLlmConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

/** Only ever called from a user click / form submit — every LLM call is user-initiated. */
export async function chat(cfg: HrLlmConfig, messages: HrChatMessage[]): Promise<HrChatResult> {
  const baseUrl = (cfg.baseUrl?.trim() || (PRESETS[cfg.provider]?.baseUrl ?? '')).replace(/\/+$/, '');
  if (!baseUrl) {
    throw new HrLlmError('「通用」服务商需要填写 Base URL（OpenAI 兼容地址，如 https://xxx/v1）。');
  }
  const model = cfg.model.trim();
  if (!model) {
    throw new HrLlmError('请填写模型名称（model）。');
  }

  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: baseUrl.includes('deepseek') ? 16000 : 8192,
  };
  if (baseUrl.includes('deepseek')) {
    body.thinking = { type: 'disabled' }; // JSON output — keep it deterministic
  }

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new HrLlmError(
      `网络请求失败：${(err as Error).message}. 若直接用浏览器打开本页，请改用 start.bat 启动本地服务（个别 API 拒绝 file:// 来源）。`,
    );
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 401) {
      throw new HrLlmError('API Key 无效或已失效，请检查设置中的 Key。');
    }
    throw new HrLlmError(`API 错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? '';
  if (!text) {
    throw new HrLlmError('模型返回为空，请重试。');
  }
  return { text, model: json.model ?? model };
}

export async function testConnection(cfg: HrLlmConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await chat(cfg, [{ role: 'user', content: '回复：OK' }]);
    return { ok: true, message: `连接成功（模型: ${result.model}）` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
