import * as WebBrowser from 'expo-web-browser';
import { Share } from 'react-native';

import { paper } from '@/theme/themes/paper';

export async function openInBrowser(url: string | null) {
  if (!url) return;
  await WebBrowser.openBrowserAsync(url, {
    toolbarColor: paper.colors.bg,
    controlsColor: paper.colors.accent,
    showTitle: true,
    enableBarCollapsing: true,
  }).catch(() => {});
}

export async function shareArticle(title: string, url: string | null) {
  if (!url) return;
  await Share.share({ message: `${title}\n${url}`, url, title }).catch(() => {});
}
