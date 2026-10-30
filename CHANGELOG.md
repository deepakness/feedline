# Changelog

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
