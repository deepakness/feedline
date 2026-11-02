# Changelog

## 1.1.4 (versionCode 16)

- Articles reopen where you left off, and the page no longer jumps to the top when the full text arrives
- Tap an image to see it larger; tap again to zoom and pan
- Right-to-left articles (Arabic, Hebrew, Persian) read in the right direction
- The reader follows your phone's text size
- Feeds in older text encodings (Cyrillic, Greek, Central European and more) display correctly; unreadable ones say so instead of showing garbled text
- A dropped connection no longer leaves an article stuck as a summary: Feedline tries again later
- Choosing a shorter "Keep articles" period asks before deleting anything
- "Never" download images now also skips list thumbnails; "Wi-Fi only" waits for Wi-Fi for them too
- Feeds that keep failing are checked less often, and missing site icons are looked for weekly instead of on every refresh
- Fewer database writes on each refresh, size limits on downloads, and partly downloaded images get retried
- Read articles in the list stay easy to read; grey text has more contrast
- TalkBack reads Settings descriptions and which feeds failed
- Feedline's data is no longer included in Android's cloud backup
- Smaller install from Google Play

## 1.1.3 (versionCode 15)

- Bigger mark in the app icon

## 1.1.2 (versionCode 14)

- New package name, `com.vempus.feedline`, ahead of the Google Play release. This installs as a new app: export your feeds as OPML from the old one first
- Removed permissions Feedline doesn't need: drawing over other apps, and old storage access
- Settings → About links to the source code
- Added a privacy policy, linked from Settings → About
- New terracotta app icon

## 1.1.1 (versionCode 12)

- Removed swiping between articles in the reader: scrolls that drifted sideways turned into swipes
- Previous and next arrows in the reader's toolbar
- Fixed a blank gap at the top of the list after switching views

## 1.1.0 (versionCode 11)

- Fixed: swiping between articles in the reader never worked
- Back from the reader scrolls the list to the last article read
- Read articles are clearly faded in every list style
- With "Hide read", articles read since the last refresh stay listed
- Removed pull-to-refresh, which fired by accident
- "Back to top" / "New articles" button on long lists
- Back from a feed or Saved returns to All articles
- Optional background refresh every few hours (off by default)
- Sort feeds by name or unread count
- Search within one feed or Saved
- "Mark all as read" on a feed's page, with Undo
- A message when the automatic refresh can't reach any feed
- Version row in Settings opens release notes

## 1.0.0 (versionCode 10)

First public release.

- Unified timeline with day headers and Standard, Compact and Cards list styles
- Offline reading: full article text and images are saved on refresh
- Reader with adjustable size, line spacing and serif or sans type; swipe between articles
- Saved articles, hide read, mark all read, full-text search
- Add feeds by site address or from the share sheet; OPML import and export
- Manual refresh, plus optional refresh when the app opens
- Article retention of 7, 30 or 90 days, or forever
- Settings → Follow Feedline updates: new versions arrive in your timeline as a feed
- APKs for 64-bit (`feedline.apk`) and older 32-bit phones (`feedline-armv7.apk`), each with a `.sha256` checksum
