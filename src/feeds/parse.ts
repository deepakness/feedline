import { XMLParser } from 'fast-xml-parser';

import { hash } from '@/lib/hash';
import { parseFeedDate } from '@/lib/time';
import { canonicalLink, resolveUrl } from '@/lib/url';

export type NormalizedItem = {
  /** Stable dedupe key hash: guid, else canonical link, else title+date. */
  keyHash: string;
  url: string | null;
  title: string;
  author: string | null;
  html: string;
  publishedAt: number | null;
  thumbUrl: string | null;
};

export type NormalizedFeed = {
  format: 'rss' | 'atom' | 'rdf' | 'json';
  title: string;
  siteUrl: string | null;
  description: string | null;
  iconUrl: string | null;
  items: NormalizedItem[];
};

export class ParseError extends Error {}

// Content-bearing elements are kept raw so inline XHTML and CDATA survive intact.
const RAW_NODES = ['description', 'content:encoded', 'content', 'summary', 'subtitle'];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  stopNodes: RAW_NODES.map((n) => `*.${n}`),
  isArray: (name) => ['item', 'entry', 'link', 'category', 'media:content', 'media:thumbnail', 'enclosure'].includes(name),
});

type Node = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object') return text((node as Node)['#text']);
  return '';
}

function attr(node: unknown, name: string): string | null {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const value = (node as Node)[`@_${name}`];
    return value == null ? null : String(value);
  }
  return null;
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Turns a raw stop-node body into HTML: unwraps CDATA, unescapes entity-encoded markup. */
function rawHtml(node: unknown): string {
  const raw = text(node);
  if (!raw) return '';
  if (raw.includes('<![CDATA[')) {
    return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  }
  // Inline XHTML (Atom type="xhtml") arrives as literal tags.
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw;
  return decodeXmlEntities(raw).trim();
}

/** Plain-text title: strips stray tags and collapses whitespace. */
function cleanTitle(raw: string): string {
  return decodeXmlEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function firstImageInHtml(html: string, base: string | null): string | null {
  const match = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  return match ? resolveUrl(decodeXmlEntities(match[1]!), base) : null;
}

function makeKey(guid: string | null, url: string | null, title: string, date: string): string {
  if (guid) return hash('g:' + guid);
  if (url) return hash('u:' + canonicalLink(url));
  return hash('t:' + title + '|' + date);
}

function mediaThumb(item: Node, base: string | null): string | null {
  const group = item['media:group'] as Node | undefined;
  const thumbs = [...asArray(item['media:thumbnail']), ...asArray(group?.['media:thumbnail'])];
  for (const t of thumbs) {
    const u = resolveUrl(attr(t, 'url'), base);
    if (u) return u;
  }
  const contents = [...asArray(item['media:content']), ...asArray(group?.['media:content'])];
  for (const c of contents) {
    const medium = attr(c, 'medium');
    const type = attr(c, 'type');
    if (medium === 'image' || type?.startsWith('image/') || (!medium && !type)) {
      const u = resolveUrl(attr(c, 'url'), base);
      if (u && (medium === 'image' || type || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u))) return u;
    }
  }
  for (const e of asArray(item.enclosure)) {
    if (attr(e, 'type')?.startsWith('image/')) {
      const u = resolveUrl(attr(e, 'url'), base);
      if (u) return u;
    }
  }
  const itunes = attr(item['itunes:image'], 'href');
  return resolveUrl(itunes, base);
}

function parseRssItems(items: Node[], base: string | null): NormalizedItem[] {
  return items.map((item) => {
    const linkNode = asArray(item.link)[0];
    const guidNode = item.guid;
    const guid = text(guidNode) || null;
    const permalink = attr(guidNode, 'isPermaLink') !== 'false' && guid && /^https?:\/\//.test(guid) ? guid : null;
    const url = resolveUrl(text(linkNode) || attr(linkNode, 'href'), base) ?? permalink;
    const title = cleanTitle(text(item.title));
    const dateRaw = text(item.pubDate) || text(item['dc:date']) || text(item['atom:updated']) || text(item.published);
    const html = rawHtml(item['content:encoded']) || rawHtml(item.description);
    return {
      keyHash: makeKey(guid, url, title, dateRaw),
      url,
      title,
      author: text(item['dc:creator']) || text(item.author) || null,
      html,
      publishedAt: parseFeedDate(dateRaw),
      thumbUrl: mediaThumb(item, base) ?? firstImageInHtml(html, url ?? base),
    };
  });
}

function atomLink(links: unknown[], rel: string): string | null {
  for (const l of links) {
    const r = attr(l, 'rel') ?? 'alternate';
    if (r === rel) {
      const type = attr(l, 'type');
      if (rel !== 'alternate' || !type || type.includes('html')) return attr(l, 'href') ?? text(l);
    }
  }
  return null;
}

