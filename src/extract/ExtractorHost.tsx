import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewHandle, type WebViewMessageEvent } from '@/lib/webview';

import { attachRunner, completeJob, failActiveJob, type Extracted } from './extractor';
import { READABILITY_SOURCE } from './readability.generated';

const BOOTSTRAP = `
${READABILITY_SOURCE}
window.__extract = function (id, html, url) {
  var post = function (payload) { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); };
  try {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var base = doc.createElement('base');
    base.setAttribute('href', url);
    (doc.head || doc.documentElement).prepend(base);
    // Absolutize links and images before Readability clones nodes out of context.
    doc.querySelectorAll('a[href]').forEach(function (a) { a.setAttribute('href', a.href); });
    doc.querySelectorAll('img').forEach(function (img) {
      var lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
      if (lazy) img.setAttribute('src', lazy);
      if (img.getAttribute('src')) img.setAttribute('src', img.src);
    });
    var readerable = isProbablyReaderable(doc, { minContentLength: 120, minScore: 18 });
    var article = new Readability(doc, { charThreshold: 400, keepClasses: false }).parse();
    if (!article || (!readerable && article.length < 800)) return post({ id: id, result: null });
    post({ id: id, result: { title: article.title || null, byline: article.byline || null, content: article.content, length: article.length } });
  } catch (e) {
    post({ id: id, result: null, error: String(e) });
  }
};
true;
`;

/**
 * Invisible WebView that runs Readability. Mounted once in the root layout;
 * jobs arrive through the queue in `extractor.ts`.
 */
export function ExtractorHost() {
  const ref = useRef<WebViewHandle>(null);
  const ready = useRef(false);

  useEffect(() => () => attachRunner(null), []);

  const onLoadEnd = () => {
    if (ready.current) return;
    ready.current = true;
    attachRunner((job) => {
      ref.current?.injectJavaScript(
        `window.__extract(${JSON.stringify(job.id)}, ${JSON.stringify(job.html)}, ${JSON.stringify(job.url)}); true;`,
      );
    });
  };

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as { id: string; result: Extracted | null };
      completeJob(msg.id, msg.result);
    } catch {
      // ignore malformed messages
    }
  };

  const onCrash = () => {
    ready.current = false;
    attachRunner(null);
    failActiveJob();
    ref.current?.reload();
  };

  return (
    <View style={styles.host} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <WebView
        ref={ref}
        source={{ html: '<!doctype html><html><head></head><body></body></html>' }}
        injectedJavaScriptBeforeContentLoaded={BOOTSTRAP}
        onLoadEnd={onLoadEnd}
        onMessage={onMessage}
        onRenderProcessGone={onCrash}
        onContentProcessDidTerminate={onCrash}
        javaScriptEnabled
        cacheEnabled={false}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
  webview: { width: 1, height: 1 },
});
