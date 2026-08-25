// Find real job detail URLs via Bing search (Node fetch works in this sandbox).
const targets = [
  'https://www.bing.com/search?q=site%3Azhipin.com%2Fjob_detail+%E5%90%8E%E7%AB%AF%E5%B7%A5%E7%A8%8B%E5%B8%88',
  'https://www.bing.com/search?q=site%3Aliepin.com%2Fjob+%E5%90%8E%E7%AB%AF%E5%B7%A5%E7%A8%8B%E5%B8%88',
  'https://www.bing.com/search?q=%22zhipin.com%2Fjob_detail%2F%22+%E5%BE%85%E9%81%87',
];

const LINK_RE = /https?:\/\/[^"'\s<>]*(?:zhipin\.com\/job_detail\/[A-Za-z0-9_]+|liepin\.com\/job\/[A-Za-z0-9_]+)/g;

(async () => {
  for (const url of targets) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal: AbortSignal.timeout(20000),
      });
      const html = await r.text();
      const links = [...new Set([...html.matchAll(LINK_RE)].map((m) => m[0]))].slice(0, 8);
      console.log(`=== ${url} → HTTP ${r.status}, ${html.length} bytes, ${links.length} links`);
      links.forEach((l) => console.log('  ' + l));
    } catch (e) {
      console.log(`=== ${url} → ERR ${e.message.slice(0, 150)}`);
    }
  }
})();
