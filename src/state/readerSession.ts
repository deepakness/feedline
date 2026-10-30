import { create } from 'zustand';

type ReaderSession = {
  /**
   * The ordered article ids of the list the reader was opened from, so the
   * reader's arrows follow the same filter and order the user was looking at.
   */
  ids: number[];
  /** Which screen opened the reader; only it acts on `lastId`. */
  origin: 'timeline' | 'search' | null;
  /** The article the reader showed last, so the list can return to it. */
  lastId: number | null;
};

export const useReaderSession = create<ReaderSession>(() => ({ ids: [], origin: null, lastId: null }));
