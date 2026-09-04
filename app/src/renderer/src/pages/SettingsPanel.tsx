import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Switch } from '../components/Switch';
import type { SetupConfig, UsageStatus } from '../lib/types';
import type { ExtInfo, UpdaterStatus } from '../env';

interface Props {
  base: string | null;
  onClose: () => void;
  onConfigSaved: () => void;
}

interface AppToggles {
  autoLaunch: boolean;
  alwaysOnTop: boolean;
}

const DEV_EXTENSION_DIR_HINT = `开发模式：扩展构建产物在 extension/dist，加载该目录即可。`;

/** Chat providers the local core can drive directly (deepseek/kimi/qwen presets
 *  mirror core `PROVIDER_PRESETS`; openai-compatible needs explicit baseUrl). */
const PROVIDER_OPTIONS: Array<{ id: string; label: string; site: string; baseUrl: string; model: string }> = [
  { id: 'deepseek', label: 'DeepSeek', site: 'platform.deepseek.com', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
  { id: 'kimi', label: 'Kimi（月之暗面）', site: 'platform.moonshot.cn', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6' },
  { id: 'qwen', label: '通义千问（阿里云百炼）', site: 'bailian.console.aliyun.com', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-plus' },
  { id: 'openai-compatible', label: '自定义 / OpenAI 兼容', site: '', baseUrl: '', model: '' },
];

function providerOptions(current: string | undefined): Array<{ id: string; label: string; site: string; baseUrl: string; model: string }> {
  const list = [...PROVIDER_OPTIONS];
  // Keep showing a provider core supports but we have no preset for (claude-code…).
  if (current && !list.some((o) => o.id === current)) list.push({ id: current, label: current, site: '', baseUrl: '', model: '' });
  return list;
}

export function SettingsPanel({ base, onClose, onConfigSaved }: Props): JSX.Element {
  const [cfg, setCfg] = useState<SetupConfig | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [toggles, setToggles] = useState<AppToggles>({ autoLaunch: false, alwaysOnTop: true });
  const [usageStatus, setUsageStatus] = useState<UsageStatus | null>(null);
  const [info, setInfo] = useState<{ version: string; platform: string } | null>(null);
  const [ext, setExt] = useState<ExtInfo | null>(null);
  const [upd, setUpd] = useState<UpdaterStatus>({ state: 'idle' });
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  const loadCfg = useCallback(async () => {
    try {
      const c = await api.config();
      setCfg(c);
      setProvider(c.provider);
      setModel(c.model);
      setBaseUrl(c.baseUrl);
    } catch {
      setStatus({ ok: false, msg: '读取配置失败：本地服务可能尚未就绪' });
    }
  }, []);

  useEffect(() => {
    void loadCfg();
    window.tomi?.appInfo().then((i) => setInfo(i)).catch(() => undefined);
    window.tomi?.extInfo().then((e) => setExt(e)).catch(() => undefined);
    window.tomi?.updater.status().then((s) => setUpd(s)).catch(() => undefined);
    api.usageGet().then((u) => setUsageStatus(u)).catch(() => undefined);
    const offUpd = window.tomi?.updater.onStatus((s) => setUpd(s));
    if (window.tomi) {
      void (async () => {
        try {
          const autoLaunch = await window.tomi!.autoLaunch.get();
          setToggles((t) => ({ ...t, autoLaunch: autoLaunch ?? false }));
        } catch {
          /* ignore */
        }
      })();
    }
    return () => offUpd?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function test(): Promise<void> {
    let key = apiKey.trim();
    if (!key && cfg?.apiKeySet) {
      try {
        const shown = await api.showKey();
        key = shown.apiKey ?? '';
      } catch {
        /* fall through to the not-configured branch below */
      }
    }
    if (!key) {
      setStatus({ ok: false, msg: '请先填写 API Key 再测试连接' });
      return;
    }
    setBusy(true);
    setStatus({ ok: true, msg: '正在测试连接…' });
    try {
      const r = await api.testConfig({ provider: provider || 'deepseek', model: model || undefined, apiKey: key || undefined, baseUrl: baseUrl || undefined });
      setStatus({ ok: r.ok, msg: r.ok ? `✅ ${r.message ?? '连接成功'}` : `❌ ${r.error ?? '连接失败'}` });
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      const patch: Record<string, unknown> = { provider: provider || 'deepseek' };
      if (model) patch.model = model;
      if (apiKey) patch.apiKey = apiKey;
      if (baseUrl) patch.baseUrl = baseUrl;
      const r = await api.saveConfig(patch);
      if (r.ok) {
        setStatus({ ok: true, msg: '✅ 设置已保存并立即生效' });
        setApiKey('');
        await loadCfg();
        onConfigSaved();
      } else {
        setStatus({ ok: false, msg: `❌ ${r.error ?? '保存失败'}` });
      }
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  function changeProvider(id: string): void {
    setProvider(id);
    const o = PROVIDER_OPTIONS.find((p) => p.id === id);
    if (o) {
      // Presets are not interchangeable across providers — overwrite so the user
      // never accidentally sends a DeepSeek model name to Kimi/Qwen.
      setModel(o.model);
      setBaseUrl(o.baseUrl);
    }
  }

  async function uploadResume(file: File | null): Promise<void> {
    if (!file) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const r = await api.uploadResume(file);
      setUploadMsg(r.ok ? `✅ ${r.message ?? '简历已保存'}` : `❌ ${r.error ?? '上传失败'}`);
    } catch (e) {
      setUploadMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  }

  const toggle = (k: keyof AppToggles): void => {
    const next = !toggles[k];
    setToggles((t) => ({ ...t, [k]: next }));
    if (k === 'autoLaunch') void window.tomi?.autoLaunch.set(next);
    else if (k === 'alwaysOnTop') void window.tomi?.setAlwaysOnTop(next);
  };

  // Opt-in anonymous usage telemetry (default OFF). Live-toggle — separate from
  // the LLM "保存" button — so consent applies immediately on its own endpoint.
  async function toggleUsage(): Promise<void> {
    const next = !(usageStatus?.consent ?? false);
    const reflect = (on: boolean): void =>
      setUsageStatus((s) => ({ ...(s ?? { collectorUrl: '', day: '', events: {} }), consent: on }));
    reflect(next); // optimistic
    try {
      const r = await api.usageSet({ consent: next });
      if (!r.ok) {
        reflect(!next);
        setStatus({ ok: false, msg: `❌ ${r.error ?? '操作失败，请稍后再试'}` });
        return;
      }
      if (next) {
        // First opt-in today — report presence immediately so the DAU row
        // appears even before the next app launch.
        void api.usagePresence(info?.version).catch(() => undefined);
      }
    } catch (e) {
      reflect(!next);
      setStatus({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    }
  }

  const opts = providerOptions(cfg?.provider);
  const opt = opts.find((o) => o.id === provider);

  return (
    <div className="overlay">
      <div className="ov-head">
        <div style={{ fontWeight: 700, fontSize: 14 }}>⚙ 设置</div>
        <button className="btn sm" onClick={onClose}>
          ✕ 关闭
        </button>
      </div>
      <div className="ov-scroll">
        <div className="ov-sets">
          <div className="set-card">
            <div className="section-title">LLM · {opt?.label ?? provider}</div>
            <div className="set-row">
              <div className="lab">服务商</div>
              <div className="desc">DeepSeek / Kimi / 通义千问 可直接用</div>
              <div className="ctl">
                <select value={provider} onChange={(e) => changeProvider(e.target.value)}>
                  {opts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {cfg?.apiKeySet ? (
              <div className="set-row">
                <div className="lab">API Key</div>
                <div className="desc">
                  已保存（{cfg.apiKeyMasked}）。留空保存 = 不修改。
                </div>
                <div className="ctl">
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="粘贴新的 sk-…" />
                </div>
              </div>
            ) : (
              <div className="set-row">
                <div className="lab">API Key *</div>
                <div className="desc">尚未配置，首次使用请填写并保存。</div>
                <div className="ctl">
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
                </div>
              </div>
            )}
            <div className="set-row">
              <div className="lab">模型</div>
              <div className="desc">留空用服务商默认</div>
              <div className="ctl">
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder={opt?.model || '（如 deepseek-v4-flash）'} />
              </div>
            </div>
            <div className="set-row">
              <div className="lab">API 地址</div>
              <div className="desc">默认用服务商预设</div>
              <div className="ctl">
                <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={opt?.baseUrl || 'https://…（OpenAI 兼容地址）'} />
              </div>
            </div>
            <div className="set-row">
              <div className="lab">连接</div>
              <div className="desc">保存时也可先测试</div>
              <div className="ctl">
                <button className="btn sm" onClick={() => void test()} disabled={busy}>
                  测试连接
                </button>
                <button className="btn sm primary" onClick={() => void save()} disabled={busy}>
                  {busy ? '处理中…' : '保存'}
                </button>
              </div>
            </div>
            {status ? (
              <div className={`send-result ${status.ok ? 'ok' : 'err'}`} style={{ marginTop: 8 }}>
                {status.msg}
              </div>
            ) : null}
            <div className="key-guide">
              {opt && opt.site ? (
                <>
                  <b>如何获取 {opt.label} API Key（第一次使用？）</b>
                  <ol>
                    <li>
                      浏览器打开 <b>{opt.site}</b>，注册 / 登录账号；
                    </li>
                    <li>
                      进入「API Keys」→「创建 API Key」→ 复制以 <code>sk-</code> 开头的密钥；
                    </li>
                    <li>
                      上方服务商选 <b>{opt.label}</b> → 粘贴 API Key → 点「保存」，立即生效。
                    </li>
                  </ol>
                </>
              ) : (
                <>
                  <b>自定义 / OpenAI 兼容服务商</b>
                  <div>在上方填写完整的 API 地址、模型名与 API Key，保存前可先点「测试连接」。</div>
                </>
              )}
              <div className="tip">⚠ 普通用户不用调模型，服务商默认模型即可。</div>
              <div className="tip">🔒 API Key 仅保存在本机（系统加密存储），不会上传。</div>
            </div>
          </div>

          <div className="set-card">
            <div className="section-title">简历</div>
            <div className="set-note">
              打招呼 / 匹配 / 定制简历都会结合本机简历。存放于 <code>{cfg?.configDir ?? '~/.tomi-job-hunt'}</code>（resume.md / resume.docx / resume.pdf）。
            </div>
            <div className="set-row">
              <div className="lab">上传简历</div>
              <div className="desc">PDF / Word / txt / md，解析成功立即生效</div>
              <div className="ctl">
                <label className="btn sm" style={{ cursor: 'pointer' }}>
                  {uploading ? '上传中…' : '选择文件'}
                  <input type="file" hidden accept=".pdf,.docx,.txt,.md" onChange={(e) => void uploadResume(e.target.files?.[0] ?? null)} />
                </label>
                <button className="btn sm" onClick={() => window.tomi?.openConfigDir()}>
                  打开目录
                </button>
              </div>
            </div>
            {uploadMsg ? (
              <div className={`send-result ${uploadMsg.startsWith('✅') ? 'ok' : 'err'}`} style={{ marginTop: 6 }}>
                {uploadMsg}
              </div>
            ) : null}
          </div>

          <div className="set-card">
            <div className="section-title">应用</div>
            <div className="set-row">
              <div className="lab">开机自启动</div>
              <div className="desc">登录 Windows 后自动常驻</div>
              <div className="ctl">
                <Switch on={toggles.autoLaunch} onChange={() => toggle('autoLaunch')} />
              </div>
            </div>
            <div className="set-row">
              <div className="lab">悬浮窗置顶</div>
              <div className="desc">浮在浏览器 / 其他窗口上方</div>
              <div className="ctl">
                <Switch on={toggles.alwaysOnTop} onChange={() => toggle('alwaysOnTop')} />
              </div>
            </div>
            <div className="set-row">
              <div className="lab">帮助改进 TomiHunt</div>
              <div className="desc">
                默认关闭。开启后仅在本地记录功能使用次数，并按天上传匿名汇总（不含简历 / JD / 聊天内容），可随时关闭。
              </div>
              <div className="ctl">
                <Switch on={usageStatus?.consent ?? false} onChange={() => void toggleUsage()} />
              </div>
            </div>
          </div>

          <div className="set-card">
            <div className="section-title">浏览器插件（聊天框填入器）</div>
            {ext?.prepared ? (
              <>
                <div className="set-note">
                  App 把话术填入浏览器的聊天框并高亮，由你在页面确认后手动发送——插件不会自动发送。
                  插件已就位（v{ext.version}），只需在浏览器手动加载这一次；App 更新会原地覆盖下方目录，扩展页若提示变化点 🔄 刷新即可（浏览器不允许外部程序静默安装插件）。
                </div>
                <div className="ext-dir-box">
                  <div className="edb-lab">
                    📁 插件目录 —— 扩展页选「加载已解压的扩展程序」时选中它（可复制）
                  </div>
                  <code className="edb-path">{ext.dir}</code>
                  <div className="edb-actions">
                    <button className="btn sm" onClick={() => window.tomi?.openExtDir()}>
                      打开插件目录
                    </button>
                    <button className="btn sm primary" onClick={() => window.tomi?.openExtensionsPage()}>
                      打开扩展页
                    </button>
                  </div>
                </div>
                <div className="tip" style={{ marginTop: 8 }}>
                  Chrome / Edge 不允许程序自动跳转其内部页，点「打开扩展页」不会重启浏览器——会把地址复制到剪贴板，在浏览器地址栏 Ctrl+L 粘贴回车即可到达。
                </div>
              </>
            ) : (
              <>
                <div className="set-note">
                  浏览器插件负责把 AI 话术填入聊天框并高亮，由你在页面确认后手动发送——不会自动发送。加载后回到 App，JD 列表会出现「● 在线」徽标。
                </div>
                <div className="tip">{DEV_EXTENSION_DIR_HINT}</div>
                <div className="set-row">
                  <div className="lab">加载 / 刷新</div>
                  <div className="desc">浏览器扩展页 → 开发者模式 → 加载已解压的扩展程序</div>
                  <div className="ctl">
                    <button className="btn sm" onClick={() => window.tomi?.openExtensionsPage()}>
                      打开扩展页
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="set-card">
            <div className="section-title">关于</div>
            <div className="set-note">
              TomiHunt Agent v{info?.version ?? 'dev'} · 本地优先求职助手 · 数据默认不出本机（可选匿名统计，默认关闭）
              <br />
              本地服务 {base ?? '未连接'} · 端口占用自动顺延（34567-34570）
            </div>
            <div className="set-row">
              <div className="lab">自动更新</div>
              <div className="desc">
                {upd.state === 'downloading'
                  ? `正在下载 v${upd.version}… ${upd.percent ?? 0}%`
                  : upd.state === 'available'
                    ? `发现新版本 v${upd.version}`
                    : upd.state === 'downloaded'
                      ? `v${upd.version} 已下载`
                      : upd.state === 'checking'
                        ? '正在检查更新…'
                        : upd.state === 'not-available'
                          ? '已是最新版本'
                          : upd.state === 'error'
                            ? `检查失败：${upd.message ?? '未知错误'}`
                            : upd.state === 'disabled'
                              ? upd.message ?? '开发版不支持自动更新'
                              : '尚未检查更新'}
              </div>
              <div className="ctl">
                {upd.state === 'available' ? (
                  <button className="btn sm primary" onClick={() => void window.tomi?.updater.download().then(setUpd)}>
                    下载更新
                  </button>
                ) : upd.state === 'downloaded' ? (
                  <button className="btn sm primary" onClick={() => void window.tomi?.updater.quitAndInstall()}>
                    重启安装
                  </button>
                ) : upd.state === 'downloading' ? (
                  <button className="btn sm" disabled>
                    下载中…
                  </button>
                ) : null}
                {upd.state !== 'downloading' && upd.state !== 'downloaded' ? (
                  <button className="btn sm" onClick={() => void window.tomi?.updater.check().then(setUpd)} disabled={upd.state === 'checking'}>
                    {upd.state === 'checking' ? '检查中…' : '检查更新'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
