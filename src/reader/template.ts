import type { Theme } from '@/theme';
import type { ReaderFamily } from '@/state/settings';
import { longDate } from '@/lib/time';

import { READER_FONT_FACES } from './fonts.generated';

export type ReaderPrefs = { size: number; lineHeight: number; family: ReaderFamily };

export type ReaderDoc = {
  title: string;
  url: string | null;
  author: string | null;
  feedName: string;
  feedIcon: string | null;
  publishedAt: number;
  readingMinutes: number;
  contentHtml: string;
  /** Shown above the body while full text is fetched, or when only the teaser is available. */
  notice: { text: string; action: string | null; busy?: boolean } | null;
  /**
   * Where to scroll once loaded: `y` (pixels, a reload in the same session) wins
   * over `fraction` (of the page, saved from an earlier visit).
   */
  restore?: { y?: number; fraction?: number } | null;
};

/** Messages posted from the reader WebView to React Native. */
export type ReaderMessage =
  /** `restored`: caused by restoring the position, not by the reader's finger. */
  | { type: 'scroll'; y: number; max: number; restored?: boolean }
  | { type: 'meta'; titleBottom: number }
  | { type: 'notice' }
  | { type: 'lightbox'; open: boolean };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function css(theme: Theme, prefs: ReaderPrefs, topInset: number): string {
  const c = theme.colors;
  const r = theme.reader;
  return `
${READER_FONT_FACES}
:root{
  --bg:${c.bg};--ink:${c.ink};--ink2:${c.inkSecondary};--ink3:${c.inkTertiary};--rule:${c.hairline};
  --accent:${r.linkColor};--accent-soft:${c.accentSoft};--code:${r.codeBg};--quote:${r.quoteRule};--sunken:${c.surfaceSunken};
  --serif:${r.serifStack};--sans:${r.sansStack};
  --size:${prefs.size}px;--lh:${prefs.lineHeight};--body:${prefs.family === 'serif' ? 'var(--serif)' : 'var(--sans)'};
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;background:var(--bg)}
body{margin:0;padding:${topInset}px 22px calc(120px + env(safe-area-inset-bottom));background:var(--bg);color:var(--ink);
  font-family:var(--body);font-size:var(--size);line-height:var(--lh);font-kerning:normal;
  font-variant-numeric:oldstyle-nums proportional-nums;text-rendering:optimizeLegibility;
  -webkit-font-smoothing:antialiased;overflow-wrap:break-word;-webkit-tap-highlight-color:transparent}
::selection{background:${r.selection}}
main{max-width:38em;margin:0 auto}
header.meta{padding-top:12px;margin-bottom:28px}
.source{display:flex;align-items:center;gap:8px;min-width:0;font:600 12px/16px var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--ink2)}
.source span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
header.meta .source img{display:block;width:18px;height:18px;margin:0;flex:none;border-radius:4px;object-fit:cover;background:var(--sunken)}
h1.title{font:600 calc(var(--size) * 1.55)/1.18 var(--body);letter-spacing:-.015em;margin:14px 0 14px;color:var(--ink);font-variant-numeric:lining-nums;text-wrap:balance}
.byline{font:400 13px/18px var(--sans);color:var(--ink3)}
.byline b{font-weight:600;color:var(--ink2)}
.byline span{white-space:nowrap}
.notice{display:flex;align-items:center;gap:10px;margin:0 0 24px;padding:12px 14px;border-radius:12px;background:var(--sunken);font:400 13px/18px var(--sans);color:var(--ink2)}
.notice a{color:var(--accent);font-weight:600;text-decoration:none;padding:6px 0}
.notice.busy::before{content:'';flex:none;width:14px;height:14px;border-radius:50%;border:2px solid var(--rule);border-top-color:var(--accent);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
article>*:first-child{margin-top:0}
article>*:last-child{margin-bottom:0}
p{margin:0 0 1.05em;text-wrap:pretty}
h2,h3,h4,h5,h6{font-family:var(--body);font-weight:600;line-height:1.25;letter-spacing:-.01em;margin:1.7em 0 .55em;font-variant-numeric:lining-nums}
h1{font:600 1.45em/1.2 var(--body);margin:1.6em 0 .5em}
h2{font-size:1.3em}h3{font-size:1.14em}h4,h5,h6{font-size:1em}
a{color:var(--accent);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.18em;text-decoration-color:color-mix(in srgb,var(--accent) 45%,transparent)}
strong,b{font-weight:600}
img{display:block;max-width:100%;height:auto;margin:1.4em auto;border-radius:10px;background:var(--sunken)}
img.broken{min-height:120px;width:100%;opacity:.6}
p img{display:inline-block;margin:.4em 0}
a img{margin-left:0;margin-right:0}
figure{margin:1.6em 0}
figure img{margin:0 auto}
figure>a{display:block}
figcaption{margin-top:.6em;font:400 13px/1.45 var(--sans);color:var(--ink3);text-align:start}
figcaption:empty{display:none}
blockquote{margin:1.4em 0;padding:0;padding-inline-start:1em;border-inline-start:3px solid var(--quote);color:var(--ink2);font-style:italic}
blockquote p:last-child{margin-bottom:0}
hr{border:0;height:1px;background:var(--rule);margin:2.2em 20%}
ul,ol{padding:0;padding-inline-start:1.3em;margin:0 0 1.05em}
li{margin:.3em 0}
li::marker{color:var(--ink3)}
code,kbd,samp{font-family:ui-monospace,'Roboto Mono',monospace;font-size:.86em;background:var(--code);padding:.12em .35em;border-radius:5px}
pre{background:var(--code);padding:14px 16px;border-radius:12px;font-size:.8em;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin:1.4em 0}
pre code{background:none;padding:0;font-size:inherit}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:1.4em 0;border:1px solid var(--rule);border-radius:10px}
table{border-collapse:collapse;font:400 14px/1.45 var(--sans);min-width:100%;width:max-content}
th,td{max-width:18em;padding:8px 12px;border-bottom:1px solid var(--rule);text-align:start;vertical-align:top}
th{font-weight:600;background:var(--sunken)}
tr:last-child td{border-bottom:0}
a.embed{position:relative;display:block;margin:1.6em 0;border-radius:12px;overflow:hidden;background:var(--ink);text-decoration:none;aspect-ratio:16/9}
a.embed img{margin:0;width:100%;height:100%;object-fit:cover;border-radius:0;opacity:.88}
a.embed::after{content:'';position:absolute;left:50%;top:50%;width:60px;height:60px;margin:-30px 0 0 -30px;border-radius:50%;
  background:rgba(255,255,255,.94) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M9 6.5v11l9-5.5z' fill='%231D1B18'/%3E%3C/svg%3E") 55% 50%/26px no-repeat;
  box-shadow:0 6px 24px rgba(0,0,0,.25)}
a.embed:not(.embed-noimg)::before{content:'';position:absolute;left:0;right:0;bottom:0;height:45%;background:linear-gradient(transparent,rgba(0,0,0,.55))}
a.embed .embed-label{position:absolute;left:14px;bottom:12px;font:600 12px/16px var(--sans);color:#fff;letter-spacing:.04em;text-shadow:0 1px 6px rgba(0,0,0,.5)}
a.embed.embed-noimg{aspect-ratio:auto;padding:28px 18px 44px;background:var(--sunken)}
a.embed.embed-noimg .embed-label{color:var(--ink)}
.end{margin:44px auto 0;width:36px;height:1px;background:var(--rule)}
article img:not(.broken){cursor:zoom-in}
html.lb-open,html.lb-open body{overflow:hidden}
.lightbox{position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;overflow:auto;background:rgba(12,11,10,.94);-webkit-overflow-scrolling:touch}
.lightbox img{display:block;margin:0;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;border-radius:0;background:none}
.lightbox.zoomed{display:block}
.lightbox.zoomed img{max-width:none;max-height:none}
.lightbox button{position:fixed;top:${Math.max(12, topInset - 40)}px;right:14px;width:44px;height:44px;border:0;border-radius:22px;
  background:rgba(255,255,255,.16);color:#fff;font:400 20px/44px var(--sans);text-align:center;padding:0}
`;
}

