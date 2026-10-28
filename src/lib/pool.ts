/** Runs `worker` over `items` with at most `limit` in flight. Never rejects. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        await worker(items[index]!, index);
      } catch {
        // Workers report their own failures; one bad item must not stop the pool.
      }
    }
  });
  await Promise.all(lanes);
}

/** Serializes async tasks: each call waits for the previous one to settle. */
export function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return function lock<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}
