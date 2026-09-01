/**
 * TomiHunt Cloudflare Worker — intel relay (Phase 5C; public community feed).
 *
 * Routes:
 *   POST /submit — sanitized anonymized intel entries, written to R2 under
 *                  `submissions/`. Never surfaces raw JD text or HR names.
 *
 * Security notes:
 *   - R2 binding lives in the worker ENVIRONMENT, never in this source file —
 *     the repo is public, so credentials must not appear here.
 *   - Anonymous and rate-limited per IP (the CF-Connecting-IP header is set
 *     by Cloudflare and cannot be spoofed).
 *
 * Product feedback (opt-in 👎/👍) no longer runs through this worker — it posts
 * to tomatovector.com/api/tomihunt-feedback (see docs/feedback-collector.md).
 *
 * Deploy:
 *   wrangler r2 bucket create tomi-intel
 *   wrangler deploy
 */

/** Per-minute per-IP cap; keys self-expire by being replaced on the next minute. */
async function rateLimited(env, prefix, ip, limit = 5) {
  const minute = Math.floor(Date.now() / 60000);
  const key = `_ratelimit/${prefix}/${ip}:${minute}`;
  const existing = await env.TOMIBUCKET?.get?.(key).then((r) => r?.text() ?? null).catch(() => null);
  const count = existing ? parseInt(existing, 10) || 0 : 0;
  if (count >= limit) return true;
  await env.TOMIBUCKET.put(key, String(count + 1)).catch(() => {});
  return false;
}

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

/** POST /submit — sanitized intel entry. */
async function handleIntel(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let entry;
  try {
    entry = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!entry || typeof entry.jobUid !== 'string' || typeof entry.capturedAt !== 'string') {
    return new Response('Missing jobUid/capturedAt', { status: 400 });
  }
  if (entry.requirements || entry.hrName) {
    // The compliance moat: raw JD text / HR names must NEVER reach the relay.
    return new Response('Rejected: raw JD text or personal data detected', { status: 422 });
  }
  const payload = JSON.stringify(entry);
  if (payload.length > 65536) {
    return new Response('Entry too large', { status: 413 });
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (await rateLimited(env, 'intel', ip)) {
    return new Response('Rate limited', { status: 429 });
  }

  const key = `submissions/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`;
  await env.TOMIBUCKET.put(key, payload + '\n');
  return json({ ok: true, key }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/submit') {
      return handleIntel(request, env);
    }
    return new Response('TomiHunt Relay — POST /submit (intel)', { status: 200 });
  },
};
