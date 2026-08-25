// Deep audit of the real liepin page: find the actual containers for
// title / company / salary / requirements so we can fix the extractor.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('scripts/liepin-real.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

// 1. where is the title? print the .name context
console.log('=== .name contexts (title candidates) ===');
for (const el of doc.querySelectorAll('.name')) {
  const parent = el.parentElement;
  console.log(
    '  tag=' + el.tagName,
    '| classes=' + el.className?.toString().slice(0, 50),
    '| text=' + JSON.stringify((el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)),
    '| parent=' + parent?.className?.toString().slice(0, 60),
  );
}

// 2. common job-detail container patterns on this build
console.log('\n=== class names containing job/pos/detail/title (top 30 by count) ===');
const counts = new Map();
for (const el of doc.querySelectorAll('[class]')) {
  const cls = String(el.className);
  if (/job|pos|detail|title|desc|require|salary|company|recruit/i.test(cls)) {
    const key = cls.slice(0, 80);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}
[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([cls, n]) => console.log(`  ${n}x  .${cls}`));

// 3. biggest text blocks (the JD body)
console.log('\n=== largest text blocks (JD body candidates) ===');
const blocks = [];
for (const el of doc.querySelectorAll('div, section, article')) {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > 100) blocks.push({ len: text.length, cls: String(el.className).slice(0, 70), text: text.slice(0, 80) });
}
blocks.sort((a, b) => b.len - a.len).slice(0, 10).forEach((b) => console.log(`  ${b.len} chars  .${b.cls}  "${b.text}"`));

// 4. does the HTML contain the raw JD text at all?
console.log('\n=== raw JD keywords present? ===');
for (const kw of ['研发总监', '智能家居', '云鲸', '任职要求', '岗位职责', '职位描述', '本科', '经验']) {
  console.log(`  ${kw}: ${html.includes(kw)}`);
}
