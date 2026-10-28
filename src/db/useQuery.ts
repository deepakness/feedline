import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { subscribe, type Table } from './bus';

/**
 * Runs an async query and re-runs it whenever one of `tables` changes. `deps`
 * work like a hook dependency list. Stale results from superseded runs are
 * dropped so a slow query never overwrites a newer one.
 */
export function useQuery<T>(
  run: () => Promise<T>,
  deps: unknown[],
  tables: Table[],
): { data: T | undefined; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });
  // Deps are plain values (ids, filter objects), so a JSON key detects changes.
  const depsKey = JSON.stringify(deps);

  const reload = useCallback(() => {
    const id = ++seq.current;
    runRef.current().then(
      (result) => {
        if (id !== seq.current) return;
        // Unchanged rows keep their identity so memoized rows skip re-rendering,
        // and an identical result causes no render at all.
        setData((prev) => share(prev, result));
        setLoading(false);
      },
      (error) => {
        if (id !== seq.current) return;
        console.warn('[useQuery]', error);
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload, depsKey]);

  const tableKey = tables.join(',');
  useEffect(() => {
    const watched = new Set(tableKey.split(','));
    return subscribe((changed) => {
      for (const t of changed) {
        if (watched.has(t)) {
          reload();
          return;
        }
      }
    });
  }, [reload, tableKey]);

  return { data, loading, reload };
}

function shallowEqual(a: object, b: object): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}

/** Returns `prev` (or parts of it) wherever `next` holds the same values. */
export function share<T>(prev: T | undefined, next: T): T {
  if (prev === undefined || prev === null || next === null || typeof next !== 'object') return next;
  if (Array.isArray(next) && Array.isArray(prev)) {
    const byId = new Map<unknown, object>();
    for (const row of prev) {
      if (row && typeof row === 'object' && 'id' in row) byId.set((row as { id: unknown }).id, row);
    }
    let same = prev.length === next.length;
    const out = next.map((row, i) => {
      if (row && typeof row === 'object' && 'id' in row) {
        const old = byId.get((row as { id: unknown }).id);
        if (old && shallowEqual(old, row)) {
          if (old !== prev[i]) same = false;
          return old;
        }
      } else if (row === prev[i]) {
        return row;
      }
      same = false;
      return row;
    });
    return (same ? prev : out) as T;
  }
  if (!Array.isArray(next) && !Array.isArray(prev) && typeof prev === 'object' && shallowEqual(prev, next)) return prev;
  return next;
}