function parseAtom(feed: Node, fallbackBase: string): NormalizedFeed {
  const links = asArray(feed.link);
  const siteUrl = resolveUrl(atomLink(links, 'alternate'), fallbackBase);
  const base = siteUrl ?? fallbackBase;
  const items = asArray(feed.entry as Node[]).map((entry): NormalizedItem => {
    const entryLinks = asArray(entry.link);
    const url = resolveUrl(atomLink(entryLinks, 'alternate') ?? attr(entryLinks[0], 'href'), base);
    const title = cleanTitle(rawHtml(entry.title) || text(entry.title));
    const dateRaw = text(entry.published) || text(entry.updated) || text(entry.issued);
    const html = rawHtml(entry.content) || rawHtml(entry.summary) || rawHtml(entry['media:group'] && (entry['media:group'] as Node)['media:description']);
    let thumb = mediaThumb(entry, base);
    for (const l of entryLinks) {
      if (!thumb && attr(l, 'rel') === 'enclosure' && attr(l, 'type')?.startsWith('image/')) {
        thumb = resolveUrl(attr(l, 'href'), base);
      }
    }
    return {
      keyHash: makeKey(text(entry.id) || null, url, title, dateRaw),
      url,
      title,
      author: text((asArray(entry.author)[0] as Node | undefined)?.name) || null,
      html,
      publishedAt: parseFeedDate(dateRaw),
      thumbUrl: thumb ?? firstImageInHtml(html, url ?? base),
    };
  });
  return {
    format: 'atom',
    title: cleanTitle(rawHtml(feed.title) || text(feed.title)),
    siteUrl,
    description: cleanTitle(rawHtml(feed.subtitle)) || null,
    iconUrl: resolveUrl(text(feed.icon) || text(feed.logo), base),
    items,
  };
}

function parseRss(channel: Node, items: Node[], format: 'rss' | 'rdf', fallbackBase: string): NormalizedFeed {
  const links = asArray(channel.link);
  let siteUrl: string | null = null;
  for (const l of links) {
    // RSS channels often carry both <link> and <atom:link rel="self">; skip the latter.
    const value = text(l);
    if (value) {
      siteUrl = resolveUrl(value, fallbackBase);
      break;
    }
  }
  const base = siteUrl ?? fallbackBase;
  const image = channel.image as Node | undefined;
  return {
    format,
    title: cleanTitle(text(channel.title)),
    siteUrl,
    description: cleanTitle(rawHtml(channel.description)) || null,
    iconUrl: resolveUrl(text(image?.url) || attr(channel['itunes:image'], 'href'), base),
    items: parseRssItems(items, base),
  };
}

type JsonFeed = {
  version?: string;
  title?: string;
  home_page_url?: string;
  description?: string;
  icon?: string;
  favicon?: string;
  items?: {
    id?: string | number;
    url?: string;
    title?: string;
    content_html?: string;
    content_text?: string;
    summary?: string;
    image?: string;
    banner_image?: string;
    date_published?: string;
    date_modified?: string;
    author?: { name?: string };
    authors?: { name?: string }[];
  }[];
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseJsonFeed(json: JsonFeed, fallbackBase: string): NormalizedFeed {
  const siteUrl = resolveUrl(json.home_page_url, fallbackBase);
  const base = siteUrl ?? fallbackBase;
  return {
    format: 'json',
    title: (json.title ?? '').trim(),
    siteUrl,
    description: json.description ?? null,
    iconUrl: resolveUrl(json.icon ?? json.favicon, base),
    items: (json.items ?? []).map((it) => {
      const url = resolveUrl(it.url, base);
      const title = cleanTitle(it.title ?? '');
      const dateRaw = it.date_published ?? it.date_modified ?? '';
      const html =
        it.content_html ??
        (it.content_text ? `<p>${escapeHtml(it.content_text).replace(/\n{2,}/g, '</p><p>')}</p>` : (it.summary ?? ''));
      return {
        keyHash: makeKey(it.id != null ? String(it.id) : null, url, title, dateRaw),
        url,
        title,
        author: it.authors?.[0]?.name ?? it.author?.name ?? null,
        html,
        publishedAt: parseFeedDate(dateRaw),
        thumbUrl: resolveUrl(it.image ?? it.banner_image, base) ?? firstImageInHtml(html, url ?? base),
      };
    }),
  };
}

export function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 2048).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || /<head[\s>]/.test(head.slice(0, 1024));
}

/** Parses RSS 2.0, RSS 1.0 (RDF), Atom, or JSON Feed. Throws ParseError otherwise. */
export function parseFeed(body: string, sourceUrl: string): NormalizedFeed {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as JsonFeed;
      if (json.version?.includes('jsonfeed.org') || Array.isArray(json.items)) {
        return parseJsonFeed(json, sourceUrl);
      }
    } catch {
      // fall through
    }
    throw new ParseError('Not a valid JSON Feed');
  }
  if (looksLikeHtml(trimmed)) throw new ParseError('This is a web page, not a feed');

  let doc: Node;
  try {
    doc = parser.parse(trimmed) as Node;
  } catch (error) {
    throw new ParseError('Malformed XML: ' + (error instanceof Error ? error.message : String(error)));
  }
  const rss = doc.rss as Node | undefined;
  if (rss?.channel) {
    const channel = asArray<Node>(rss.channel as Node)[0]!;
    return parseRss(channel, asArray<Node>(channel.item as Node[]), 'rss', sourceUrl);
  }
  const atom = doc.feed as Node | undefined;
  if (atom) return parseAtom(atom, sourceUrl);
  const rdf = doc['rdf:RDF'] as Node | undefined;
  if (rdf) {
    const channel: Node = asArray<Node>(rdf.channel as Node)[0] ?? {};
    // RSS 1.0 items are siblings of <channel>; some feeds nest them anyway.
    const items = asArray<Node>((rdf.item ?? channel.item) as Node[]);
    return parseRss(channel, items, 'rdf', sourceUrl);
  }
  throw new ParseError('Unrecognized feed format');
}
