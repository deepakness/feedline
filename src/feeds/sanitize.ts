import { render } from 'dom-serializer';
import { parseDocument } from 'htmlparser2';

import { resolveUrl } from '@/lib/url';

/** Structural view of htmlparser2 nodes (avoids depending on a specific domhandler copy). */
type DomNode = {
  type: string;
  parent: DomNode | null;
  prev: DomNode | null;
  next: DomNode | null;
  children?: DomNode[];
  data?: string;
  name?: string;
  attribs?: Record<string, string>;
};

export type SanitizedContent = {
  /** HTML whose <img> tags use `src="feedline-img:N"` placeholders. */
  html: string;
  /** Remote URL for each placeholder index. */
  images: string[];
  text: string;
  excerpt: string;
  readingMinutes: number;
};

export const IMG_PLACEHOLDER = 'feedline-img:';
const MAX_IMAGES = 30;

const DROP = new Set([
  'script', 'style', 'noscript', 'link', 'meta', 'base', 'template', 'form', 'input', 'button',
  'select', 'textarea', 'object', 'embed', 'canvas', 'svg', 'math', 'dialog', 'head', 'title',
  'audio', 'video', 'source', 'track', 'nav', 'aside',
]);

// Elements we keep, with the attributes each may carry. Everything else is unwrapped.
const ALLOWED: Record<string, string[]> = {
  a: ['href', 'title'], abbr: ['title'], b: [], blockquote: ['cite'], br: [], caption: [],
  cite: [], code: [], dd: [], del: [], details: [], dfn: [], div: [], dl: [], dt: [], em: [],
  figcaption: [], figure: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], hr: [], i: [],
  img: ['src', 'alt', 'title', 'width', 'height'], ins: [], kbd: [], li: [], mark: [],
  ol: ['start', 'reversed'], p: [], pre: [], q: [], s: [], samp: [], small: [], span: [],
  strong: [], sub: [], summary: [], sup: [], table: [], tbody: [], td: ['colspan', 'rowspan'],
  tfoot: [], th: ['colspan', 'rowspan', 'scope'], thead: [], time: ['datetime'], tr: [], u: [],
  ul: [], var: [], section: [], article: [], header: [], footer: [], main: [],
};
const KEEP_ID = true;

const TRACKER_HOSTS =
  /(^|\.)(feedburner\.com|doubleclick\.net|google-analytics\.com|pixel\.wp\.com|stats\.wp\.com|feeds\.feedblitz\.com|ad\.doubleclick\.net|pixel\.quantserve\.com|sb\.scorecardresearch\.com|ws\.amazon\.|mediaplex\.com|pi\.feedsportal\.com|beacon\.krxd\.net|tracking\.|counter\.|analytics\.)/i;
const JUNK_CLASS = /\b(feedflare|share|sharing|social|related-posts|newsletter-signup|wp-block-buttons|jp-relatedposts|sd-sharing)\b/i;

const BLOCK = new Set([
  'p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'figure',
  'figcaption', 'section', 'article', 'header', 'footer', 'br', 'hr', 'dd', 'dt', 'table',
]);

function isElement(node: DomNode): boolean {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

function removeNode(node: DomNode) {
  const siblings = node.parent?.children;
  if (!siblings) return;
  const i = siblings.indexOf(node);
  if (i >= 0) siblings.splice(i, 1);
  if (node.prev) node.prev.next = node.next;
  if (node.next) node.next.prev = node.prev;
  node.parent = node.prev = node.next = null;
}

function replaceWithChildren(node: DomNode) {
  const parent = node.parent;
  const siblings = parent?.children;
  if (!parent || !siblings) return;
  const i = siblings.indexOf(node);
  const kids = node.children ?? [];
  for (const k of kids) k.parent = parent;
  siblings.splice(i, 1, ...kids);
  relink(siblings);
}

function replaceNode(node: DomNode, replacement: DomNode) {
  const parent = node.parent;
  const siblings = parent?.children;
  if (!parent || !siblings) return;
  siblings[siblings.indexOf(node)] = replacement;
  replacement.parent = parent;
  relink(siblings);
}

function relink(list: DomNode[]) {
  for (let j = 0; j < list.length; j++) {
    list[j]!.prev = list[j - 1] ?? null;
    list[j]!.next = list[j + 1] ?? null;
  }
}

/** Builds a detached element from an HTML snippet. */
function fragment(html: string): DomNode {
  const doc = parseDocument(html) as unknown as DomNode;
  const el = doc.children![0]!;
  el.parent = null;
  return el;
}

function bestFromSrcset(srcset: string, maxWidth = 1200): string | null {
  let best: { url: string; w: number } | null = null;
  let fallback: string | null = null;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;
    fallback ??= url;
    const w = descriptor?.endsWith('w') ? parseInt(descriptor, 10) : descriptor?.endsWith('x') ? parseFloat(descriptor) * 600 : 0;
    if (w <= maxWidth && (!best || w > best.w)) best = { url, w };
  }
  return best?.url ?? fallback;
}

