/**
 * Direct-mode LLM layer — the extension calls LLM APIs straight from the
 * service worker. No local Core service required: install the extension,
 * paste an API key in the options page, done.
 *
 * Providers: deepseek / kimi / qwen (OpenAI-compatible, preset base URLs,
 * provider-specific params ported from core/src/llm/openai-compat.ts) and
 * claude-api (Anthropic Messages API with the mandatory
 * anthropic-dangerous-direct-browser-access header for browser calls).
 */
import type { ChatMessage } from '../types.js';

export type DirectProviderId = 'deepseek' | 'kimi' | 'qwen' | 'claude-api';

export interface DirectLlmConfig {
  provider: DirectProviderId;
  model: string;
  apiKey: string;
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

async function claudeApiChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<DirectChatResult> {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const apiMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for direct browser calls to the Anthropic API
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 4096, system: system || undefined, messages: apiMessages }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new DirectLlmError(`Claude API 错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as {
    model?: string;
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text: (json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''),
    model: json.model ?? model,
    usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 },
  };
}

/** Config lives in chrome.storage.local — readable by content scripts + popup. */
export async function loadDirectConfig(): Promise<DirectLlmConfig | null> {
  const data = await chrome.storage.local.get('tomihunt-llm-config');
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
  if (cfg.provider === 'claude-api') {
    return claudeApiChat(cfg.apiKey, cfg.model, messages);
  }
  const preset = PRESETS[cfg.provider];
  if (!preset) throw new DirectLlmError(`未知 provider: ${cfg.provider}`);
  return openAiCompatibleChat(preset.baseUrl, cfg.apiKey, cfg.model, messages, cfg.thinking === true);
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
