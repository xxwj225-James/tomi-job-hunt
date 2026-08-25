// Pinpoint the MAIN job card vs the 20 "猜你喜欢" recommendations:
// the main card has .job-intro-container; find its header siblings.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('scripts/liepin-real.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

const intro = doc.querySelector('.job-intro-container');
console.log('job-intro-container found:', !!intro);
if (intro) {
  // walk up to the main job container
  let el = intro;
  const chain = [];
  for (let i = 0; i < 6 && el; i++) {
    chain.push(`${el.tagName}.${String(el.className).slice(0, 60)}`);
    el = el.parentElement;
  }
  console.log('ancestor chain:', chain.join(' → '));
}

// inside .job-intro-container's top-level section: title, salary, company
console.log('\n=== job-intro-container first 1200 chars ===');
console.log((intro?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 1200));

// check specific selectors inside it
if (intro) {
  console.log('\n=== selectors scoped to .job-intro-container ===');
  const scoped = [
    'h1', '.name', '.job-salary', '.salary', '.company-name', '.recruiter-name',
    '.job-title-box', '.job-detail-header-box', '.job-detail-company-box',
  ];
  for (const sel of scoped) {
    const els = intro.querySelectorAll(sel);
    if (els.length) {
      console.log(`  ✓ ${sel} → ${JSON.stringify((els[0].textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60))}`);
    } else {
      console.log(`  ✗ ${sel}`);
    }
  }
  // and the same selectors document-wide with class filter on the main card
  console.log('\n=== document-wide with count ===');
  for (const sel of ['h1', '.job-title-box', '.job-salary', '.job-detail-company-box .company-name', '.recruiter-name', '.job-properties']) {
    const els = doc.querySelectorAll(sel);
    console.log(`  ${sel}: ${els.length} → ${els.length ? JSON.stringify((els[0].textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)) : ''}`);
  }
}
