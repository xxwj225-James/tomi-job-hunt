/**
 * Workspace JD helpers — a small parse so pasted JD text pre-fills the mock
 * interview / tailored-resume forms. Deliberately minimal (the HR page keeps
 * its own richer copy in hr/src/screen.ts).
 */

export interface WsJd {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
  url?: string;
}

export function jdFromText(raw: string): WsJd {
  const text = raw.trim();
  const pick = (re: RegExp): string => {
    const m = re.exec(text);
    return m?.[1]?.trim() ?? '';
  };
  const firstLine = text.split('\n').find((l) => l.trim())?.trim().slice(0, 30) ?? '';
  return {
    title:
      pick(/岗位[:：]\s*([^\n，。;；]+)/) ||
      pick(/职位[:：]\s*([^\n，。;；]+)/) ||
      pick(/招聘[:：]\s*([^\n，。;；]+)/) ||
      firstLine,
    company: pick(/公司[:：]\s*([^\n，。;；]+)/) || pick(/公司名称[:：]\s*([^\n，。;；]+)/) || '',
    salaryText: pick(/(\d+(?:\.\d+)?\s*[Kk万]?\s*[-~—至到]\s*\d+(?:\.\d+)?\s*[Kk万])/) || '',
    requirements: text,
  };
}

export function jdKey(jd: { title: string; company: string }): string {
  return `${jd.title}|${jd.company}`;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
