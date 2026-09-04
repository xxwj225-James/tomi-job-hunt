/** Minimal Markdown → HTML for the tailored-resume preview. Content is
 *  LLM-generated local text; we escape first, then re-apply a few safe tags. */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(md: string): string {
  const lines = md.split(/\r?\n/);
  const html: string[] = [];
  let inList = false;
  let listOrdered = false;

  const closeList = (): void => {
    if (inList) {
      html.push(listOrdered ? '</ol>' : '</ul>');
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      html.push('');
      continue;
    }
    const h1 = /^# (.+)$/.exec(line);
    const h2 = /^## (.+)$/.exec(line);
    const h3 = /^### (.+)$/.exec(line);
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    const num = /^\d+[.、)]\s+(.+)$/.exec(line);
    if (h1) { closeList(); html.push(`<div class="rv-h1">${inline(esc(h1[1]!))}</div>`); }
    else if (h2) { closeList(); html.push(`<div class="rv-h2">${inline(esc(h2[1]!))}</div>`); }
    else if (h3) { closeList(); html.push(`<div class="rv-sec">${inline(esc(h3[1]!))}</div>`); }
    else if (bullet || num) {
      const item = (bullet?.[1] ?? num?.[1])!;
      const ordered = Boolean(num);
      if (!inList || listOrdered !== ordered) {
        closeList();
        inList = true;
        listOrdered = ordered;
        html.push(ordered ? '<ol>' : '<ul>');
      }
      html.push(`<li>${inline(esc(item))}</li>`);
    } else if (/^---+\s*$/.test(line)) {
      closeList();
      html.push('<hr/>');
    } else {
      closeList();
      html.push(`<p>${inline(esc(line))}</p>`);
    }
  }
  closeList();
  return html.join('\n');
}

export function safeFileName(s: string): string {
  const cleaned = s.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60);
  return cleaned || 'resume';
}

export function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function zhCount(s: string): number {
  // Display heuristic for a "字" budget: CJK chars weigh 1, latin/digits 0.5,
  // punctuation 0.4. `warn` threshold in the UI is widened to absorb this.
  let n = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (/\s/.test(ch)) continue;
    if (code >= 0x3400 && code <= 0x9fff) n += 1; // CJK ideographs
    else if (/[A-Za-z0-9]/.test(ch)) n += 0.5;
    else if (/[　-〿＀-￯，。！？、；：（）]/.test(ch)) n += 0.3;
    else n += 0.6;
  }
  return Math.round(n);
}
