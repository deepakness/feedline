import { create } from 'zustand';

export type RefreshSummary = {
  newArticles: number;
  /** Feeds this refresh checked. */
  feeds: number;
  failedFeeds: number;
  finishedAt: number;
};

type RefreshState = {
  running: boolean;
  /** Feeds fetched so far / total, for the progress bar. */
  done: number;
  total: number;
  /** Articles still downloading full text or images after the feed pass. */
  pendingOffline: number;
  lastSummary: RefreshSummary | null;
};

export const useRefreshStore = create<RefreshState>(() => ({
  running: false,
  done: 0,
  total: 0,
  pendingOffline: 0,
  lastSummary: null,
}));
