import { readFileSync } from 'node:fs';

const html = readFileSync('scripts/liepin-real.html', 'utf8');

// JobPosting block with control chars cleaned
const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
for (const block of m) {
  if (!block.includes('JobPosting')) continue;
  const raw = block.replace(/<\/?script[^>]*>/g, '');
  const cleaned = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
  try {
    const json = JSON.parse(cleaned);
    console.log('=== JobPosting (cleaned parse) ===');
    console.log('title:', json.title);
    console.log('salary:', JSON.stringify(json.baseSalary ?? json.estimatedSalary));
    const org = json.hiringOrganization;
    console.log('hiringOrganization:', JSON.stringify(org));
    console.log('jobLocation:', JSON.stringify(json.jobLocation));
    console.log('employmentType:', json.employmentType);
    console.log('datePosted:', json.datePosted);
    console.log('desc len:', (json.description ?? '').length);
  } catch (e) {
    console.log('still fails:', e.message.slice(0, 120));
    // try to pull key fields with regex
    const title = raw.match(/"title"\s*:\s*"([^"]+)"/)?.[1];
    const salary = raw.match(/"value"\s*:\s*\{[^}]*"value"\s*:\s*(\d+)[^}]*"currency"\s*:\s*"([^"]+)"/s);
    const orgName = raw.match(/"hiringOrganization"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/s);
    const base = raw.match(/"baseSalary"\s*:\s*\{[\s\S]*?"value"\s*:\s*(\d+)[\s\S]*?"currency"\s*:\s*"([^"]+)"/s);
    console.log('regex title:', title);
    console.log('regex baseSalary:', base ? `${base[1]} ${base[2]}` : 'n/a');
    console.log('regex org:', orgName?.[1]);
  }
}
