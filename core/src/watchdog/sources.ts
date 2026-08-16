/**
 * Hidden job-pool sources (维度三 / roadmap 4.1):
 *   - Hacker News "Who is hiring?" monthly thread (official Algolia API)
 *   - V2EX 酷工作 node (public API)
 *   - GitHub hiring repositories (Search API, unauthenticated)
 *
 * Each source returns raw text items; extraction into structured JDs is the
 * LLM's job (extract.ts). All fetches are single lightweight GETs — this is
 * a daily digest radar, not a crawler.
 */

export interface RawItem {
  /** Stable dedupe key across runs. */
  id: string;
  source: 'hn' | 'v2ex' | 'github';
  title: string;
  text: string;
  url: string;
}

const HN_ITEM_LIMIT = 30;
const V2EX_LIMIT = 20;
const GITHUB_LIMIT = 10;

/** Latest "Who is hiring?" stories + their top-level comment bodies. */
export async function fetchHnHiring(): Promise<RawItem[]> {
  const searchResp = await fetch(
    'https://hn.algolia.com/api/v1/search_by_date?query=%22Who%20is%20hiring%22&tags=story&hitsPerPage=3',
  );
  if (!searchResp.ok) throw new Error(`HN search failed: ${searchResp.status}`);
  const search = (await searchResp.json()) as { hits: Array<{ objectID: string; title: string }> };
  const items: RawItem[] = [];
  for (const hit of search.hits) {
    if (!/who is hiring/i.test(hit.title)) continue;
    const itemResp = await fetch(`https://hn.algolia.com/api/v1/items/${hit.objectID}`);
    if (!itemResp.ok) continue;
    const item = (await itemResp.json()) as { children?: Array<{ id: number; text: string | null }> };
    for (const child of item.children ?? []) {
      const text = (child.text ?? '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
      if (text.trim().length < 40) continue;
      items.push({
        id: `hn-${child.id}`,
        source: 'hn',
        title: 'HN Who is hiring',
        text: text.slice(0, 2000),
        url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      });
      if (items.length >= HN_ITEM_LIMIT) return items;
    }
  }
  return items;
}

/** V2EX 酷工作 node topics (title + content). */
export async function fetchV2exJobs(): Promise<RawItem[]> {
  const resp = await fetch('https://www.v2ex.com/api/topics/show.json?node_name=jobs');
  if (!resp.ok) throw new Error(`V2EX API failed: ${resp.status}`);
  const topics = (await resp.json()) as Array<{
    id: number;
    title: string;
    content: string;
    url: string;
  }>;
  return topics.slice(0, V2EX_LIMIT).map((t) => ({
    id: `v2ex-${t.id}`,
    source: 'v2ex',
    title: t.title,
    text: t.content?.slice(0, 2000) ?? '',
    url: t.url,
  }));
}

/** GitHub repos that look like hiring posts (description/keywords). */
export async function fetchGithubHiring(): Promise<RawItem[]> {
  const query = encodeURIComponent('hiring OR 招聘 OR "remote jobs" in:name,description');
  const resp = await fetch(
    `https://api.github.com/search/repositories?q=${query}&sort=updated&order=desc&per_page=${GITHUB_LIMIT}`,
    { headers: { Accept: 'application/vnd.github+json' } },
  );
  if (!resp.ok) throw new Error(`GitHub search failed: ${resp.status} (rate limit is 10 req/min unauthenticated)`);
  const search = (await resp.json()) as {
    items: Array<{ id: number; full_name: string; description: string | null; html_url: string }>;
  };
  return search.items.map((r) => ({
    id: `gh-${r.id}`,
    source: 'github',
    title: r.full_name,
    text: (r.description ?? '').slice(0, 500),
    url: r.html_url,
  }));
}

export async function fetchAllSources(): Promise<RawItem[]> {
  const results = await Promise.allSettled([fetchHnHiring(), fetchV2exJobs(), fetchGithubHiring()]);
  const items: RawItem[] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      const source = ['hn', 'v2ex', 'github'][i];
      console.error(`[watchdog] source ${source} failed: ${(result.reason as Error).message}`);
    }
  }
  return items;
}
