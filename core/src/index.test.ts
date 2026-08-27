import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { probePort, resolvePort } from './index.js';
import { Logger } from './logger.js';

const silentLog = new Logger('error', 'test');

describe('probePort', () => {
  it('reports a high random port as free', async () => {
    expect(await probePort(43117)).toBe(true);
  });
});

describe('resolvePort', () => {
  it('uses an explicitly configured port verbatim (no shifting)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-port-'));
    const old = process.env.TOMI_PORT;
    process.env.TOMI_PORT = '45678';
    try {
      // cfgPort mirrors what loadConfig derived from the env; resolvePort
    // must use it verbatim (no shifting)
    expect(await resolvePort(dir, 45678, silentLog)).toBe(45678);
    } finally {
      if (old === undefined) delete process.env.TOMI_PORT;
      else process.env.TOMI_PORT = old;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('auto-selects the base port when free and records port.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-port-'));
    const port = await resolvePort(dir, 43567, silentLog);
    expect(port).toBe(43567);
    // port.json written by resolvePort
    const recorded = JSON.parse(readFileSync(join(dir, 'core-port.json'), 'utf8')) as { port: number };
    expect(recorded.port).toBe(43567);
    rmSync(dir, { recursive: true, force: true });
  });
});
