// Inspect the CONTENT container: where do title/salary/company live for the
// MAIN job (as opposed to the 20 recommendation cards)?
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('scripts/liepin-real.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

const intro = doc.querySelector('.job-intro-container');
const content = intro?.parentElement;
console.log('content container:', content?.tagName, '.', String(content?.className));

if (content) {
  // Direct children of CONTENT
  console.log('\n=== direct children of CONTENT ===');
  for (const child of content.children) {
    const text = (child.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70);
    console.log(`  ${child.tagName}.${String(child.className).slice(0, 50)}  "${text}"`);
  }
  // all heading-like elements inside CONTENT
  console.log('\n=== h1-h3 inside CONTENT ===');
  for (const h of content.querySelectorAll('h1,h2,h3')) {
    console.log(`  ${h.tagName}.${String(h.className).slice(0, 40)} = "${(h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)}"`);
  }
  // elements with job-title / job-salary / company inside CONTENT
  console.log('\n=== key selectors inside CONTENT ===');
  for (const sel of ['.job-title-box', '.job-salary', '.job-detail-company-box .company-name', '.recruiter-name', '.job-dq-box', '.job-labels-box']) {
    const els = content.querySelectorAll(sel);
    console.log(`  ${sel}: ${els.length}${els.length ? ` → "${(els[0].textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)}"` : ''}`);
  }
}
