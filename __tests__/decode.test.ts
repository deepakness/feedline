import { decodeBody, looksLikeUtf8 } from '@/feeds/decode';
import { FetchError } from '@/feeds/errors';

const bytes = (s: string, encoding: string) => {
  // Encode with Node's own tables by searching each character's byte.
  const decoder = new TextDecoder(encoding);
  const map = new Map<string, number>();
  for (let b = 0; b < 256; b++) map.set(decoder.decode(new Uint8Array([b])), b);
  return Uint8Array.from([...s].map((c) => map.get(c)!));
};

describe('decodeBody', () => {
  it.each([
    ['windows-1251', 'Привет, мир'],
    ['koi8-r', 'Привет, мир'],
    ['iso-8859-2', 'Zażółć gęślą jaźń'],
    ['windows-1253', 'Καλημέρα'],
  ])('decodes %s from the HTTP charset', (encoding, text) => {
    expect(decodeBody(bytes(text, encoding), `text/xml; charset=${encoding}`)).toBe(text);
  });

  it('honours a charset declared in the XML prolog', () => {
    const head = new TextEncoder().encode('<?xml version="1.0" encoding="cp1251"?><t>');
    const body = bytes('Ёж', 'windows-1251');
    expect(decodeBody(new Uint8Array([...head, ...body]), 'text/xml')).toBe('<?xml version="1.0" encoding="cp1251"?><t>Ёж');
  });

  it('decodes UTF-16 big-endian with a BOM', () => {
    expect(decodeBody(new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0xe9]), null)).toBe('hé');
  });

  it('reads UTF-8 even when the server labels it with a legacy charset', () => {
    const utf8 = new TextEncoder().encode('Привет');
    expect(looksLikeUtf8(utf8)).toBe(true);
    expect(decodeBody(utf8, 'text/xml; charset=windows-1251')).toBe('Привет');
    // Real windows-1251 bytes are not valid UTF-8.
    expect(looksLikeUtf8(bytes('Привет', 'windows-1251'))).toBe(false);
  });

  it('fails clearly on a multibyte encoding the runtime cannot decode', () => {
    const real = globalThis.TextDecoder;
    // Hermes may lack Shift_JIS; Node has it, so pretend it doesn't.
    globalThis.TextDecoder = class extends real {
      constructor(label?: string, opts?: TextDecoderOptions) {
        if (label && label !== 'utf-8') throw new RangeError('unsupported');
        super(label, opts);
      }
    } as typeof TextDecoder;
    try {
      const sjis = new Uint8Array([0x82, 0xa0, 0x82, 0xa2]); // あい
      expect(() => decodeBody(sjis, 'text/html; charset=shift_jis')).toThrow(FetchError);
      expect(() => decodeBody(sjis, 'text/html; charset=shift_jis')).toThrow(/shift_jis/);
    } finally {
      globalThis.TextDecoder = real;
    }
  });
});
