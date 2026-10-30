import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { getDb } from '@/db/client';
import { listFeeds } from '@/db/feeds';
import { settings } from '@/state/settings';

import { refreshFeeds } from './refresh';

const TASK = 'feedline-background-refresh';
/** A floor, not a schedule: Android runs it later when battery or network are poor. */
const INTERVAL_MINUTES = 3 * 60;

// Defined at module load; index.js imports this first so a headless start finds it.
TaskManager.defineTask(TASK, async () => {
  try {
    await getDb();
    if (!settings.get().backgroundRefresh || !(await listFeeds()).length) return BackgroundTask.BackgroundTaskResult.Success;
    // Only the feed pass is awaited. Full text needs the extractor WebView, which
    // exists only with the UI up; queued articles finish on the next launch.
    await refreshFeeds();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Registers or cancels the periodic task to match the setting. Returns false if the system won't allow it. */
export async function syncBackgroundRefresh(enabled: boolean): Promise<boolean> {
  const registered = await TaskManager.isTaskRegisteredAsync(TASK);
  if (!enabled) {
    if (registered) await BackgroundTask.unregisterTaskAsync(TASK);
    return true;
  }
  if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  if (!registered) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: INTERVAL_MINUTES });
  return true;
}
