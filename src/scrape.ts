import type { ChromeMcp } from "./mcp.js";
import type { Config } from "./config.js";

export interface Candidate {
  handle: string;
  displayName: string;
  texts: string[];
  sourceUrl: string;
}

interface RawReply {
  handle: string;
  displayName: string;
  text: string;
}

/**
 * DOM extractor run inside the page. Pulls every visible tweet's author handle,
 * display name, and text using x.com's stable data-testid attributes.
 */
const EXTRACT_REPLIES_JS = `
  const AD_LABELS = new Set(['Ad', 'Promoted', '广告', '推广', 'プロモーション']);
  const isAd = (article) => {
    if (article.closest('[data-testid="placementTracking"]')) return true;
    for (const span of article.querySelectorAll('span')) {
      if (span.closest('[data-testid="tweetText"]')) continue;
      if (AD_LABELS.has(span.textContent.trim())) return true;
    }
    return false;
  };
  const out = [];
  for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
    if (isAd(article)) continue;
    const userName = article.querySelector('[data-testid="User-Name"]');
    if (!userName) continue;
    const handleLink = Array.from(userName.querySelectorAll('a[href^="/"]'))
      .map((a) => a.getAttribute('href'))
      .find((href) => href && /^\\/[A-Za-z0-9_]+$/.test(href));
    if (!handleLink) continue;
    const handle = handleLink.slice(1);
    const displayName = (userName.querySelector('span')?.textContent || '').trim();
    const text = (article.querySelector('[data-testid="tweetText"]')?.textContent || '').trim();
    out.push({ handle, displayName, text });
  }
  return out;
`;

async function extractVisibleReplies(mcp: ChromeMcp): Promise<RawReply[]> {
  return mcp.evaluate<RawReply[]>(EXTRACT_REPLIES_JS);
}

async function scrollPage(mcp: ChromeMcp): Promise<void> {
  await mcp.evaluate<null>("window.scrollBy(0, window.innerHeight * 2); return null;");
  await sleep(1500);
}

/** Scroll through the current page collecting replies until the cap or no new content. */
async function collectFromCurrentPage(
  mcp: ChromeMcp,
  sourceUrl: string,
  maxReplies: number,
): Promise<Map<string, Candidate>> {
  const found = new Map<string, Candidate>();
  await mcp.waitForSelector('article[data-testid="tweet"]');
  let staleRounds = 0;
  while (found.size < maxReplies && staleRounds < 2) {
    const before = totalTexts(found);
    for (const reply of await extractVisibleReplies(mcp)) {
      if (!reply.text) continue;
      const existing = found.get(reply.handle.toLowerCase());
      if (existing) {
        if (!existing.texts.includes(reply.text)) existing.texts.push(reply.text);
      } else {
        found.set(reply.handle.toLowerCase(), {
          handle: reply.handle,
          displayName: reply.displayName,
          texts: [reply.text],
          sourceUrl,
        });
      }
    }
    staleRounds = totalTexts(found) === before ? staleRounds + 1 : 0;
    if (found.size < maxReplies) await scrollPage(mcp);
  }
  return found;
}

/** Mode A: scan replies under the user's recent posts. */
export async function collectFromOwnPosts(
  mcp: ChromeMcp,
  config: Config,
  maxPosts: number,
): Promise<Candidate[]> {
  // Work in a fresh tab so we never navigate away from what the user is viewing.
  await mcp.newPage(`https://x.com/${config.X_USERNAME}`);
  await mcp.waitFor(`@${config.X_USERNAME}`);
  // The header renders before the timeline — wait for actual posts.
  if (!(await mcp.waitForSelector('article[data-testid="tweet"]'))) {
    console.warn("  no posts appeared on the profile page within 10s");
    return [];
  }

  const postLinks = await mcp.evaluate<string[]>(`
    const links = new Set();
    for (const a of document.querySelectorAll('article[data-testid="tweet"] a[href*="/status/"]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/^\\/([A-Za-z0-9_]+)\\/status\\/(\\d+)$/);
      if (m && m[1].toLowerCase() === ${JSON.stringify(config.X_USERNAME.toLowerCase())}) {
        links.add('https://x.com' + m[0]);
      }
    }
    return Array.from(links);
  `);

  const merged = new Map<string, Candidate>();
  for (const url of postLinks.slice(0, maxPosts)) {
    console.log(`  scanning replies of ${url}`);
    await mcp.navigate(url);
    await sleep(2000);
    const found = await collectFromCurrentPage(mcp, url, config.MAX_REPLIES_PER_POST);
    mergeInto(merged, found);
  }
  return finalize(merged, config.X_USERNAME);
}

/** Mode B: scan whatever x.com page is currently open in Chrome. */
export async function collectFromOpenPage(
  mcp: ChromeMcp,
  config: Config,
): Promise<Candidate[]> {
  const url = await mcp.selectCurrentXPage();
  if (!url) {
    console.log("  no open x.com tab found, skipping current-page scan");
    return [];
  }
  console.log(`  scanning open page ${url}`);
  const found = await collectFromCurrentPage(mcp, url, config.MAX_REPLIES_PER_POST);
  return finalize(found, config.X_USERNAME);
}

/** Scan replies of explicitly given post URLs. */
export async function collectFromUrls(
  mcp: ChromeMcp,
  config: Config,
  urls: string[],
): Promise<Candidate[]> {
  const merged = new Map<string, Candidate>();
  let first = true;
  for (const url of urls) {
    console.log(`  scanning replies of ${url}`);
    // First URL opens a fresh work tab; later ones reuse it.
    if (first) await mcp.newPage(url);
    else await mcp.navigate(url);
    first = false;
    await sleep(2000);
    const found = await collectFromCurrentPage(mcp, url, config.MAX_REPLIES_PER_POST);
    mergeInto(merged, found);
  }
  return finalize(merged, config.X_USERNAME);
}

export function mergeCandidates(lists: Candidate[][]): Candidate[] {
  const merged = new Map<string, Candidate>();
  for (const list of lists) {
    for (const c of list) {
      const existing = merged.get(c.handle.toLowerCase());
      if (existing) {
        for (const t of c.texts) if (!existing.texts.includes(t)) existing.texts.push(t);
      } else {
        merged.set(c.handle.toLowerCase(), { ...c, texts: [...c.texts] });
      }
    }
  }
  return Array.from(merged.values());
}

function mergeInto(target: Map<string, Candidate>, source: Map<string, Candidate>): void {
  for (const [key, c] of source) {
    const existing = target.get(key);
    if (existing) {
      for (const t of c.texts) if (!existing.texts.includes(t)) existing.texts.push(t);
    } else {
      target.set(key, c);
    }
  }
}

function finalize(found: Map<string, Candidate>, ownUsername: string): Candidate[] {
  found.delete(ownUsername.toLowerCase());
  return Array.from(found.values());
}

function totalTexts(found: Map<string, Candidate>): number {
  let n = 0;
  for (const c of found.values()) n += c.texts.length;
  return n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
