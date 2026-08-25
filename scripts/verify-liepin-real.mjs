// Run the REAL liepin extractor against the REAL saved page HTML.
// This is the "real page verification" step: does extractLiepinJd still work
// on the current liepin DOM?
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Use the actual content script from the extension (not a re-implementation).
const { extractLiepinJd, waitForJd } = await import('../extension/src/content/liepin.js');

const html = readFileSync('scripts/liepin-real.html', 'utf8');
const dom = new JSDOM(html, { url: 'https://www.liepin.com/a/79090643.shtml' });
const doc = dom.window.document;

console.log('=== extractLiepinJd on REAL page ===');
const jd = extractLiepinJd(doc);
if (jd) {
  console.log('TITLE:    ', jd.title);
  console.log('COMPANY:  ', jd.company);
  console.log('SALARY:   ', jd.salaryText);
  console.log('HR:       ', jd.hrName);
  console.log('REQ LEN:  ', jd.requirements.length);
  console.log('REQ HEAD: ', jd.requirements.slice(0, 200));
} else {
  console.log('❌ extractLiepinJd returned null — selectors may be outdated');
}

console.log('\n=== waitForJd (polling, as the real content script does) ===');
const jd2 = await waitForJd(doc, 2000, 200);
console.log(jd2 ? `✅ waitForJd resolved: ${jd2.title}` : '❌ waitForJd timed out');

console.log('\n=== selector coverage audit ===');
const candidates = [
  ['.title-info h1', 'title-info h1'],
  ['.job-title h1', 'job-title h1'],
  ['.title h1', 'title h1'],
  ['.company-info .name', 'company-info .name'],
  ['.job-company-name', 'job-company-name'],
  ['.company-name', 'company-name'],
  ['.company-logo h1', 'company-logo h1'],
  ['.job-item-title', 'job-item-title'],
  ['.salary', 'salary'],
  ['.job-main-title .job-item-title', 'job-main-title .job-item-title'],
  ['.job-description', 'job-description'],
  ['.content-word', 'content-word'],
  ['.job-detail .content', 'job-detail .content'],
  ['.dd.noborder', 'dd.noborder'],
  ['.recruiter-name', 'recruiter-name'],
  ['.job-recruiter .name', 'job-recruiter .name'],
  ['.head-hunter-name', 'head-hunter-name'],
];
for (const [sel, label] of candidates) {
  const els = doc.querySelectorAll(sel);
  if (els.length > 0) {
    const sample = (els[0].textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    console.log(`  ✓ ${label} → ${els.length} match(es): "${sample}"`);
  } else {
    console.log(`  ✗ ${label} → 0 matches`);
  }
}
