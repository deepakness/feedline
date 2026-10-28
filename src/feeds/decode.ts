import { textDecode } from '@borewit/text-codec';

type Encoding = 'utf-8' | 'windows-1252' | 'utf-16le';

function normalizeLabel(label: string | null | undefined): Encoding | null {
  if (!label) return null;
  const l = label.trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (l === 'utf-8' || l === 'utf8') return 'utf-8';
  // Browsers treat these labels as windows-1252, a superset that maps the C1 range to “smart” glyphs.
  if (['iso-8859-1', 'latin1', 'l1', 'iso8859-1', 'iso_8859-1', 'windows-1252', 'cp1252', 'us-ascii', 'ascii'].includes(l)) {
    return 'windows-1252';
  }
  if (l === 'utf-16le' || l === 'utf-16') return 'utf-16le';
  return null;
}

export function charsetFromContentType(contentType: string | null): string | null {
  const match = contentType?.match(/charset\s*=\s*([^;\s]+)/i);
  return match ? match[1]! : null;
}

/**
 * Decodes a response body. React Native's `Response.text()` always assumes
 * UTF-8, so feeds are read as bytes and decoded by BOM, then the HTTP charset,
 * then the XML prolog or HTML meta tag.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  let encoding: Encoding | null = null;
  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'utf-8';
    offset = 3;
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    offset = 2;
  }
  encoding ??= normalizeLabel(charsetFromContentType(contentType));
  if (!encoding) {
    // Sniff the first 1 KB as ASCII for <?xml encoding="…"?> or <meta charset>.
    let head = '';
    for (let i = 0; i < Math.min(bytes.length, 1024); i++) head += String.fromCharCode(bytes[i]!);
    const declared =
      head.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)?.[1] ??
      head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1];
    encoding = normalizeLabel(declared) ?? 'utf-8';
  }
  const body = offset ? bytes.subarray(offset) : bytes;
  if (encoding === 'utf-8' && typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(body);
  }
  return textDecode(body, encoding);
}
