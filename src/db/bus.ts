export type Table = 'feeds' | 'articles';

type Listener = (tables: Set<Table>) => void;

const listeners = new Set<Listener>();
let pending = new Set<Table>();
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Writers call this after committing. Notifications are coalesced so a refresh
 * inserting hundreds of rows re-queries the visible lists a few times a second,
 * not once per row.
 */
export function notifyChange(...tables: Table[]) {
  for (const t of tables) pending.add(t);
  if (timer) return;
  timer = setTimeout(flush, 250);
}

/** Immediate notification for user-initiated changes (tap to save, mark read). */
export function notifyChangeNow(...tables: Table[]) {
  for (const t of tables) pending.add(t);
  if (timer) clearTimeout(timer);
  flush();
}

function flush() {
  timer = null;
  const batch = pending;
  pending = new Set();
  for (const listener of listeners) listener(batch);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
