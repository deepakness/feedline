import { create } from 'zustand';

/**
 * The ordered article ids of the list the reader was opened from, so swiping
 * in the reader follows the same filter and order the user was looking at.
 */
export const useReaderSession = create<{ ids: number[] }>(() => ({ ids: [] }));
