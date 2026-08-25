// Verify: is the main job's company in $CONFIG (某深圳贸易进出口公司) or the
// DOM (.company-name → 云鲸智能 is from the recommendation card)?
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('scripts/liepin-real.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

console.log('$CONFIG compName:', doc.querySelector('script')?.textContent?.match(/compName\\?"?\s*:\s*"([^"]+)/)?.[1] ?? 'n/a');

// Where does 云鲸智能 sit relative to the job-apply-container?
const apply = doc.querySelector('.job-apply-container');
const yunjingEls = [...doc.querySelectorAll('*')].filter((e) => (e.textContent ?? '').includes('云鲸智能'));
console.log('\n云鲸智能 element contexts:');
for (const el of yunjingEls.slice(0, 5)) {
  const inApply = apply?.contains(el);
  const cls = String(el.className || '').slice(0, 50);
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
  console.log(`  ${el.tagName}.${cls} inApply=${inApply} :: "${text}"`);
}

// recruiter container: 岳先生 is the headhunter for THIS job (猎头)
const recruiter = doc.querySelector('.recruiter-container');
console.log('\nrecruiter-container text:', (recruiter?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120));
