// Fetch the provided liepin job URL and check what we get (login wall?
// anti-bot? real page?). Saves the HTML for offline DOM verification.
import { writeFileSync } from 'node:fs';

const URL =
  'https://www.liepin.com/a/79090643.shtml?pgRef=c_pc_home_page%3Ac_pc_home_hp_job_listcard%401_79090643%3A1%3A0c18fa5c-8f60-49f4-8392-11499620ad6e&d_sfrom=pc_hp_mix&head_id=voiffBFCih0wCNkNbnsebiyYajPvdLMs&as_from=pc_hp_mix&job_id=79090643&job_kind=1&d_ckId=voiffBFCih0wCNkNbnsebiyYajPvdLMs&d_headId=voiffBFCih0wCNkNbnsebiyYajPvdLMs&d_posi=2';

(async () => {
  const r = await fetch(URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  const html = await r.text();
  console.log('status:', r.status, 'final url:', r.url);
  console.log('html length:', html.length);
  console.log('--- title ---');
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  console.log(title);
  console.log('--- login wall? ---');
  console.log('contains 登录:', html.includes('登录') || /login|passport/i.test(html));
  console.log('--- job title in html? ---');
  const m = html.match(/岗位名称|职位名称|job-title|title-info/);
  console.log('job markers:', m ? m[0] : 'none');

  writeFileSync('scripts/liepin-real.html', html, 'utf8');
  console.log('saved to scripts/liepin-real.html');})();
