import type { CoreStateMsg } from '../env';

interface Props {
  core: CoreStateMsg;
  provider?: string;
  agents?: number;
  sessionsOnline?: number;
}

/** Header status pill: core adoption state + provider + live agent/session counts. */
export function GatewayBadge({ core, provider, agents, sessionsOnline }: Props): JSX.Element {
  if (core.kind === 'missing' || core.kind === 'stopped') {
    return (
      <span className="status-line">
        <span className="dot err" />
        <b>服务离线</b>
        {core.reason ? <span title={core.reason}>（{core.reason}）</span> : null}
      </span>
    );
  }
  if (core.kind === 'forked' && !core.base) {
    return (
      <span className="status-line">
        <span className="dot warn" />
        <b>正在启动本地服务…</b>
      </span>
    );
  }
  const sess = sessionsOnline ?? 0;
  const parts = [];
  if (provider) parts.push(provider === 'deepseek' ? 'DeepSeek' : provider);
  if (agents) parts.push(`${agents} 插件`);
  if (sess) parts.push(`${sess} 会话`);
  return (
    <span className="status-line" title="本地服务在线（数据默认不出本机；可选匿名统计，默认关闭）">
      <span className="dot ok" />
      <b>网关在线</b>
      {parts.length ? <span>· {parts.join(' · ')}</span> : null}
    </span>
  );
}
