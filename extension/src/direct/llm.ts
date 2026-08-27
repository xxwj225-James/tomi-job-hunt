/**
 * Direct-mode LLM layer — the extension calls LLM APIs straight from the
 * service worker. No local Core service required: install the extension,
 * paste an API key in the options page, done.
 *
 * Providers: deepseek / qwen / kimi (OpenAI-compatible, preset base URLs,
 * provider-specific params ported from core/src/llm/openai-compat.ts) and
 * 通用 (generic — the user provides their own OpenAI-compatible base URL
 * and model, e.g. a self-hosted gateway, OneAPI, Ollama, SiliconFlow).
 */
import type { ChatMessage } from '../types.js';

export type DirectProviderId = 'deepseek' | 'qwen' | 'kimi' | 'generic';

export interface DirectLlmConfig {
  provider: DirectProviderId;
  model: string;
  apiKey: string;
  /** Custom endpoint for the generic provider (or to override a preset). */
  baseUrl?: string;
  thinking?: boolean;
}

export interface DirectChatResult {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

const PRESETS: Record<string, { baseUrl: string; defaultModel: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-v4-flash' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2.6' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen3.7-plus' },
};

export function presetFor(provider: DirectProviderId): { baseUrl: string; defaultModel: string } | undefined {
  return PRESETS[provider];
}

export class DirectLlmError extends Error {}

async function openAiCompatibleChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  thinking: boolean,
): Promise<DirectChatResult> {
  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: baseUrl.includes('deepseek') ? 16000 : 8192,
  };
  if (baseUrl.includes('deepseek')) {
    body.thinking = { type: thinking ? 'enabled' : 'disabled' };
  } else if (baseUrl.includes('dashscope') && thinking) {
    body.enable_thinking = true;
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new DirectLlmError(`API 错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: json.choices?.[0]?.message?.content ?? '',
    model: json.model ?? model,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
  };
}

/** Config lives in chrome.storage.local — readable by content scripts + popup. */
export async function loadDirectConfig(): Promise<DirectLlmConfig | null> {
  let data: Record<string, unknown>;
  try {
    data = await chrome.storage.local.get('tomihunt-llm-config');
  } catch (err) {
    if (err instanceof Error && /context invalidated/i.test(err.message)) {
      throw new DirectLlmError('插件刚被更新或重载——请刷新本页面（F5）后再试。');
    }
    throw err;
  }
  const cfg = data['tomihunt-llm-config'] as DirectLlmConfig | undefined;
  return cfg?.apiKey ? cfg : null;
}

export async function directChat(messages: ChatMessage[]): Promise<DirectChatResult> {
  const cfg = await loadDirectConfig();
  if (!cfg) {
    throw new DirectLlmError(
      '尚未配置 API Key。请点击插件图标 → 设置，选择模型服务商并粘贴 API Key。',
    );
  }
  const baseUrl = (cfg.baseUrl?.trim() || (PRESETS[cfg.provider]?.baseUrl ?? '')).replace(/\/+$/, '');
  if (!baseUrl) {
    throw new DirectLlmError('「通用」服务商需要填写 Base URL（OpenAI 兼容地址，如 https://xxx/v1）。');
  }
  if (!cfg.model.trim()) {
    throw new DirectLlmError('请填写模型名称（model）。');
  }
  return openAiCompatibleChat(baseUrl, cfg.apiKey, cfg.model, messages, cfg.thinking === true);
}

/** Connection test for the options page. */
export async function testDirectConnection(cfg: DirectLlmConfig): Promise<{ ok: boolean; message: string }> {
  try {
    await chrome.storage.local.set({ 'tomihunt-llm-config': cfg });
    const result = await directChat([{ role: 'user', content: '回复：OK' }]);
    return { ok: true, message: `连接成功（模型: ${result.model}）` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
