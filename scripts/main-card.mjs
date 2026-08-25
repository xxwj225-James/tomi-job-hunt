// Find the main job card: it's the job-card containing .job-intro-container.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('scripts/liepin-real.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

const intro = doc.querySelector('.job-intro-container');
// climb to the nearest ancestor that has a class matching job-card / job-detail
let el = intro;
let mainCard = null;
for (let i = 0; i < 8 && el; i++) {
  const cls = String(el.className || '');
  if (/job-card|job-detail|job-main/.test(cls)) {
    mainCard = el;
    console.log('main card found at depth', i, ':', el.tagName, '.', cls.slice(0, 80));
    break;
  }
  el = el.parentElement;
}

if (mainCard) {
  console.log('\n=== selectors scoped to main card ===');
  const scoped = [
    '.job-title-box .name', '.name', 'h1', '.job-salary', '.salary',
    '.company-name', '.recruiter-name', '.job-detail-company-box .company-name',
  ];
  for (const sel of scoped) {
    const els = mainCard.querySelectorAll(sel);
    if (els.length) {
      console.log(`  ✓ ${sel} → ${els.length}x  "${(els[0].textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)}"`);
    } else {
      console.log(`  ✗ ${sel}`);
    }
  }
  // dump the card's structure
  console.log('\n=== main card inner HTML (first 1500 chars) ===');
  console.log(mainCard.innerHTML.replace(/\s+/g, ' ').slice(0, 1500));
}
