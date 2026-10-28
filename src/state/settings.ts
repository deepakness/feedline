import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

export type ListStyle = 'standard' | 'compact' | 'cards';
export type ReaderFamily = 'serif' | 'sans';
export type ImageMode = 'always' | 'wifi' | 'off';
export type FullTextDefault = 'auto' | 'never';
/** 0 means keep forever. */
export type RetentionDays = 7 | 30 | 90 | 0;

export type Settings = {
  themeId: string;
  listStyle: ListStyle;
  hideRead: boolean;
  readerSize: number;
  readerLineHeight: number;
  readerFamily: ReaderFamily;
  refreshOnOpen: boolean;
  retentionDays: RetentionDays;
  imageMode: ImageMode;
  fullTextDefault: FullTextDefault;
  lastRefreshAt: number;
  opmlSaveDirUri: string | null;
  recentSearches: string[];
  /** The one-time tip about long-pressing an article has been shown. */
  longPressTipShown: boolean;
};

export const READER_SIZES = [16, 17, 18, 19, 20, 22, 24] as const;
export const READER_LINE_HEIGHTS = [1.45, 1.6, 1.75] as const;
export const REFRESH_ON_OPEN_AFTER_MS = 60 * 60 * 1000;

const DEFAULTS: Settings = {
  themeId: 'paper',
  listStyle: 'standard',
  hideRead: false,
  readerSize: 19,
  readerLineHeight: 1.6,
  readerFamily: 'serif',
  refreshOnOpen: true,
  retentionDays: 30,
  imageMode: 'always',
  fullTextDefault: 'auto',
  lastRefreshAt: 0,
  opmlSaveDirUri: null,
  recentSearches: [],
  longPressTipShown: false,
};

const KEY = 'settings.v1';

function load(): Settings {
  try {
    const raw = Storage.getItemSync(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

type SettingsStore = Settings & {
  set: (patch: Partial<Settings>) => void;
};

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { set: _omit, ...values } = { ...get() };
    Storage.setItem(KEY, JSON.stringify(values)).catch(() => {});
  },
}));

/** Non-React access for pipelines. */
export const settings = {
  get: (): Settings => useSettings.getState(),
  set: (patch: Partial<Settings>) => useSettings.getState().set(patch),
};
