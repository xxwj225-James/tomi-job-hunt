/**
 * ws-agent-check.mjs — manual /agent WS protocol check (implementation-plan
 * phase 1, acceptance item 2).
 *
 * Spawns a throwaway core instance on a random high port with a temp TOMI_HOME
 * and fast-forwarded timeouts, then drives BOTH roles over the wire:
 *
 *   agent   = headless extension (hello / session / ping / ack)
 *   console = Agent UI        (hello / send)
 *
 * Covers:
 *   1. hello + session upsert + ping → pong
 *   2. console send → dispatch → ack → console ack
 *   3. no ack → failed (reason classifiable) after ack timeout
 *   4. disconnect → session marked offline
 *   5. offline buffer → pending → reconnect flush → dispatch → ack
 *   6. buffer TTL expiry (no reconnect) → failed{tab-offline}
 *   7. grace sweep prunes stale sessions (disconnect + no re-register)
 *
 * Usage:   node scripts/ws-agent-check.mjs   (from core/)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const CORE_DIR = dirname(dirname(fileURLToPath(import.meta.url))); // core/
const REPO_ROOT = dirname(CORE_DIR); // monorepo root (hoisted node_modules)
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const TARGET = 'acme-software-se-01';
const REASONS = ['tab-closed', 'tab-idle', 'selector-failed', 'tab-offline'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- minimal WS wire: queue + registered waiters ---
class Wire {
  constructor() {
    this.queue = [];
    this.waiters = [];
    this.ws = null;
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  waitFor(pred, label, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(entry);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(new Error(`timed out (${timeoutMs}ms) waiting for ${label}`));
      }, timeoutMs);
      const entry = {
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
      // already-arrived messages win first
      const i = this.queue.findIndex(pred);
      if (i !== -1) {
        clearTimeout(timer);
        resolve(this.queue.splice(i, 1)[0]);
        return;
      }
      this.waiters.push(entry);
    });
  }
  onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const i = this.waiters.findIndex((w) => w.pred(msg));
    if (i !== -1) {
      const [w] = this.waiters.splice(i, 1);
      w.resolve(msg);
    } else {
      this.queue.push(msg);
    }
  }
}

function connectWire(port) {
  const wire = new Wire();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent`);
    wire.ws = ws;
    ws.on('message', (data) => wire.onMessage(String(data)));
    ws.once('open', () => resolve(wire));
    ws.once('error', reject);
  });
}

function closed(wire) {
  return new Promise((resolve) => {
    if (wire.ws.readyState === WebSocket.CLOSED) return resolve();
    wire.ws.once('close', resolve);
  });
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), 'tomi-agent-check-'));
  const port = 35000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
    cwd: CORE_DIR,
    env: {
      ...process.env,
      TOMI_HOME: home, // isolated config dir — never touches the real one
      TOMI_PORT: String(port),
      TOMI_LOG_LEVEL: 'warn',
      TOMI_NO_OPEN_BROWSER: '1', // headless: no setup-wizard browser popup
      // fast-forward so every timeout path runs in a few seconds
      TOMI_AGENT_ACK_MS: '500',
      TOMI_AGENT_BUFFER_TTL_MS: '1000',
      TOMI_AGENT_GRACE_MS: '2000',
      TOMI_AGENT_SWEEP_MS: '300',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.on('exit', () => {
    if (!child.killed) child.kill();
  });
  let coreOut = '';
  child.stdout.on('data', (d) => (coreOut += d));
  child.stderr.on('data', (d) => (coreOut += d));

  let failures = 0;
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures += 1;
      console.log(`  ✗ ${name}: ${err.message}`);
    }
  };

  try {
    // wait for the service to boot
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`);
        if (r.ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`core never became healthy:\n${coreOut}`);
      await sleep(200);
    }
    console.log(`[ws-agent-check] core up on 127.0.0.1:${port} — running 7 checks`);

    const console1 = await connectWire(port);
    let agent1;
    let agent2;

    // 1. hello → register session → ping/pong
    await check('1. hello + session upsert + ping → pong', async () => {
      agent1 = await connectWire(port);
      agent1.send({ type: 'hello', role: 'agent', agentId: 'sw-1', sessionIds: [] });
      agent1.send({ type: 'session', action: 'upsert', targetId: TARGET, tabId: 7 });
      const ts = Date.now();
      agent1.send({ type: 'ping', ts });
      const pong = await agent1.waitFor((m) => m.type === 'pong', 'pong', 2000);
      assert(pong.ts === ts, `pong ts mismatch (${pong.ts} !== ${ts})`);
    });

    // 2. console send → routed to the agent → ack round-trip
    await check('2. console send → dispatch → ack', async () => {
      console1.send({ type: 'hello', role: 'console' });
      const hello = await console1.waitFor((m) => m.type === 'hello', 'console hello', 2000);
      assert(hello.ok === true, 'console hello not ok');
      assert(
        hello.sessions.some((s) => s.targetId === TARGET && s.status === 'online'),
        `session not online (${JSON.stringify(hello.sessions)})`,
      );
      console1.send({ type: 'send', requestId: 'req-1', targetId: TARGET, text: '您好！' });
      const d = await agent1.waitFor(
        (m) => m.type === 'dispatch' && m.requestId === 'req-1',
        'dispatch req-1',
        2000,
      );
      assert(d.text === '您好！', 'dispatch text mismatch');
      agent1.send({ type: 'ack', requestId: 'req-1', ok: true, domSnippet: '<span>已发送</span>' });
      const a = await console1.waitFor(
        (m) => m.type === 'ack' && m.requestId === 'req-1',
        'ack req-1',
        2000,
      );
      assert(a.ok === true, 'ack not ok');
    });

    // 3. no ack → ack timeout → console gets a classifiable failed
    await check('3. no ack → failed (classifiable reason)', async () => {
      console1.send({ type: 'send', requestId: 'req-2', targetId: TARGET, text: '无响应测试' });
      await agent1.waitFor(
        (m) => m.type === 'dispatch' && m.requestId === 'req-2',
        'dispatch req-2',
        2000,
      );
      // deliberately withhold the ack — router must fail it after ACK_MS
      const failed = await console1.waitFor(
        (m) => m.type === 'failed' && m.requestId === 'req-2',
        'failed req-2',
        2000,
      );
      assert(REASONS.includes(failed.reason), `unclassifiable reason: ${failed.reason}`);
    });

    // 4. disconnect → that session flips to offline
    await check('4. disconnect → session offline', async () => {
      agent1.ws.close();
      await closed(agent1);
      await sleep(100); // let the server's onClose mark the session offline
      const deadline = Date.now() + 2000;
      let status;
      while (Date.now() < deadline) {
        console1.send({ type: 'hello', role: 'console' });
        const h = await console1.waitFor((m) => m.type === 'hello', 'hello re-query', 2000);
        const s = h.sessions.find((x) => x.targetId === TARGET);
        if (s?.status === 'offline') {
          status = 'offline';
          break;
        }
        await sleep(100);
      }
      assert(status === 'offline', 'session never flipped to offline');
    });

    // 5. offline target: send → pending → reconnect flush → dispatch → ack
    await check('5. offline buffer → pending → reconnect flush → ack', async () => {
      console1.send({ type: 'send', requestId: 'req-3', targetId: TARGET, text: '离线缓冲' });
      const pending = await console1.waitFor(
        (m) => m.type === 'pending' && m.requestId === 'req-3',
        'pending req-3',
        2000,
      );
      assert(pending.targetId === TARGET, 'pending target mismatch');
      agent2 = await connectWire(port);
      agent2.send({ type: 'hello', role: 'agent', agentId: 'sw-2', sessionIds: [TARGET] });
      const d = await agent2.waitFor(
        (m) => m.type === 'dispatch' && m.requestId === 'req-3',
        'flushed dispatch req-3',
        2000,
      );
      assert(d.text === '离线缓冲', 'flush text mismatch');
      agent2.send({ type: 'ack', requestId: 'req-3', ok: true });
      const a = await console1.waitFor(
        (m) => m.type === 'ack' && m.requestId === 'req-3',
        'ack req-3',
        2000,
      );
      assert(a.ok === true, 'ack not ok');
    });

    // 6. no reconnect → buffer TTL expiry → failed{tab-offline}
    await check('6. buffer TTL → failed{tab-offline}', async () => {
      agent2.ws.close();
      await closed(agent2);
      await sleep(100);
      console1.send({ type: 'send', requestId: 'req-4', targetId: TARGET, text: '缓冲超时' });
      await console1.waitFor(
        (m) => m.type === 'pending' && m.requestId === 'req-4',
        'pending req-4',
        2000,
      );
      // no reconnect — router must fail the buffered command on TTL
      const failed = await console1.waitFor(
        (m) => m.type === 'failed' && m.requestId === 'req-4',
        'failed req-4',
        3000,
      );
      assert(failed.reason === 'tab-offline', `expected tab-offline, got ${failed.reason}`);
    });

    // 7. dirty mapping: disconnect without re-register → grace sweep prunes it
    await check('7. grace sweep prunes stale sessions', async () => {
      const agent3 = await connectWire(port);
      agent3.send({ type: 'hello', role: 'agent', agentId: 'sw-3', sessionIds: ['dirty-01'] });
      await sleep(100);
      agent3.ws.close();
      await closed(agent3);
      await sleep(3000); // grace 2000ms + sweep 300ms + margin
      console1.send({ type: 'hello', role: 'console' });
      const h = await console1.waitFor((m) => m.type === 'hello', 'final hello', 2000);
      assert(
        !h.sessions.some((s) => s.targetId === 'dirty-01'),
        'dirty-01 not pruned after grace',
      );
      assert(!h.sessions.some((s) => s.targetId === TARGET), 'acme-se-01 not pruned after grace');
    });

    console1.ws.close();
  } finally {
    if (!child.killed) child.kill();
    rmSync(home, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.log(`\nws-agent-check FAILED — ${failures} check(s) red`);
    process.exitCode = 1;
  } else {
    console.log('\nws-agent-check: all 7 checks PASS');
  }
}

main().catch((err) => {
  console.error(`ws-agent-check: ${err.message}`);
  process.exitCode = 1;
});
