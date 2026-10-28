const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday", "Mon 24 Oct", or "Mon 24 Oct 2025" for other years. */
export function dayLabel(dayStart: number, now = Date.now()): string {
  const today = startOfDay(now);
  if (dayStart === today) return 'Today';
  if (dayStart === today - DAY) return 'Yesterday';
  const d = new Date(dayStart);
  const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Compact relative time: "now", "5m", "3h", "2d", then a date. */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "12 min ago", "3 h ago", "just now". Used in subtitles. */
export function agoLabel(ts: number, now = Date.now()): string {
  if (!ts) return 'never';
  const min = Math.floor((now - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function clockTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/** Full date for the reader header: "Mon 24 Oct 2026 · 14:05". */
export function longDate(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${clockTime(ts)}`;
}

const TZ: Record<string, number> = {
  UT: 0, UTC: 0, GMT: 0, Z: 0,
  EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7,
  CET: 1, CEST: 2, BST: 1, IST: 5.5, JST: 9, AEST: 10, AEDT: 11,
};

/**
 * Tolerant date parser for feed dates: ISO 8601, RFC 822/1123 (with named zones
 * Hermes may not know), and a few malformed variants seen in the wild.
 */
export function parseFeedDate(input: unknown): number | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    return raw.length === 10 ? n * 1000 : n;
  }
  let value = raw.replace(/\s+/g, ' ');
  // Replace a trailing named zone with a numeric offset.
  const zone = value.match(/\s([A-Z]{1,4})$/);
  if (zone && zone[1]! in TZ) {
    const offset = TZ[zone[1]!]!;
    const sign = offset < 0 ? '-' : '+';
    const abs = Math.abs(offset);
    const hh = Math.floor(abs).toString().padStart(2, '0');
    const mm = Math.round((abs % 1) * 60).toString().padStart(2, '0');
    value = value.slice(0, zone.index) + ` ${sign}${hh}${mm}`;
  }
  let ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    // RFC 822 without the weekday, or with a weekday Hermes rejects ("Tues,").
    ts = Date.parse(value.replace(/^[A-Za-z]+,?\s*/, ''));
  }
  if (Number.isNaN(ts)) {
    // "2026-10-24 14:05:00" (space instead of T, no zone) → treat as UTC.
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) ts = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  }
  if (Number.isNaN(ts)) return null;
  // Reject absurd dates: before 1995, or more than a day ahead (scheduled posts, wrong
  // years) would otherwise sit at the top of the list; callers fall back to now. Small
  // offsets (a wrong time zone) are clamped to now.
  if (ts < 788918400000 || ts > Date.now() + DAY) return null;
  return Math.min(ts, Date.now());
}
