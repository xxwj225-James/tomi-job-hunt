/**
 * Real-site probe: launch the installed chromium via playwright-core and see
 * how far we get on zhipin/liepin without a logged-in profile.
 */
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Users\\wuj\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe';

async function probe(url, label) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2500);
    const info = {
      label,
      status: resp ? resp.status() : null,
      finalUrl: page.url(),
      title: await page.title().catch(() => ''),
      bodyLen: (await page.content()).length,
      // visible body text sample
      textSample: (await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '')) || '',
      hasLoginForm: await page.evaluate(() => !!document.querySelector('input[type=password], .login-form, .login-dialog')),
      hasCaptcha: await page.evaluate(() => /验证|滑块|captcha|geetest/i.test(document.body?.innerText ?? '')),
    };
    console.log(JSON.stringify(info, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ label, error: err.message?.slice(0, 300) }, null, 2));
  } finally {
    await browser.close();
  }
}

const targets = [
  ['https://www.zhipin.com/', 'zhipin-home'],
  ['https://www.zhipin.com/job_detail/3000000001.html', 'zhipin-job-detail'],
  ['https://www.liepin.com/', 'liepin-home'],
  ['https://www.liepin.com/job/1.shtml', 'liepin-job-detail'],
];

for (const [url, label] of targets) {
  await probe(url, label);
}
