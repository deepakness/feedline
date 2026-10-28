import { setUserBusy, whenIdle } from '@/lib/idle';

jest.useFakeTimers();

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
