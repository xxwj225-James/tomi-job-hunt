import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('scripts/liepin-real.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

console.log('=== JSON-LD blocks ===');
for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
  console.log((el.textContent ?? '').slice(0, 900));
  console.log('---');
}

console.log('=== meta tags ===');
for (const m of doc.querySelectorAll('meta[name], meta[property]')) {
  const name = m.getAttribute('name') || m.getAttribute('property') || '';
  const content = m.getAttribute('content') || '';
  if (/job|title|company|description|keyword/i.test(name) || content.includes('研发')) {
    console.log(`${name} = ${content.slice(0, 150)}`);
  }
}

console.log('=== window.__INITIAL_STATE__ or CONFIG script? ===');
for (const el of doc.querySelectorAll('script')) {
  const src = el.getAttribute('src') || '';
  const text = (el.textContent ?? '').slice(0, 200);
  if (/CONFIG|initialState|jobInfo|company/.test(text)) {
    console.log(`[inline script] ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  if (/__INITIAL_STATE__|window\.CONFIG/.test(src)) {
    console.log(`[src] ${src.slice(0, 150)}`);
  }
}
