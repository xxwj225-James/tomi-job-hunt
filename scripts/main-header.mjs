// Where is .job-properties (unique) and what's around it? That's the main
// job header. Also: what h1/header-like structure holds the main title?
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('scripts/liepin-real.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

const props = doc.querySelector('.job-properties');
console.log('job-properties:', props ? (props.textContent ?? '').replace(/\s+/g, ' ').trim() : 'none');
if (props) {
  let el = props;
  const chain = [];
  for (let i = 0; i < 6 && el; i++) {
    chain.push(`${el.tagName}.${String(el.className).slice(0, 50)}`);
    el = el.parentElement;
  }
  console.log('ancestors:', chain.join(' → '));
  const header = props.parentElement?.parentElement;
  console.log('\n=== header container innerText (first 600) ===');
  console.log((header?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 600));
}

// search the whole doc for the main title text in a heading/div with 研发总监（智能家居）
console.log('\n=== elements containing 研发总监（智能家居） ===');
for (const el of doc.querySelectorAll('*')) {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text.includes('研发总监（智能家居）') && text.length < 200) {
    console.log(`  ${el.tagName}.${String(el.className).slice(0, 60)}  len=${text.length}`);
  }
}
