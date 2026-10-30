import { create } from 'zustand';

/**
 * With "Hide read", the timeline keeps articles read since its last refresh, so
 * rows don't vanish while reading. Marking in bulk, or turning "Hide read" on,
 * moves this cutoff so those articles leave at once.
 */
export const useReadKeep = create<{ clearedAt: number }>(() => ({ clearedAt: 0 }));

export function clearKeptRead() {
  // read_at is written just before; +1 makes this strictly later.
  useReadKeep.setState({ clearedAt: Date.now() + 1 });
}
