// Test if zhipin renders with stealth-ish flags (headless new mode + args).
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Users\\wuj\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe';

async function main() {
  // chromium new headless mode is harder to detect than old --headless
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
    ],
  });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    // @ts-ignore
    delete Object.getPrototypeOf(navigator).webdriver;
    // @ts-ignore
    window.chrome = window.chrome || { runtime: {} };
  });

  try {
    const resp = await page.goto('https://www.zhipin.com/web/geek/job?query=Java&city=101010100', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(6000);
    const html = await page.content();
    console.log('status:', resp ? resp.status() : null, 'html len:', html.length);
    console.log('body text len:', await page.evaluate(() => document.body?.innerText?.length ?? -1));
    const sample = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? '');
    console.log('text:', JSON.stringify(sample));
    const links = await page.evaluate(() =>
      [...document.querySelectorAll('a[href*="job_detail"]')].map((a) => a.getAttribute('href')).slice(0, 10),
    );
    console.log('job_detail links:', links.length);
    links.forEach((l) => console.log('  ' + l));
  } catch (err) {
    console.log('ERR:', err.message?.slice(0, 300));
  }
  await browser.close();
}

main();
