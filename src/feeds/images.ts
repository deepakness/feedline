import { Directory, File, Paths } from 'expo-file-system';
import { getNetworkStateAsync, NetworkStateType } from 'expo-network';

import { hash } from '@/lib/hash';
import { runPool } from '@/lib/pool';
import { settings } from '@/state/settings';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg)$/i;

export function imagesRoot(): Directory {
  return new Directory(Paths.document, 'images');
}

function articleDir(articleId: number): Directory {
  return new Directory(imagesRoot(), String(articleId));
}

function fileNameFor(url: string): string {
  let ext = '.img';
  try {
    const m = new URL(url).pathname.match(IMAGE_EXT);
    if (m) ext = m[0].toLowerCase();
  } catch {
    // keep default
  }
  return hash(url) + ext;
}

/** False only when Android reports no connection; unknown counts as online. */
export async function isOnline(): Promise<boolean> {
  try {
    const state = await getNetworkStateAsync();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

/** Whether images should be downloaded right now, per the user's image setting. */
export async function imageDownloadsAllowed(): Promise<boolean> {
  const mode = settings.get().imageMode;
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  try {
    const state = await getNetworkStateAsync();
    return state.type === NetworkStateType.WIFI || state.type === NetworkStateType.ETHERNET;
  } catch {
    return false;
  }
}

const MIN_BYTES = 64;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30000;

function remove(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // Already gone or locked; not worth failing a download for.
  }
}

/**
 * Downloads to a temporary `.part` file and renames it only when complete, so a
 * download cut short (app killed, connection lost) never leaves a broken file
 * that later runs would trust. Gives up on very large or stalled downloads.
 */
async function download(url: string, target: File): Promise<boolean> {
  if (target.exists && (target.size ?? 0) >= MIN_BYTES) return true;
  // Unique per call: the reader and the background pass can fetch the same image at once.
  const part = new File(target.parentDirectory, `${target.name}.${Math.random().toString(36).slice(2, 10)}.part`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const file = await File.downloadFileAsync(url, part, {
      idempotent: true,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (bytesWritten > MAX_IMAGE_BYTES || totalBytes > MAX_IMAGE_BYTES) controller.abort();
      },
    });
    if ((file.size ?? 0) < MIN_BYTES) {
      remove(file);
      return false;
    }
    if (target.exists && (target.size ?? 0) >= MIN_BYTES) {
      // Another call finished first.
      remove(file);
      return true;
    }
    remove(target);
    file.rename(target.name);
    return true;
  } catch {
    remove(part);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads an article's images. Returns, per input URL, a path relative to the
 * documents directory (the reader WebView's base URL) or null on failure.
 */
export async function localizeImages(articleId: number, urls: string[]): Promise<(string | null)[]> {
  if (!urls.length) return [];
  const dir = articleDir(articleId);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const results: (string | null)[] = urls.map(() => null);
  await runPool(urls, 4, async (url, i) => {
    const name = fileNameFor(url);
    if (await download(url, new File(dir, name))) results[i] = `images/${articleId}/${name}`;
  });
  return results;
}

/** Downloads a list thumbnail; returns an absolute file URI for expo-image. */
export async function localizeThumb(articleId: number, url: string): Promise<string | null> {
  const dir = articleDir(articleId);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, 'thumb-' + fileNameFor(url));
  return (await download(url, file)) ? file.uri : null;
}

/** Absolute URI for a path stored relative to the documents directory. */
export function documentUri(relative: string): string {
  return new File(Paths.document, relative).uri;
}

export function deleteArticleImages(articleIds: number[]) {
  for (const id of articleIds) {
    try {
      const dir = articleDir(id);
      if (dir.exists) dir.delete();
    } catch {
      // A missing or locked directory is not worth failing a cleanup for.
    }
  }
}

export function iconsDir(): Directory {
  const dir = new Directory(Paths.document, 'icons');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Removes `.part` files left in the icon folder by downloads cut short (the app
 * was killed). Article folders go with their article, so only icons need this.
 */
export function sweepPartialDownloads() {
  try {
    for (const entry of iconsDir().list()) {
      if (entry instanceof File && entry.name.endsWith('.part')) remove(entry);
    }
  } catch {
    // Housekeeping only.
  }
}

export async function downloadIcon(feedId: number, url: string): Promise<string | null> {
  const file = new File(iconsDir(), `${feedId}-${fileNameFor(url)}`);
  return (await download(url, file)) ? file.uri : null;
}

export function storageUsage(): { images: number; database: number } {
  let images = 0;
  try {
    images = imagesRoot().exists ? (imagesRoot().size ?? 0) : 0;
  } catch {
    images = 0;
  }
  let database = 0;
  try {
    const dbDir = new Directory(Paths.document, 'SQLite');
    database = dbDir.exists ? (dbDir.size ?? 0) : 0;
  } catch {
    database = 0;
  }
  return { images, database };
}
