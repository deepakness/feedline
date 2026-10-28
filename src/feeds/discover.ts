import { DomUtils, parseDocument } from 'htmlparser2';

import { normalizeInputUrl, originOf, resolveUrl } from '@/lib/url';

import { fetchText, HTML_ACCEPT } from './fetch';
import { looksLikeHtml, parseFeed, type NormalizedFeed } from './parse';

export type FeedCandidate = {
  url: string;
  title: string;
  siteUrl: string | null;
  itemCount: number;
  latestTitles: string[];
  iconUrl: string | null;
};

const PROBE_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml', '/feed.json', '/feeds/posts/default'];
const FEED_TYPES = /(rss|atom|feed)\+(xml|json)|application\/(rss|atom|xml)|text\/xml/i;

function toCandidate(url: string, feed: NormalizedFeed): FeedCandidate {
  return {
    url,
    title: feed.title || feed.siteUrl || url,
    siteUrl: feed.siteUrl,
    itemCount: feed.items.length,
    latestTitles: feed.items
      .slice()
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
      .slice(0, 3)
      .map((i) => i.title)
      .filter(Boolean),
    iconUrl: feed.iconUrl,
  };
}

async function tryFeed(url: string): Promise<FeedCandidate | null> {
  try {
    const res = await fetchText(url, { timeoutMs: 12000 });
    if (res.status !== 'ok') return null;
    return toCandidate(res.url, parseFeed(res.body, res.url));
  } catch {
    return null;
  }
}

/** Reads `<link rel="alternate">` feed declarations from a web page. */
export function feedLinksInHtml(html: string, pageUrl: string): string[] {
  const doc = parseDocument(html);
  const links = DomUtils.getElementsByTagName('link', doc as never, true);
  const found: string[] = [];
  for (const link of links) {
    const rel = (link.attribs.rel ?? '').toLowerCase();
    const type = link.attribs.type ?? '';
    if (rel.split(/\s+/).includes('alternate') && FEED_TYPES.test(type)) {
      const url = resolveUrl(link.attribs.href, pageUrl);
      // Skip per-post comment feeds when the page also offers a site feed.
      if (url && !found.includes(url)) found.push(url);
    }
  }
  return found.sort((a, b) => Number(/comment/i.test(a)) - Number(/comment/i.test(b)));
}

/** Best icon declared by a page: apple-touch-icon, then any rel=icon, then /favicon.ico. */
export function iconFromHtml(html: string, pageUrl: string): string | null {
  const doc = parseDocument(html);
  const links = DomUtils.getElementsByTagName('link', doc as never, true);
  let best: { url: string; score: number } | null = null;
  for (const link of links) {
    const rel = (link.attribs.rel ?? '').toLowerCase();
    if (!/\bicon\b|apple-touch-icon/.test(rel)) continue;
    const url = resolveUrl(link.attribs.href, pageUrl);
    if (!url) continue;
    const size = parseInt((link.attribs.sizes ?? '').split('x')[0] ?? '', 10) || (rel.includes('apple') ? 180 : 32);
    const score = (url.endsWith('.svg') ? 0 : size) + (rel.includes('apple') ? 50 : 0);
    if (!best || score > best.score) best = { url, score };
  }
  return best?.url ?? null;
}

export async function findSiteIcon(siteUrl: string): Promise<string | null> {
  try {
    const res = await fetchText(siteUrl, { accept: HTML_ACCEPT, timeoutMs: 8000 });
    if (res.status === 'ok') {
      const icon = iconFromHtml(res.body, res.url);
      if (icon) return icon;
    }
  } catch {
    // fall back below
  }
  const origin = originOf(siteUrl);
  return origin ? `${origin}/favicon.ico` : null;
}

export class DiscoveryError extends Error {}

/**
 * Finds feeds for whatever the user typed: a feed URL, a site URL, or a bare
 * domain. Returns candidates in preference order.
 */
export async function discoverFeeds(input: string): Promise<FeedCandidate[]> {
  const url = normalizeInputUrl(input);
  if (!url) throw new DiscoveryError('That doesn’t look like a web address');

  let res: Awaited<ReturnType<typeof fetchText>> | null = null;
  let pageError: string | null = null;
  try {
    res = await fetchText(url, { timeoutMs: 12000 });
  } catch (error) {
    // Some homepages block non-browsers while their feeds are open; keep probing.
    pageError = error instanceof Error ? error.message : 'Could not reach that site';
  }
  if (!res || res.status !== 'ok') return probeOrigin(url, pageError ?? 'Could not read that address');

  if (!looksLikeHtml(res.body)) {
    try {
      return [toCandidate(res.url, parseFeed(res.body, res.url))];
    } catch {
      // Not a feed; fall through to probing.
    }
  }

  const declared = looksLikeHtml(res.body) ? feedLinksInHtml(res.body, res.url) : [];
  const candidates: FeedCandidate[] = [];
  for (const feedUrl of declared.slice(0, 6)) {
    const c = await tryFeed(feedUrl);
    if (c && !candidates.some((x) => x.url === c.url)) candidates.push(c);
  }
  if (candidates.length) return candidates;
  return probeOrigin(res.url, 'No feed found on this site');
}

/** Tries the usual feed paths on the site's origin. */
async function probeOrigin(url: string, failure: string): Promise<FeedCandidate[]> {
  const origin = originOf(url);
  const candidates: FeedCandidate[] = [];
  if (origin) {
    const probes = await Promise.all(PROBE_PATHS.map((p) => tryFeed(origin + p)));
    // Different paths often redirect to the same feed.
    for (const c of probes) if (c && !candidates.some((x) => x.url === c.url)) candidates.push(c);
  }
  if (!candidates.length) throw new DiscoveryError(failure);
  return candidates.slice(0, 1).concat(candidates.slice(1).filter((c) => c.itemCount > 0));
}
