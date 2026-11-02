import { parseFeedDate } from '@/lib/time';

describe('parseFeedDate', () => {
  const at = (iso: string) => Date.parse(iso);

  it('parses RFC 822 dates with named zones', () => {
    expect(parseFeedDate('Mon, 02 Nov 2026 09:30:00 EST')).toBe(at('2026-11-02T14:30:00Z'));
    expect(parseFeedDate('Mon, 02 Nov 2026 09:30:00 IST')).toBe(at('2026-11-02T04:00:00Z'));
    expect(parseFeedDate('Tues, 27 Oct 2026 08:00:00 GMT')).toBe(at('2026-10-27T08:00:00Z'));
  });

  it('parses ISO dates, with and without a zone', () => {
    expect(parseFeedDate('2026-10-24T14:05:00+02:00')).toBe(at('2026-10-24T12:05:00Z'));
    expect(parseFeedDate('2026-10-24 14:05:00')).toBe(at('2026-10-24T14:05:00Z'));
  });

  it('accepts Unix timestamps in seconds or milliseconds', () => {
    const ms = at('2026-10-01T00:00:00Z');
    expect(parseFeedDate(String(ms / 1000))).toBe(ms);
    expect(parseFeedDate(String(ms))).toBe(ms);
  });

  it('rejects empty, malformed, ancient and far-future dates', () => {
    expect(parseFeedDate('')).toBeNull();
    expect(parseFeedDate(null)).toBeNull();
    expect(parseFeedDate('not a date')).toBeNull();
    expect(parseFeedDate('1990-01-01T00:00:00Z')).toBeNull();
    expect(parseFeedDate(new Date(Date.now() + 3 * 864e5).toISOString())).toBeNull();
  });
});
