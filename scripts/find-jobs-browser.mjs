// Use the real browser to navigate zhipin search and capture job_detail links.
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Users\\wuj\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe';

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  const allLinks = new Set();

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/job_detail/')) {
      const m = url.match(/job_detail\/([A-Za-z0-9_]+)/);
      if (m) allLinks.add(url);
    }
    // also capture the wapi JSON if it fires
    if (url.includes('wapi/zpgeek/job/detail.json')) {
      try {
        const j = await resp.json();
        console.log('WAPI RESPONSE FOUND:', JSON.stringify(j).slice(0, 500));
      } catch {}
    }
  });

  const targets = [
    'https://www.zhipin.com/web/geek/job?query=后端工程师&city=101010100',
    'https://www.zhipin.com/web/geek/job?query=Java&city=101010100',
  ];

  for (const url of targets) {
    try {
      console.log(`\n=== goto ${url}`);
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      console.log('status:', resp ? resp.status() : null, 'final:', page.url());
      await page.waitForTimeout(4000);
      const text = await page.evaluate(() => document.body?.innerText?.slice(0, 400) ?? '');
      console.log('text sample:', JSON.stringify(text));

      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="job_detail"]')].map((a) => a.getAttribute('href')).slice(0, 15),
      );
      hrefs.forEach((h) => allLinks.add(new URL(h, page.url()).href));
      console.log('detail links on page:', hrefs.length);
    } catch (err) {
      console.log('ERR:', err.message?.slice(0, 300));
    }
  }

  console.log('\n=== collected job_detail URLs ===');
  [...allLinks].slice(0, 10).forEach((l) => console.log('  ' + l));
  await browser.close();
}

main();