function youtubeId(src: string): string | null {
  const m = src.match(/(?:youtube(?:-nocookie)?\.com\/(?:embed|v|shorts)\/|youtu\.be\/|youtube\.com\/watch\?(?:.*&)?v=)([\w-]{6,})/i);
  return m ? m[1]! : null;
}

/**
 * Video feeds (YouTube channels) only carry a description. Prefix such items
 * with an embed so the reader shows a tappable video card above the text.
 */
export function withVideoLead(html: string, url: string | null): string {
  const id = url ? youtubeId(url) : null;
  if (!id || html.includes(id)) return html;
  return `<iframe src="https://www.youtube.com/embed/${id}"></iframe>${html.replace(/\n/g, '<br>')}`;
}

function embedCard(src: string): DomNode | null {
  const yt = youtubeId(src);
  if (yt) {
    return fragment(
      `<a class="embed" href="https://www.youtube.com/watch?v=${yt}"><img src="https://i.ytimg.com/vi/${yt}/hqdefault.jpg" alt=""><span class="embed-label">Watch on YouTube</span></a>`,
    );
  }
  const vimeo = src.match(/player\.vimeo\.com\/video\/(\d+)/i);
  if (vimeo) {
    return fragment(`<a class="embed embed-noimg" href="https://vimeo.com/${vimeo[1]}"><span class="embed-label">Watch on Vimeo</span></a>`);
  }
  return null;
}

function isTrackingPixel(attribs: Record<string, string>, url: string): boolean {
  const w = parseInt(attribs.width ?? '', 10);
  const h = parseInt(attribs.height ?? '', 10);
  if ((w > 0 && w <= 2) || (h > 0 && h <= 2)) return true;
  try {
    const u = new URL(url);
    if (TRACKER_HOSTS.test(u.hostname)) return true;
    if (/\/(~r|~ff|pixel|beacon|track|open)\b/i.test(u.pathname) && !/\.(jpe?g|png|webp|avif)$/i.test(u.pathname)) return true;
  } catch {
    return true;
  }
  return false;
}

/**
 * Cleans feed or extracted article HTML for the reader: keeps semantic markup only,
 * resolves links and images against `baseUrl`, swaps video iframes for link cards,
 * strips trackers, and swaps image sources for placeholders the image stage fills.
 */
