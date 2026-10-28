import { XMLParser } from 'fast-xml-parser';

import { normalizeInputUrl } from '@/lib/url';

export type OpmlFeed = { url: string; title: string; siteUrl: string | null };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: true,
  htmlEntities: true,
  parseAttributeValue: false,
  isArray: (name) => name === 'outline',
});

type Outline = Record<string, unknown> & { outline?: Outline[] };

function attr(o: Outline, name: string): string {
  // Attribute names vary in case across exporters (xmlUrl, xmlurl, XMLURL).
  for (const key of Object.keys(o)) {
    if (key.toLowerCase() === name.toLowerCase() && typeof o[key] === 'string') return (o[key] as string).trim();
  }
  return '';
}

/** Flattens every feed outline (folders are ignored) and dedupes by URL. */
export function parseOpml(xml: string): OpmlFeed[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new Error('This file is not valid OPML');
  }
  const body = (doc.opml as Record<string, unknown> | undefined)?.body as Outline | undefined;
  if (!body) throw new Error('This file is not valid OPML');

  const out: OpmlFeed[] = [];
  const seen = new Set<string>();
  const walk = (outlines: Outline[] | undefined) => {
    for (const o of outlines ?? []) {
      const raw = attr(o, 'xmlUrl');
      const url = raw ? normalizeInputUrl(raw) : null;
      if (url && !seen.has(url)) {
        seen.add(url);
        out.push({
          url,
          title: attr(o, 'title') || attr(o, 'text') || url,
          siteUrl: normalizeInputUrl(attr(o, 'htmlUrl')) || null,
        });
      }
      walk(o.outline);
    }
  };
  walk(body.outline);
  return out;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

export function buildOpml(feeds: OpmlFeed[], now = new Date()): string {
  const lines = feeds.map((f) => {
    const html = f.siteUrl ? ` htmlUrl="${esc(f.siteUrl)}"` : '';
    return `    <outline type="rss" text="${esc(f.title)}" title="${esc(f.title)}" xmlUrl="${esc(f.url)}"${html}/>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>Feedline subscriptions</title>',
    `    <dateCreated>${now.toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
    ...lines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}
