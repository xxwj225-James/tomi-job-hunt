import { readFileSync } from 'node:fs';

const html = readFileSync('scripts/liepin-real.html', 'utf8');

// extract $CONFIG
const cfgMatch = html.match(/var \$CONFIG = (\{.*?\});\s*(?:<\/script>|var )/s);
if (cfgMatch) {
  try {
    const cfg = JSON.parse(cfgMatch[1]);
    console.log('=== $CONFIG keys ===');
    console.log(Object.keys(cfg).join(', '));
    console.log('\ncompName:', cfg.compName);
    console.log('jobName:', cfg.jobName ?? cfg.title ?? cfg.jobTitle);
    console.log('salary:', cfg.salary ?? cfg.salaryDesc ?? cfg.jobSalary);
  } catch (e) {
    console.log('$CONFIG parse failed:', e.message, '— raw:', cfgMatch[1].slice(0, 300));
  }
} else {
  console.log('no $CONFIG found');
}

// full JobPosting JSON-LD
const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
for (const block of ldMatch) {
  if (block.includes('JobPosting')) {
    try {
      const json = JSON.parse(block.replace(/<\/?script[^>]*>/g, ''));
      console.log('\n=== JobPosting fields ===');
      for (const [k, v] of Object.entries(json)) {
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        console.log(`  ${k}: ${s.slice(0, 200)}`);
      }
      console.log('\nhiringOrganization:', JSON.stringify(json.hiringOrganization));
      console.log('baseSalary:', JSON.stringify(json.baseSalary));
    } catch (e) {
      console.log('JobPosting parse failed:', e.message);
    }
  }
}
