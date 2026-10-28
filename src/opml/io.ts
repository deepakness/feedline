import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { listFeeds } from '@/db/feeds';
import { settings } from '@/state/settings';

import { buildOpml, parseOpml, type OpmlFeed } from './opml';

/** Lets the user pick an OPML file. Returns null if they cancelled. */
export async function pickOpml(): Promise<OpmlFeed[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // Many file managers label .opml as octet-stream or text/plain; accept anything.
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const text = await new File(result.assets[0].uri).text();
  return parseOpml(text);
}

function exportFileName(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `feedline-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.opml`;
}

async function buildExport(): Promise<{ name: string; xml: string; count: number }> {
  const feeds = await listFeeds();
  const xml = buildOpml(
    feeds.map((f) => ({ url: f.url, title: f.custom_title || f.title || f.url, siteUrl: f.site_url })),
  );
  return { name: exportFileName(), xml, count: feeds.length };
}

/** Writes the export to the cache and opens the Android share sheet. */
export async function shareOpml(): Promise<void> {
  const { name, xml } = await buildExport();
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(xml);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/x-opml', dialogTitle: 'Export subscriptions' });
}

/**
 * Saves the export into a folder the user picks (Storage Access Framework).
 * The folder is remembered; if access was revoked we ask again.
 */
export async function saveOpmlToDevice(): Promise<{ name: string; count: number } | null> {
  const { name, xml, count } = await buildExport();
  const remembered = settings.get().opmlSaveDirUri;
  const tryWrite = (dir: Directory) => {
    const file = dir.createFile(name, 'text/x-opml');
    file.write(xml);
  };
  if (remembered) {
    try {
      tryWrite(new Directory(remembered));
      return { name, count };
    } catch {
      settings.set({ opmlSaveDirUri: null });
    }
  }
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return null; // cancelled
  }
  tryWrite(dir);
  settings.set({ opmlSaveDirUri: dir.uri });
  return { name, count };
}
