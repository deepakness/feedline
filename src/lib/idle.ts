/**
 * A gate for background work. Screens mark the user as busy (scrolling a list),
 * and long-running jobs wait at `whenIdle()` between steps so the JS thread is
 * free to render while the finger is moving.
 */
let busy = 0;
let waiters: (() => void)[] = [];
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Set by the root layout from AppState. Nothing sets it in a headless start
 * (a background refresh with the app closed), so it starts off screen.
 */
let onScreen = false;

function release() {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  busy = 0;
  const ready = waiters;
  waiters = [];
  ready.forEach((resolve) => resolve());
}

export function setUserBusy(isBusy: boolean) {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  // Released shortly after scrolling ends (the grace period covers the gap between
  // a drag and its fling), and at most a few seconds later if an end event is missed.
  if (isBusy) busy = 1;
  releaseTimer = setTimeout(release, isBusy ? 5000 : 300);
}

/**
 * Off screen there is nothing to render, and React Native can hold every JS
 * timer while the app sits in memory behind a background task (Expo's
 * keep-alive doesn't always prevent it). A wait on a timer would then stall
 * the background refresh until the app is opened, so off screen `whenIdle()`
 * doesn't use one, and leaving the screen releases anything still waiting.
 */
export function setOnScreen(value: boolean) {
  onScreen = value;
  if (!value) release();
}

/** Resolves on the next tick, or once the user stops interacting; at once when off screen. */
export function whenIdle(): Promise<void> {
  if (!onScreen) return Promise.resolve();
  if (!busy) return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => waiters.push(resolve));
}
