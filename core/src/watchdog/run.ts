/**
 * Watchdog CLI — daily "隐形优质岗位日报" (hidden job-pool digest).
 *
 *   npm run watch -w core
 *
 * fetch sources → dedupe against state file → LLM extract → write
 * ~/.tomi-job-hunt/digest/YYYY-MM-DD.md (+ Windows toast, best-effort).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadConfig, loadDotEnv } from '../config.js';
import { Logger } from '../logger.js';
import { createChatProvider } from '../llm/factory.js';
import { fetchAllSources, type RawItem } from './sources.js';
import { extractJobs, type JobEntry } from './extract.js';

function loadSeen(statePath: string): Set<string> {
  if (!existsSync(statePath)) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(statePath, 'utf8')) as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(statePath: string, seen: Set<string>): void {
  writeFileSync(statePath, JSON.stringify([...seen]), 'utf8');
}

function renderDigest(jobs: JobEntry[]): string {
  if (jobs.length === 0) return '# 今日隐形岗位日报\n\n今日未发现新的匹配内容。\n';
  const lines = ['# 今日隐形岗位日报', ''];
  for (const j of jobs) {
    lines.push(`## ${j.role} @ ${j.company}`);
    lines.push('');
    if (j.location) lines.push(`- 地点: ${j.location}${j.remote ? ' · 远程' : ''}`);
    if (j.tech) lines.push(`- 技术: ${j.tech}`);
    if (j.note) lines.push(`- 备注: ${j.note}`);
    if (j.contact) lines.push(`- 投递: ${j.contact}`);
    if (j.link) lines.push(`- 来源: ${j.link}`);
    lines.push('');
  }
  lines.push(`---\n生成于 ${new Date().toISOString()} · TomiHunt Watchdog`);
  return lines.join('\n');
}

/** Windows toast via PowerShell — best-effort, silent failure elsewhere. */
function notify(title: string, body: string): void {
  if (process.platform !== 'win32') return;
  try {
    const script = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null; $template = '<toast><visual><binding template="ToastText02"><text id="1">${title}</text><text id="2">${body}</text></binding></visual></toast>'; $xml = New-Object Windows.Data.Xml.Dom.XmlDocument; $xml.LoadXml($template); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('TomiHunt').Show(New-Object Windows.UI.Notifications.ToastNotification($xml))`;
    spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { stdio: 'ignore' }).unref();
  } catch {
    // toast is best-effort
  }
}

export async function runWatchdog(configDirOverride?: string): Promise<{ jobs: JobEntry[]; digestPath: string }> {
  loadDotEnv();
  const cfg = await loadConfig();
  const log = new Logger(cfg.logLevel, 'watchdog');
  const configDir = configDirOverride ?? cfg.configDir;
  const workDir = join(configDir, 'work');
  mkdirSync(workDir, { recursive: true });

  const provider = await createChatProvider(cfg.llm, log.child('llm'), workDir);
  const statePath = join(configDir, 'watchdog-state.json');
  const seen = loadSeen(statePath);

  log.info('watchdog: fetching sources (HN / V2EX / GitHub)…');
  const items: RawItem[] = await fetchAllSources();
  const fresh = items.filter((it) => !seen.has(it.id));
  log.info(`watchdog: ${items.length} items fetched, ${fresh.length} new`);

  const jobs = fresh.length > 0 ? await extractJobs(provider, fresh, log) : [];
  for (const it of items) seen.add(it.id);
  saveSeen(statePath, seen);

  const digestDir = join(configDir, 'digest');
  mkdirSync(digestDir, { recursive: true });
  const digestPath = join(digestDir, `${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(digestPath, renderDigest(jobs), 'utf8');
  log.info(`watchdog: digest written to ${digestPath} (${jobs.length} jobs)`);

  notify('TomiHunt 隐形岗位日报', `发现 ${jobs.length} 个新岗位：${digestPath}`);
  return { jobs, digestPath };
}

// CLI entry (guarded so tests can import runWatchdog without executing)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWatchdog().catch((err) => {
    console.error(`watchdog failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
