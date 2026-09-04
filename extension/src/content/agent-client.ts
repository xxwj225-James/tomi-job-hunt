/**
 * Headless agent entry installed on chat-capable pages (currently zhipin's
 * /web/geek/chat/*). Receives dispatch commands from the background SW and
 * fills the chat box + highlights it in THIS tab (the user reviews and sends
 * themselves — the extension never sends programmatically), then acks back
 * over runtime messaging.
 *
 * Content ↔ SW messages are namespaced 'tomi-*' — the extension has no other
 * runtime messaging, so the channel is uncontested:
 *   SW → content:  tomihunt-dispatch {requestId,targetId,text}
 *                  tomi-session-sync (re-announce your session)
 *   content → SW:  tomi-ack {requestId,ok,error?,domSnippet?}
 *                  tomi-session {action,targetId}
 *                  tomi-session-sync-reply {targetId}
 */
import { fillAndSendAgent } from './shared.js';

interface DispatchPayload {
  type: 'tomihunt-dispatch';
  requestId: string;
  targetId: string;
  text: string;
}

/** Desktop-app dispatch: fill chat box + highlight for user review + ack. */
export function installAgentClient(): void {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return undefined;
    const d = msg as Partial<DispatchPayload>;
    if (d.type !== 'tomihunt-dispatch' || typeof d.requestId !== 'string' || typeof d.text !== 'string') {
      return undefined;
    }
    const { ok, error } = fillAndSendAgent(d.text);
    void chrome.runtime
      .sendMessage({
        type: 'tomi-ack',
        requestId: d.requestId,
        ok,
        ...(ok ? { domSnippet: '已填入聊天框并高亮，请确认后在页面发送' } : {}),
        ...(error ? { error } : {}),
      })
      .catch(() => undefined);
    return undefined;
  });
}

/**
 * Reports which JD chat this page is showing so the gateway can reach it.
 * targetId is `jd:${jobUid}`; jobUid must match core's computation.
 */
export function reportSession(action: 'upsert' | 'remove', targetId: string): Promise<void> {
  return chrome.runtime.sendMessage({ type: 'tomi-session', action, targetId }).catch(() => undefined);
}

/**
 * Matches core's computeJobUid (core/src/jd/schema.ts): stable sha256 of
 * `${company.trim()}|${title.trim()}`, first 16 hex chars. The desktop app
 * links a session to a JD record by the very same id.
 */
export async function computeJobUid(company: string, title: string): Promise<string> {
  const data = new TextEncoder().encode(`${(company ?? '').trim()}|${(title ?? '').trim()}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
