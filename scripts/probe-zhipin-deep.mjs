// Deeper probe: what does zhipin actually return? Check for login wall,
// JS-skeleton, or anti-bot empty shell.
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Users\\wuj\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe';

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();

  const requests = [];
  page.on('response', (resp) => {
    if (resp.status() >= 400 || /wapi|api|search|detail/i.test(resp.url())) {
      requests.push({ url: resp.url().slice(0, 140), status: resp.status(), type: resp.request().resourceType() });
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 200));
  });

  try {
    const resp = await page.goto('https://www.zhipin.com/web/geek/job?query=Java&city=101010100', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    console.log('status:', resp ? resp.status() : null);
    await page.waitForTimeout(3000);

    // raw html head
    const html = await page.content();
    console.log('html length:', html.length);
    console.log('html head:', html.slice(0, 600).replace(/\s+/g, ' '));
    console.log('\nbody innerText len:', (await page.evaluate(() => document.body?.innerText?.length ?? -1)));
    console.log('title:', await page.title());
    console.log('cookies:', (await page.context().cookies()).map((c) => `${c.name}=${c.value.slice(0, 10)}…`).join(', '));
  } catch (err) {
    console.log('ERR:', err.message?.slice(0, 400));
  }

  console.log('\n=== notable responses ===');
  requests.slice(0, 20).forEach((r) => console.log(`  ${r.status} ${r.type} ${r.url}`));
  await browser.close();
}

main();
