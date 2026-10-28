import { readFileSync } from 'fs';
import { join } from 'path';

import { decodeBody } from '@/feeds/decode';
import { parseFeed, ParseError } from '@/feeds/parse';
import { parseFeedDate } from '@/lib/time';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseFeed', () => {
  it('parses RSS 2.0 with content:encoded, CDATA, escaped HTML and media thumbnails', () => {
    const feed = parseFeed(fixture('rss2.xml'), 'https://example.com/feed');
    expect(feed.format).toBe('rss');
    expect(feed.title).toBe('Example & Co');
    expect(feed.siteUrl).toBe('https://example.com/');
    expect(feed.iconUrl).toBe('https://example.com/logo.png');
    expect(feed.items).toHaveLength(3);

    const [first, second, third] = feed.items;
    expect(first!.title).toBe('First post');
    expect(first!.author).toBe('Ada Lovelace');
    expect(first!.html).toBe('<p>Hello <b>world</b></p><img src="/img/a.jpg" alt="A">');
    expect(first!.thumbUrl).toBe('https://example.com/img/a.jpg');
    expect(first!.publishedAt).toBe(Date.UTC(2026, 9, 27, 9, 30));

    expect(second!.title).toBe('Second – with entity');
    expect(second!.html).toBe('<p>Escaped &amp; html</p>');
    expect(second!.thumbUrl).toBe('https://cdn.example.com/thumb2.jpg');
    expect(second!.publishedAt).toBe(Date.UTC(2026, 9, 26, 13, 0));

    expect(third!.url).toBeNull();
    expect(third!.publishedAt).toBeNull();
    expect(new Set(feed.items.map((i) => i.keyHash)).size).toBe(3);
  });

  it('keys items by guid so link changes do not duplicate them', () => {
    const a = parseFeed(fixture('rss2.xml'), 'https://example.com/feed').items[0]!;
    const b = parseFeed(
      fixture('rss2.xml').replace('https://example.com/first?utm_source=rss', 'https://example.com/first-moved'),
      'https://example.com/feed',
    ).items[0]!;
    expect(a.keyHash).toBe(b.keyHash);
  });

  it('parses Atom with inline XHTML and html titles', () => {
    const feed = parseFeed(fixture('atom.xml'), 'https://atom.example.org/feed.atom');
    expect(feed.format).toBe('atom');
    expect(feed.title).toBe('Atom Blog');
    expect(feed.siteUrl).toBe('https://atom.example.org/');
    expect(feed.iconUrl).toBe('https://atom.example.org/favicon.png');
    const [one, two] = feed.items;
    expect(one!.title).toBe('Entry one');
    expect(one!.url).toBe('https://atom.example.org/posts/one');
    expect(one!.author).toBe('Grace Hopper');
    expect(one!.html).toContain('<a href="/x">xhtml</a>');
    expect(one!.publishedAt).toBe(Date.UTC(2026, 9, 25, 8, 0));
    expect(two!.html).toBe('<p>Summary <img src="pic.png"></p>');
    expect(two!.thumbUrl).toBe('https://atom.example.org/posts/pic.png');
  });

  it('parses RSS 1.0 / RDF', () => {
    const feed = parseFeed(fixture('rdf.xml'), 'https://rdf.example.net/rss');
    expect(feed.format).toBe('rdf');
    expect(feed.title).toBe('RDF Site');
    expect(feed.items[0]!.url).toBe('https://rdf.example.net/a');
    expect(feed.items[0]!.publishedAt).toBe(Date.UTC(2026, 9, 20, 12));
  });

  it('parses JSON Feed including content_text', () => {
    const feed = parseFeed(fixture('jsonfeed.json'), 'https://json.example.com/feed.json');
    expect(feed.format).toBe('json');
    expect(feed.items[0]!.author).toBe('Linus');
    expect(feed.items[0]!.thumbUrl).toBe('https://json.example.com/1.jpg');
    expect(feed.items[1]!.html).toBe('<p>Line one</p><p>Line two</p>');
  });

  it('rejects HTML pages and garbage', () => {
    expect(() => parseFeed('<!DOCTYPE html><html><head></head></html>', 'https://x.com')).toThrow(ParseError);
    expect(() => parseFeed('<root><a/></root>', 'https://x.com')).toThrow('Unrecognized');
  });
});

describe('decodeBody', () => {
  it('decodes ISO-8859-1 declared in the XML prolog as windows-1252', () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'latin1.xml')));
    const feed = parseFeed(decodeBody(bytes, 'application/rss+xml'), 'https://latin.example.com/rss');
    expect(feed.title).toBe('Café “news”');
    expect(feed.items[0]!.title).toBe('Résumé');
  });

  it('prefers the HTTP charset and strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0xc3, 0xa9]);
    expect(decodeBody(bytes, 'text/xml; charset=iso-8859-1')).toBe('hé');
    expect(decodeBody(new Uint8Array([0x68, 0xe9]), 'text/xml; charset=iso-8859-1')).toBe('hé');
  });
});

describe('parseFeedDate', () => {
  it('rejects far-future dates and clamps small offsets to now', () => {
    expect(parseFeedDate(new Date(Date.now() + 30 * 864e5).toUTCString())).toBeNull();
    const soon = parseFeedDate(new Date(Date.now() + 3 * 36e5).toISOString())!;
    expect(soon).toBeLessThanOrEqual(Date.now());
    expect(parseFeedDate('Tue, 20 Oct 2026 10:00:00 GMT')).toBe(Date.UTC(2026, 9, 20, 10));
  });
});
