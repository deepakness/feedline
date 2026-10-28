import { readFileSync } from 'fs';
import { join } from 'path';

import { buildOpml, parseOpml } from '@/opml/opml';

describe('OPML', () => {
  const xml = readFileSync(join(__dirname, 'fixtures', 'nested.opml'), 'utf8');

  it('flattens nested outlines, dedupes and handles attribute case', () => {
    const feeds = parseOpml(xml);
    expect(feeds.map((f) => f.url)).toEqual([
      'https://www.theverge.com/rss/index.xml',
      'https://news.ycombinator.com/rss',
      'https://deep.example.com/feed?a=1&b=2',
      'https://lower.example.com/rss',
    ]);
    expect(feeds[0]!.siteUrl).toBe('https://www.theverge.com/');
    expect(feeds[2]!.title).toBe('Deep & Feed');
    expect(feeds[3]!.title).toBe('Title only');
  });

  it('round-trips through export', () => {
    const feeds = parseOpml(xml);
    expect(parseOpml(buildOpml(feeds))).toEqual(feeds);
  });

  it('rejects non-OPML', () => {
    expect(() => parseOpml('<html><body/></html>')).toThrow('not valid OPML');
  });
});
