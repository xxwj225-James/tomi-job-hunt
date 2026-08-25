// Debug: why doesn't parseConfig find $CONFIG in the JSDOM-parsed doc?
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('scripts/liepin-real.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

// 1. find the script containing $CONFIG
let found = 0;
for (const el of doc.querySelectorAll('script')) {
  const text = el.textContent ?? '';
  if (text.includes('$CONFIG')) {
    found++;
    const idx = text.indexOf('var $CONFIG');
    console.log(`script #${found}: snippet = ${JSON.stringify(text.slice(idx, idx + 200))}`);
    // test the exact regex
    const m = text.match(/var \$CONFIG = (\{[\s\S]*?\});\s*(?:<\/script>|var )/);
    console.log('regex match:', m ? 'YES' : 'NO', m ? m[1].slice(0, 120) : '');
    // try simpler
    const m2 = text.match(/var \$CONFIG = (\{.*?\});/s);
    console.log('simple regex:', m2 ? 'YES' : 'NO');
    if (m2) {
      try {
        const cfg = JSON.parse(m2[1]);
        console.log('parsed compName:', cfg.compName, 'jobTitle:', cfg.jobTitle);
      } catch (e) {
        console.log('parse err:', e.message.slice(0, 100));
      }
    }
  }
}
console.log('total $CONFIG scripts:', found);
