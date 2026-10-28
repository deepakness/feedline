import { getShareExtensionKey } from 'expo-share-intent';

/**
 * Android share intents arrive as deep links expo-router doesn't know about.
 * Route them to Add Feed, which reads the shared URL from the share-intent context.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/feeds/add?shared=1';
    return path;
  } catch {
    return '/';
  }
}
