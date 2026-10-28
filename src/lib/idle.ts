/**
 * A gate for background work. Screens mark the user as busy (scrolling a list),
 * and long-running jobs wait at `whenIdle()` between steps so the JS thread is
 * free to render while the finger is moving.
 */
let busy = 0;
let waiters: (() => void)[] = [];
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

export function setUserBusy(isBusy: boolean) {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  // Released shortly after scrolling ends (the grace period covers the gap between
  // a drag and its fling), and at most a few seconds later if an end event is missed.
  if (isBusy) busy = 1;
  releaseTimer = setTimeout(() => {
    busy = 0;
    const ready = waiters;
    waiters = [];
    ready.forEach((resolve) => resolve());
  }, isBusy ? 5000 : 300);
}

/** Resolves on the next tick, or once the user stops interacting. */
export function whenIdle(): Promise<void> {
  if (!busy) return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => waiters.push(resolve));
}
