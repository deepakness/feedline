import { decodeBody } from './decode';

// An honest feed-reader UA. Pretending to be Chrome gets flagged by bot checks
// (e.g. Hacker News answers 419) because the rest of the request isn't Chrome's.
const USER_AGENT = 'Feedline/1.0 (Android; personal RSS reader)';

export const FEED_ACCEPT =
  'application/rss+xml, application/atom+xml, application/feed+json, application/json;q=0.9, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.7, */*;q=0.5';
export const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';

export type FetchResult =
  | { status: 'not-modified'; url: string }
  | {
      status: 'ok';
      /** Final URL after redirects. */
      url: string;
      body: string;
      contentType: string;
      etag: string | null;
      lastModified: string | null;
    };

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const MAX_BYTES = 8 * 1024 * 1024;

export async function fetchText(
  url: string,
  opts: {
    accept?: string;
    etag?: string | null;
    lastModified?: string | null;
    timeoutMs?: number;
  } = {},
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: opts.accept ?? FEED_ACCEPT,
  };
  if (opts.etag) headers['If-None-Match'] = opts.etag;
  if (opts.lastModified) headers['If-Modified-Since'] = opts.lastModified;

  try {
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (res.status === 304) return { status: 'not-modified', url: res.url || url };
    if (!res.ok) throw new FetchError(httpMessage(res.status), res.status);
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) throw new FetchError('Response is too large');
    const contentType = res.headers.get('content-type') ?? '';
    return {
      status: 'ok',
      url: res.url || url,
      body: decodeBody(new Uint8Array(buffer), contentType),
      contentType,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    };
  } catch (error) {
    if (error instanceof FetchError) throw error;
    if (controller.signal.aborted) throw new FetchError('Timed out');
    throw new FetchError(offlineHint(error));
  } finally {
    clearTimeout(timer);
  }
}

function httpMessage(status: number): string {
  if (status === 404 || status === 410) return 'Feed not found (HTTP ' + status + ')';
  if (status === 401 || status === 403) return 'Access denied (HTTP ' + status + ')';
  if (status === 429) return 'Rate limited by the server';
  if (status >= 500) return 'Server error (HTTP ' + status + ')';
  return 'HTTP ' + status;
}

function offlineHint(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/network request failed/i.test(msg)) return 'Network unavailable';
  return msg || 'Network error';
}
