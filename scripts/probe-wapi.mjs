// Probe the zhipin detail API directly via Node fetch (same path the
// extension uses: /wapi/zpgeek/job/detail.json?jid=...).
// First we need a real jid — try the site's own search API.
const BASE = 'https://www.zhipin.com';

async function tryFetch(url, opts = {}) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': BASE + '/',
    ...(opts.headers || {}),
  };
  const r = await fetch(url, { ...opts, headers, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  const text = await r.text();
  return { status: r.status, text: text.slice(0, 800), url: r.url };
}

(async () => {
  // 1. search API for real jids
  console.log('=== search API ===');
  const search = await tryFetch(
    `${BASE}/wapi/zpgeek/search/joblist.json?query=Java&city=101010100&page=1&pageSize=5`,
  );
  console.log(search.status, search.text.slice(0, 400));

  // 2. a plausible real jid from the earlier page cookie flow — try detail API
  console.log('\n=== detail API (no jid yet, expect shape error) ===');
  const detail = await tryFetch(`${BASE}/wapi/zpgeek/job/detail.json?jid=abc&lid=&securityId=`);
  console.log(detail.status, detail.text.slice(0, 300));
})();