const bridge = (restore: ReaderDoc['restore']) => `
(function(){
  var post=function(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));};
  var ticking=false,restoring=false,touched=false;
  window.addEventListener('scroll',function(){
    if(ticking)return;ticking=true;
    requestAnimationFrame(function(){
      ticking=false;
      var el=document.scrollingElement;
      post({type:'scroll',y:el.scrollTop,max:Math.max(0,el.scrollHeight-el.clientHeight),restored:restoring});
      restoring=false;
    });
  },{passive:true});
  // Return to where the reader was: once the text is laid out, and again when
  // images have loaded and moved things, unless the reader has started scrolling.
  var R=${JSON.stringify(restore ?? null)};
  window.addEventListener('touchstart',function(){touched=true;},{passive:true,capture:true});
  var applyRestore=function(){
    if(!R||touched)return;
    var el=document.scrollingElement,max=el.scrollHeight-el.clientHeight;
    if(max<=0)return;
    var y=Math.min(max,R.y!=null?R.y:(R.fraction||0)*max);
    if(Math.abs(el.scrollTop-y)<2)return;
    restoring=true;el.scrollTop=y;
  };
  document.addEventListener('DOMContentLoaded',applyRestore);
  window.addEventListener('load',applyRestore);
  var sendMeta=function(){
    var t=document.querySelector('h1.title');
    post({type:'meta',titleBottom:t?t.getBoundingClientRect().bottom+window.scrollY:0});
  };
  window.addEventListener('load',sendMeta);
  document.addEventListener('DOMContentLoaded',sendMeta);
  // Offline and the local copy is missing: show a calm placeholder, keep layout stable.
  document.addEventListener('error',function(e){
    var img=e.target;
    if(!img||img.tagName!=='IMG')return;
    var remote=img.getAttribute('data-remote');
    if(remote&&img.src!==remote&&!img.dataset.retried){img.dataset.retried='1';img.src=remote;return;}
    img.classList.add('broken');img.removeAttribute('src');img.alt='';
  },true);
  // Extracted articles often repeat the headline as their first heading, possibly
  // inside wrapper elements or right after a lead image.
  (function(){
    var norm=function(s){return (s||'').toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu,' ').trim();};
    var title=norm((document.querySelector('h1.title')||{}).textContent);
    var node=document.querySelector('article');
    node=node&&node.firstElementChild;
    while(node&&/^(DIV|SECTION|ARTICLE|HEADER|MAIN|HGROUP)$/.test(node.tagName)&&node.firstElementChild)node=node.firstElementChild;
    if(node&&/^(FIGURE|IMG|PICTURE)$/.test(node.tagName))node=node.nextElementSibling;
    if(node&&title&&/^H[1-3]$/.test(node.tagName)&&norm(node.textContent)===title)node.remove();
  })();
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a[data-action]');
    if(a){e.preventDefault();post({type:a.getAttribute('data-action')});return;}
    var t=e.target;
    if(!lb&&t&&t.tagName==='IMG'&&t.closest('article')&&!t.closest('a')&&!t.classList.contains('broken')&&t.getAttribute('src')){
      e.preventDefault();openLightbox(t);
    }
  });
  // Image viewer: fits the screen; a tap on the image shows it larger to pan
  // around; a tap elsewhere, the close button or Back (via RN) closes it.
  var lb=null;
  var openLightbox=function(from){
    lb=document.createElement('div');lb.className='lightbox';
    var img=document.createElement('img');img.src=from.currentSrc||from.src;img.alt=from.alt||'';
    var close=document.createElement('button');close.type='button';close.setAttribute('aria-label','Close');close.textContent='\u2715';
    lb.appendChild(img);lb.appendChild(close);document.body.appendChild(lb);
    document.documentElement.classList.add('lb-open');
    lb.addEventListener('click',function(e){
      e.stopPropagation();
      if(e.target!==img){window.__closeLightbox();return;}
      var zoom=!lb.classList.contains('zoomed');
      lb.classList.toggle('zoomed',zoom);
      img.style.width=zoom?Math.max(img.naturalWidth,lb.clientWidth*2)+'px':'';
      if(zoom){lb.scrollLeft=(lb.scrollWidth-lb.clientWidth)/2;lb.scrollTop=(lb.scrollHeight-lb.clientHeight)/2;}
    });
    post({type:'lightbox',open:true});
  };
  window.__closeLightbox=function(){
    if(!lb)return;
    lb.remove();lb=null;
    document.documentElement.classList.remove('lb-open');
    post({type:'lightbox',open:false});
  };
  window.__setPrefs=function(p){
    var s=document.documentElement.style;
    s.setProperty('--size',p.size+'px');
    s.setProperty('--lh',String(p.lineHeight));
    s.setProperty('--body',p.family==='serif'?'var(--serif)':'var(--sans)');
    setTimeout(sendMeta,50);
  };
})();
true;
`;

