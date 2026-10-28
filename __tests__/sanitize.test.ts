import { fillImagePlaceholders, looksTruncated, makeExcerpt, sanitizeHtml, withVideoLead } from '@/feeds/sanitize';

const BASE = 'https://blog.example.com/posts/hello';

describe('sanitizeHtml', () => {
  it('removes scripts, styles, event handlers and inline styles', () => {
    const out = sanitizeHtml(
      '<p style="color:red" onclick="evil()">Hi <script>alert(1)</script><b class="x">there</b></p><style>p{}</style>',
      BASE,
    );
    expect(out.html).toBe('<p>Hi <b>there</b></p>');
    expect(out.text).toBe('Hi there');
  });

  it('resolves links, strips target, keeps anchors', () => {
    const out = sanitizeHtml('<a href="/about" target="_blank" rel="noopener">About</a> <a href="#fn1">1</a> <a href="javascript:x()">bad</a>', BASE);
    expect(out.html).toBe('<a href="https://blog.example.com/about">About</a> <a href="#fn1">1</a> <a>bad</a>');
  });

  it('turns images into placeholders, promoting lazy sources and srcset', () => {
    const out = sanitizeHtml(
      '<p><img src="data:image/gif;base64,R0" data-src="/lazy.jpg" alt="Lazy"></p>' +
        '<img srcset="/s.jpg 400w, /m.jpg 1000w, /l.jpg 2400w" width="1000" height="500">' +
        '<picture><source srcset="/p.webp"><img src="/p.jpg"></picture>' +
        '<img src="https://feeds.feedburner.com/~r/x/~4/abc">' +
        '<img src="/px.gif" width="1" height="1">',
      BASE,
    );
    expect(out.images).toEqual([
      'https://blog.example.com/lazy.jpg',
      'https://blog.example.com/m.jpg',
      'https://blog.example.com/p.jpg',
    ]);
    expect(out.html).toContain('<img src="feedline-img:0" alt="Lazy" loading="lazy">');
    expect(out.html).toContain('<img src="feedline-img:1" width="1000" height="500" loading="lazy">');
    expect(out.html).not.toContain('picture');
    expect(out.html).not.toContain('feedburner');
  });

  it('replaces YouTube iframes with a link card and drops other iframes', () => {
    const out = sanitizeHtml(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"></iframe><iframe src="https://ads.example.com/x"></iframe>',
      BASE,
    );
    expect(out.html).toBe(
      '<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" class="embed"><img src="feedline-img:0" loading="lazy"><span class="embed-label">Watch on YouTube</span></a>',
    );
    expect(out.images).toEqual(['https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg']);
  });

  it('wraps tables, unwraps unknown elements, prunes empties and junk', () => {
    const out = sanitizeHtml(
      '<custom-el><p>Kept</p></custom-el><p> </p><div class="sharedaddy sd-sharing">Share!</div><table><tr><td>1</td></tr></table>',
      BASE,
    );
    expect(out.html).toBe('<p>Kept</p><div class="table-wrap"><table><tr><td>1</td></tr></table></div>');
  });

  it('computes excerpt and reading time', () => {
    const words = Array.from({ length: 460 }, (_, i) => `word${i}`).join(' ');
    const out = sanitizeHtml(`<p>${words}</p>`, BASE);
    expect(out.readingMinutes).toBe(2);
    expect(out.excerpt.length).toBeLessThanOrEqual(241);
    expect(out.excerpt.endsWith('…')).toBe(true);
  });
});

describe('helpers', () => {
  it('fills placeholders with local paths or remote fallbacks', () => {
    const html = '<img src="feedline-img:0"><img src="feedline-img:1">';
    expect(fillImagePlaceholders(html, ['https://a.com/1.jpg?x=1&y=2', 'https://a.com/2.jpg'], ['images/9/a.jpg', null])).toBe(
      '<img src="images/9/a.jpg" data-remote="https://a.com/1.jpg?x=1&amp;y=2"><img src="https://a.com/2.jpg" data-remote="https://a.com/2.jpg">',
    );
  });

  it('detects teaser content', () => {
    expect(looksTruncated('Short teaser')).toBe(true);
    expect(looksTruncated('x '.repeat(400) + 'Continue reading')).toBe(true);
    expect(looksTruncated('word '.repeat(400) + 'The end.')).toBe(false);
    expect(makeExcerpt('short')).toBe('short');
  });
});

describe('withVideoLead', () => {
  it('adds a video card for YouTube items and leaves others alone', () => {
    const out = sanitizeHtml(withVideoLead('Line one\nLine two', 'https://www.youtube.com/watch?v=abcDEF12345'), null);
    expect(out.html.startsWith('<a href="https://www.youtube.com/watch?v=abcDEF12345" class="embed">')).toBe(true);
    expect(out.text).toContain('Line one');
    expect(withVideoLead('<p>x</p>', 'https://example.com/a')).toBe('<p>x</p>');
  });
});
