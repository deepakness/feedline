/** Resolves `href` against `base`; returns null for unparseable or non-http(s) results. */
export function resolveUrl(href: string | null | undefined, base?: string | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('data:')) return null;
  try {
    const url = base ? new URL(trimmed, base) : new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Turns user input like "theverge.com" into a fetchable URL. */
export function normalizeInputUrl(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  if (value.startsWith('feed://')) value = 'https://' + value.slice('feed://'.length);
  if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
  return resolveUrl(value);
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Stable form of a link for dedupe: no fragment, no common tracking params. */
export function canonicalLink(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$)/.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** Pulls the first http(s) URL out of free text (share sheets often add a title). */
export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0] : null;
}
