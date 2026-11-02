import { FetchError, fetchText, parseRetryAfter } from '@/feeds/fetch';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function respond(status: number, body = '', headers: Record<string, string> = {}) {
  global.fetch = jest.fn(async () => new Response(status === 304 ? null : body, { status, headers })) as typeof fetch;
}

it('reports "not modified" for a 304', async () => {
  respond(304);
  expect(await fetchText('https://f.test/feed', { etag: '"x"' })).toEqual(expect.objectContaining({ status: 'not-modified' }));
});

it('returns the decoded body and caching headers', async () => {
  respond(200, '<rss/>', { 'content-type': 'application/rss+xml', etag: '"v1"' });
  expect(await fetchText('https://f.test/feed')).toEqual(expect.objectContaining({ status: 'ok', body: '<rss/>', etag: '"v1"' }));
});

it('refuses a body declared larger than the limit before reading it', async () => {
  respond(200, 'small', { 'content-length': String(9 * 1024 * 1024) });
  await expect(fetchText('https://f.test/feed')).rejects.toMatchObject({ kind: 'content' });
});

it('turns HTTP errors into http errors with Retry-After', async () => {
  respond(429, '', { 'retry-after': '90' });
  await expect(fetchText('https://f.test/feed')).rejects.toMatchObject({ kind: 'http', status: 429, retryAfter: 90 });
});

it('tells timeouts from other connection failures', async () => {
  global.fetch = jest.fn(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        (init as RequestInit).signal!.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  ) as typeof fetch;
  await expect(fetchText('https://f.test/feed', { timeoutMs: 10 })).rejects.toMatchObject({ kind: 'timeout', message: 'Timed out' });

  global.fetch = jest.fn(async () => {
    throw new TypeError('Network request failed');
  }) as typeof fetch;
  const error = await fetchText('https://f.test/feed').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(FetchError);
  expect(error).toMatchObject({ kind: 'network', message: 'Network unavailable' });
});

it('parses Retry-After as seconds or an HTTP date', () => {
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  expect(parseRetryAfter('120', now)).toBe(120);
  expect(parseRetryAfter('Tue, 03 Nov 2026 12:05:00 GMT', now)).toBe(300);
  expect(parseRetryAfter('soon', now)).toBeUndefined();
  expect(parseRetryAfter(null, now)).toBeUndefined();
});
