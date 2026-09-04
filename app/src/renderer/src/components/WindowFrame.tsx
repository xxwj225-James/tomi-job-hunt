import type { CoreStateMsg } from '../env';
import { GatewayBadge } from './GatewayBadge';

interface Props {
  core: CoreStateMsg | null;
  provider?: string;
  agents?: number;
  sessionsOnline?: number;
  jdContext?: string;
  onOpenSettings: () => void;
}

/** Frameless-window header (drag region): brand + gateway state + window controls. */
export function WindowFrame({ core, provider, agents, sessionsOnline, jdContext, onOpenSettings }: Props): JSX.Element {
  return (
    <header className="win-head">
      <div className="brand">
        🤖 TomiHunt
        {jdContext ? <em>· {jdContext}</em> : null}
      </div>
      {core ? (
        <GatewayBadge core={core} provider={provider} agents={agents} sessionsOnline={sessionsOnline} />
      ) : null}
      <div className="spacer" />
      <button className="win-btn tools" title="打开浏览器插件目录（加载已解压的扩展程序用）" onClick={() => window.tomi?.openExtDir()}>
        📁 插件目录
      </button>
      <button className="win-btn tools" title="打开浏览器的扩展管理页（地址会复制到剪贴板）" onClick={() => window.tomi?.openExtensionsPage()}>
        🧩 扩展页
      </button>
      <button className="win-btn gear" title="设置" onClick={onOpenSettings}>
        ⚙
      </button>
      <button className="win-btn" title="最小化" onClick={() => window.tomi?.windowAction('minimize')}>
        ─
      </button>
      <button className="win-btn" title="关闭（退出）" onClick={() => window.tomi?.windowAction('close')}>
        ✕
      </button>
    </header>
  );
}
