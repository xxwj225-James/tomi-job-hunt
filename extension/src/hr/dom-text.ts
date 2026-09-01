/**
 * Lightweight page-text extraction for HR content scripts — a small mirror of
 * shared.ts `stripHidden`/`pickText`/`pickLongText`, kept standalone so HR
 * bundles don't drag in the job-seeker content-script logic (CoreClient,
 * backend, board, feedback). Only inline-hidden stripping; the job-seeker
 * shared.ts additionally scans stylesheet rules, which HR selectors don't need.
 */

/** First non-empty cleaned text across candidate selectors. */
export function pickText(doc: Document, selectors: string[]): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const text = cleanedText(el);
    if (text) return text;
  }
  return '';
}

/** Longest cleaned text among candidates (resume sections are long-form). */
export function pickLongText(doc: Document, selectors: string[]): string {
  let best = '';
  for (const sel of selectors) {
    for (const el of doc.querySelectorAll(sel)) {
      const text = cleanedText(el);
      if (text.length > best.length) best = text;
    }
  }
  return best;
}

function cleanedText(node: Element): string {
  const clone = node.cloneNode(true) as Element;
  for (const el of clone.querySelectorAll<HTMLElement>('*')) {
    const style = el.style;
    if (style.display === 'none' || style.visibility === 'hidden' || style.width === '0px' || style.height === '0px') {
      el.remove();
    }
  }
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}
