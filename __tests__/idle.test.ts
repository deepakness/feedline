import { setOnScreen, setUserBusy, whenIdle } from '@/lib/idle';

jest.useFakeTimers();

beforeEach(() => setOnScreen(true));

it('holds work while the user scrolls and releases it shortly after', async () => {
  let ran = false;
  setUserBusy(true);
  whenIdle().then(() => (ran = true));
  jest.advanceTimersByTime(1000);
  await Promise.resolve();
  expect(ran).toBe(false);
  setUserBusy(false);
  jest.advanceTimersByTime(300);
  await Promise.resolve();
  expect(ran).toBe(true);
});

it('never stays paused if the end of a scroll is missed', async () => {
  let ran = false;
  setUserBusy(true);
  whenIdle().then(() => (ran = true));
  jest.advanceTimersByTime(5000);
  await Promise.resolve();
  expect(ran).toBe(true);
});

// React Native can hold timers while the app is in memory behind a background
// task, so off screen nothing may wait on one.
it('resolves without a timer off screen', async () => {
  setOnScreen(false);
  setUserBusy(true);
  let ran = false;
  whenIdle().then(() => (ran = true));
  await Promise.resolve();
  expect(ran).toBe(true);
});

it('releases work held by a scroll when the app leaves the screen', async () => {
  let ran = false;
  setUserBusy(true);
  whenIdle().then(() => (ran = true));
  await Promise.resolve();
  expect(ran).toBe(false);
  setOnScreen(false);
  await Promise.resolve();
  expect(ran).toBe(true);
});