export function readerHtml(doc: ReaderDoc, theme: Theme, prefs: ReaderPrefs, topInset = 0): string {
  const byline = [
    doc.author ? `<b>${esc(doc.author)}</b>` : null,
    `<span>${esc(longDate(doc.publishedAt))}</span>`,
    `<span>${doc.readingMinutes} min read</span>`,
  ]
    .filter(Boolean)
    .join(' · ');
  const icon = doc.feedIcon ? `<img src="${esc(doc.feedIcon)}" alt="">` : '';
  const notice = doc.notice
    ? `<div class="notice${doc.notice.busy ? ' busy' : ''}"><span>${esc(doc.notice.text)}${doc.notice.action ? ` · <a href="#" data-action="notice">${esc(doc.notice.action)}</a>` : ''}</span></div>`
    : '';
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data: https: http:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; media-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'">
<style>${css(theme, prefs, topInset)}</style>
</head><body>
<main>
<header class="meta">
<div class="source">${icon}<span dir="auto">${esc(doc.feedName)}</span></div>
<h1 class="title" dir="auto">${esc(doc.title)}</h1>
<div class="byline" dir="auto">${byline}</div>
</header>
${notice}
<article dir="auto">${doc.contentHtml || '<p style="color:var(--ink3)">This article has no content in the feed.</p>'}</article>
<div class="end"></div>
</main>
<script>${bridge(doc.restore)}</script>
</body></html>`;
}