export function sanitizeHtml(input: string, baseUrl: string | null): SanitizedContent {
  const doc = parseDocument(input, { decodeEntities: true }) as unknown as DomNode;
  const images: string[] = [];
  const seenImages = new Map<string, number>();

  const visit = (node: DomNode) => {
    // Copy: children mutate while we walk.
    for (const child of [...(node.children ?? [])]) {
      if (child.type === 'comment' || child.type === 'directive' || child.type === 'cdata') {
        if (child.type === 'cdata') replaceWithChildren(child);
        else removeNode(child);
        continue;
      }
      if (!isElement(child)) continue;
      const name = child.name!.toLowerCase();
      const attribs = child.attribs ?? {};

      if (DROP.has(name) || JUNK_CLASS.test(attribs.class ?? '') || attribs.hidden != null || /display\s*:\s*none/i.test(attribs.style ?? '')) {
        removeNode(child);
        continue;
      }
      if (name === 'iframe') {
        const card = embedCard(resolveUrl(attribs.src ?? attribs['data-src'], baseUrl) ?? '');
        if (card) {
          replaceNode(child, card);
          // The loop iterates a snapshot, so visit the new card explicitly.
          visit({ type: 'root', children: [card] } as DomNode);
        } else removeNode(child);
        continue;
      }
      if (name === 'picture') {
        const img = (child.children ?? []).find((c) => c.name === 'img');
        if (img) {
          const source = (child.children ?? []).find((c) => c.name === 'source' && c.attribs?.srcset);
          if (source && !img.attribs?.srcset && !img.attribs?.src) img.attribs!.srcset = source.attribs!.srcset!;
          replaceNode(child, img);
          processImg(img);
        } else removeNode(child);
        continue;
      }

      visit(child);

      if (name === 'img') {
        processImg(child);
        continue;
      }
      if (!(name in ALLOWED)) {
        replaceWithChildren(child);
        continue;
      }
      const allowed = ALLOWED[name]!;
      const embedClass = name === 'a' && /\bembed\b/.test(attribs.class ?? '') ? attribs.class : null;
      const next: Record<string, string> = {};
      for (const key of allowed) if (attribs[key] != null) next[key] = attribs[key]!;
      if (KEEP_ID && attribs.id) next.id = attribs.id;
      if (embedClass) next.class = embedClass;
      if (name === 'span' && /embed-label/.test(attribs.class ?? '')) next.class = 'embed-label';
      if (name === 'a') {
        const href = attribs.href?.trim();
        if (href?.startsWith('#')) next.href = href;
        else {
          const resolved = resolveUrl(href, baseUrl);
          if (resolved) next.href = resolved;
          else delete next.href;
        }
      }
      if (name === 'pre' || name === 'code') {
        const lang = (attribs.class ?? '').match(/\blang(?:uage)?-([\w+-]+)/)?.[1];
        if (lang) next.class = `language-${lang}`;
      }
      child.attribs = next;

      if (name === 'table' && child.parent?.attribs?.class !== 'table-wrap') {
        const wrap = fragment('<div class="table-wrap"></div>');
        replaceNode(child, wrap);
        wrap.children = [child];
        child.parent = wrap;
        child.prev = child.next = null;
      }
    }
  };

  function processImg(img: DomNode | undefined) {
    if (!img?.attribs) return;
    const a = img.attribs;
    const candidate =
      a['data-src'] ?? a['data-lazy-src'] ?? a['data-original'] ?? a['data-orig-file'] ??
      (a.srcset || a['data-srcset'] ? bestFromSrcset(a.srcset ?? a['data-srcset']!) : null) ??
      a.src;
    const url = resolveUrl(candidate, baseUrl);
    if (!url || isTrackingPixel(a, url) || (images.length >= MAX_IMAGES && !seenImages.has(url))) {
      removeNode(img);
      return;
    }
    let index = seenImages.get(url);
    if (index === undefined) {
      index = images.length;
      images.push(url);
      seenImages.set(url, index);
    }
    const next: Record<string, string> = { src: `${IMG_PLACEHOLDER}${index}` };
    if (a.alt) next.alt = a.alt;
    const w = parseInt(a.width ?? '', 10);
    const h = parseInt(a.height ?? '', 10);
    if (w > 0 && h > 0) {
      next.width = String(w);
      next.height = String(h);
    }
    next.loading = 'lazy';
    img.attribs = next;
  }

  visit(doc);
  pruneEmpty(doc);

  const html = render(doc as never, { encodeEntities: 'utf8', selfClosingTags: false }).trim();
  const text = textOf(doc).replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const words = text ? text.split(/\s+/).length : 0;
  return {
    html,
    images,
    text,
    excerpt: makeExcerpt(text),
    readingMinutes: Math.max(1, Math.round(words / 230)),
  };
}

/** Removes paragraphs and wrappers that ended up empty (common after junk removal). */
function pruneEmpty(node: DomNode) {
  for (const child of [...(node.children ?? [])]) {
    if (!isElement(child)) continue;
    pruneEmpty(child);
    const name = child.name!;
    if (['p', 'div', 'span', 'section', 'figure', 'li', 'strong', 'em', 'b', 'i'].includes(name)) {
      const hasContent = (child.children ?? []).some(
        (c) => (c.type === 'text' && c.data!.trim() !== '' && c.data!.trim() !== ' ') || isElement(c),
      );
      if (!hasContent) removeNode(child);
    }
  }
}

function textOf(node: DomNode): string {
  let out = '';
  for (const child of node.children ?? []) {
    if (child.type === 'text') out += child.data;
    else if (isElement(child)) {
      if (child.name === 'img' || child.attribs?.class?.includes('embed')) continue;
      const inner = textOf(child);
      out += BLOCK.has(child.name!) ? `\n${inner}\n` : inner;
    }
  }
  return out;
}

export function makeExcerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[,;:.\s]+$/, '') + '…';
}

/** Heuristic: does this feed content look like a teaser rather than the full article? */
export function looksTruncated(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 600) return true;
  return /(\[?…\]?|\[\.\.\.\]|\.\.\.|read more|continue reading|weiterlesen|lire la suite)\s*$/i.test(trimmed.slice(-60));
}

/** Replaces image placeholders with final sources: a local file path or the remote URL. */
export function fillImagePlaceholders(html: string, images: string[], local: (string | null)[]): string {
  return html.replace(/src="feedline-img:(\d+)"/g, (_m, idx: string) => {
    const i = Number(idx);
    const remote = images[i] ?? '';
    const src = local[i] ?? remote;
    return `src="${escapeAttr(src)}" data-remote="${escapeAttr(remote)}"`;
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
