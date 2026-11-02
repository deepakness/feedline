import { textDecode } from '@borewit/text-codec';

import { ENCODING_LABELS, SINGLE_BYTE_TABLES } from './charsets.generated';
import { FetchError } from './errors';

/** Canonical WHATWG encoding name for a charset label, or null if unknown. */
export function normalizeLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const l = label.trim().toLowerCase().replace(/^["']|["']$/g, '');
  return ENCODING_LABELS[l] ?? null;
}

export function charsetFromContentType(contentType: string | null): string | null {
  const match = contentType?.match(/charset\s*=\s*([^;\s]+)/i);
  return match ? match[1]! : null;
}

/** Code points for all 256 byte values, built once per single-byte encoding. */
const codeTables = new Map<string, Uint16Array>();

function codeTable(encoding: string): Uint16Array | null {
  const high = SINGLE_BYTE_TABLES[encoding];
  if (!high) return null;
  let table = codeTables.get(encoding);
  if (!table) {
    table = new Uint16Array(256);
    for (let i = 0; i < 128; i++) table[i] = i;
    for (let i = 0; i < 128; i++) table[128 + i] = high.charCodeAt(i);
    codeTables.set(encoding, table);
  }
  return table;
}

function decodeSingleByte(bytes: Uint8Array, table: Uint16Array): string {
  const CHUNK = 8192;
  const units = new Uint16Array(Math.min(bytes.length, CHUNK));
  let out = '';
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(bytes.length, start + CHUNK);
    for (let i = start; i < end; i++) units[i - start] = table[bytes[i]!]!;
    out += String.fromCharCode.apply(null, Array.from(units.subarray(0, end - start)));
  }
  return out;
}

/**
 * True when the bytes contain multibyte UTF-8 and nothing invalid. Legacy
 * encodings almost never produce valid UTF-8 by accident, so a server that
 * labels UTF-8 as windows-1251 or GBK (it happens) is caught here.
 */
export function looksLikeUtf8(bytes: Uint8Array): boolean {
  let multibyte = false;
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    if (b < 0x80) {
      i++;
      continue;
    }
    const n = b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : -1;
    if (n < 0) return false;
    for (let k = 1; k <= n; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return false;
    }
    multibyte = true;
    i += n + 1;
  }
  return multibyte;
}

function decodeUtf8(bytes: Uint8Array): string {
  return typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(bytes) : textDecode(bytes, 'utf-8');
}

function swapBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length - (bytes.length % 2));
  for (let i = 0; i < out.length; i += 2) {
    out[i] = bytes[i + 1]!;
    out[i + 1] = bytes[i]!;
  }
  return out;
}

/**
 * Decodes a response body. React Native's `Response.text()` always assumes
 * UTF-8, so feeds are read as bytes and decoded by BOM, then the HTTP charset,
 * then the XML prolog or HTML meta tag. Throws a `content` FetchError for an
 * encoding this runtime can't decode, rather than returning garbled text.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  let encoding: string | null = null;
  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'utf-8';
    offset = 3;
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    offset = 2;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
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

  if (encoding === 'utf-8') return decodeUtf8(body);
  if (encoding === 'utf-16le') return textDecode(body, 'utf-16le');
  if (encoding === 'utf-16be') return textDecode(swapBytes(body), 'utf-16le');
  if (looksLikeUtf8(body)) return decodeUtf8(body);
  const table = codeTable(encoding);
  if (table) return decodeSingleByte(body, table);

  // Multibyte legacy encodings (Shift_JIS, GBK, Big5, EUC-KR…): only if the
  // runtime's TextDecoder knows them.
  try {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder(encoding).decode(body);
  } catch {
    // Unsupported label: fall through to the clear error below.
  }
  throw new FetchError(`This uses the ${encoding} text encoding, which Feedline can’t read`, { kind: 'content' });
}
