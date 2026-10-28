import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import { WebView as RNWebView, type WebViewProps } from 'react-native-webview';

export type { WebViewMessageEvent, WebViewProps } from 'react-native-webview';

/** Imperative handle (injectJavaScript, reload, …). */
export type WebViewHandle = InstanceType<typeof RNWebView>;

/**
 * react-native-webview 14 declares `WebView<P = undefined>` with props
 * `WebViewProps & P`, which TypeScript 6 collapses to `never`. Re-export it
 * with concrete props.
 */
export const WebView = RNWebView as unknown as ForwardRefExoticComponent<WebViewProps & RefAttributes<WebViewHandle>>;
