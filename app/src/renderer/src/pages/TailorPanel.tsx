import { useEffect, useState } from 'react';
import { api, ApiError, downloadBlob } from '../lib/api';
import { renderMarkdown, safeFileName } from '../lib/markdown';
import { toJdParams, type JdRecord, type VerifyResult } from '../lib/types';

interface Props {
  jd: JdRecord;
}

interface Cached {
  md: string;
  verify?: VerifyResult;
}

const cache = new Map<string, Cached>();

export function TailorPanel({ jd }: Props): JSX.Element {
  const uid = jd.jobUid;
  const [md, setMd] = useState(() => cache.get(uid)?.md ?? '');
  const [verify, setVerify] = useState<VerifyResult | undefined>(() => cache.get(uid)?.verify);
  const [genBusy, setGenBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [exporting, setExporting] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    const c = cache.get(uid);
    setMd(c?.md ?? '');
    setVerify(c?.verify);
    setErr('');
  }, [uid]);

  function persist(mdNext: string, v?: VerifyResult): void {
    cache.set(uid, { md: mdNext, verify: v });
  }

  async function regenerate(): Promise<void> {
    setGenBusy(true);
    setErr('');
    try {
      const { tailoredMd } = await api.tailor(toJdParams(jd));
      setMd(tailoredMd);
      persist(tailoredMd, undefined);
      await verifyMd(tailoredMd);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setGenBusy(false);
    }
  }

  async function verifyMd(markdown: string): Promise<void> {
    setVerifyBusy(true);
    try {
      const res = await api.verify(markdown);
      setVerify(res);
      persist(markdown, res);
    } catch (e) {
      setVerify((v) => v ?? { fabricated: [], unverified: true });
      setErr((prev) => (prev ? `${prev}\n${e instanceof Error ? e.message : String(e)}` : e instanceof Error ? e.message : String(e)));
    } finally {
      setVerifyBusy(false);
    }
  }

  async function exportAs(format: 'md' | 'doc'): Promise<void> {
    if (!md) return;
    setExporting(format);
    try {
      const blob = await api.exportResume(md, format, `${jd.company}-${jd.title}`);
      const ext = format === 'doc' ? '.doc' : '.md';
      downloadBlob(blob, `${safeFileName(`${jd.company}-${jd.title}`)}-tailored${ext}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting('');
    }
  }

  const fabricated = verify?.fabricated ?? [];
  const blocked = fabricated.length > 0;
  const unverified = verify?.unverified ?? false;

  return (
    <div>
      <div className="tl-head">
        <div className="t">📝 定制简历 · {jd.title}</div>
        {md ? (
          <span className={`tl-badge ${blocked ? 'warn' : 'ok'}`}>
            {verifyBusy
              ? '事实校验中…'
              : blocked
                ? `⚠ 发现 ${fabricated.length} 处疑似编造`
                : unverified
                  ? '校验未完成（临时状态）'
                  : '✓ 已通过事实校验'}
          </span>
        ) : null}
      </div>

      <div className="tl-actions">
        <button className="btn sm primary" onClick={() => void regenerate()} disabled={genBusy || verifyBusy}>
          {genBusy ? '生成中…' : md ? '🔄 重新生成' : '✨ 生成定制简历'}
        </button>
        <button className="btn sm" onClick={() => void exportAs('doc')} disabled={!md || blocked || !!exporting}>
          {exporting === 'doc' ? '导出中…' : '⬇ 下载 .doc（Word）'}
        </button>
        <button className="btn sm" onClick={() => void exportAs('md')} disabled={!md || blocked || !!exporting}>
          {exporting === 'md' ? '导出中…' : '⬇ 下载 .md'}
        </button>
      </div>

      <div className="tl-note">
        仅基于原简历（resume.md）改写表述 / 重排序 / 强化 JD 关键词——不新增原简历没有的事实。每次生成后自动做「事实校验」，
        若发现编造（公司 / 时间 / 数字 / 证书 / 技能在原简历中不存在）会阻止导出并列出违规项。
      </div>

      {err ? <div className="error-note">{err}</div> : null}

      {md && !genBusy ? (
        <>
          <div className={`tl-check${blocked ? ' warn' : ''}`}>
            <div className="tl-check-head">
              <span className="chip ok" style={blocked ? { color: 'var(--danger)', borderColor: '#f5c2c2', background: '#fdecef' } : undefined}>
                {blocked ? '✕ 校验未通过' : '✓ 校验通过'}
              </span>
              <span className="muted">逐项比对「resume.md」：公司 / 时间 / 数字 / 证书 / 技能</span>
            </div>
            <div className="tl-check-list">
              {!fabricated.length ? (
                <div className="tl-check-row">
                  <span className="dot" />
                  <span className="txt">
                    {unverified ? '校验器暂时不可用，无法确认是否编造（可重新生成后再次校验）。' : '未发现原简历中不存在的事实'}
                  </span>
                </div>
              ) : (
                fabricated.map((f, i) => (
                  <div key={i} className="tl-check-row warn">
                    <span className="dot" />
                    <span className="txt">{f}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="tl-resume">
            <div className="tl-resume-head">
              <span className="section-title">简历预览（Markdown 渲染）</span>
              <span className="muted">关键词已对齐 JD · 仅本机处理</span>
            </div>
            <div className="tl-resume-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
          </div>
          <div className="tl-pdf-hint">
            「保存为 PDF」：下载 .doc 后用 Word / 浏览器打开 → 打印 → 目标选「另存为 PDF」。数据仅在本机处理，不上传。
          </div>
        </>
      ) : null}
    </div>
  );
}
