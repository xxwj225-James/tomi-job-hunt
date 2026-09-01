/**
 * HR LLM config for the extension's HR resume analysis — separate storage key
 * `tomihunt-hr-llm-config` so HR's own API key never collides with the job
 * seeker's `tomihunt-llm-config`. Transport reuses directChatWith (extension
 * direct/llm.ts), so there is no local Core / service dependency.
 */
import { directChatWith, presetFor } from '../direct/llm.js';
import type { DirectLlmConfig } from '../direct/llm.js';

export const HR_CONFIG_KEY = 'tomihunt-hr-llm-config';

export async function loadHrConfig(): Promise<DirectLlmConfig | null> {
  try {
    const data = await chrome.storage.local.get(HR_CONFIG_KEY);
    const cfg = data[HR_CONFIG_KEY] as DirectLlmConfig | undefined;
    return cfg?.apiKey ? cfg : null;
  } catch {
    return null;
  }
}

export async function saveHrConfig(cfg: DirectLlmConfig): Promise<void> {
  await chrome.storage.local.set({ [HR_CONFIG_KEY]: cfg });
}

export async function testHrConnection(cfg: DirectLlmConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await directChatWith(cfg, [{ role: 'user', content: '回复：OK' }]);
    return { ok: true, message: `连接成功（模型: ${result.model}）` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export { presetFor };
