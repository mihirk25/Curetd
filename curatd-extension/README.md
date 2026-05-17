# Curatd Clipper

Chrome extension to save YouTube clips directly to your Curatd Firestore account.

## Features

- **Save to Curatd** button below the video title on YouTube watch pages
- Set start/end timestamps (pre-filled from current playback time)
- Sign in with the same Firebase email/password as [curatd.live](https://curatd.live)
- Clips are saved to the `clips` collection with `source: "extension"`

## Load in Chrome (unpacked)

1. Open **Chrome** → **Settings** → **Extensions** (or go to `chrome://extensions/`)
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `curatd-extension` (inside the Curatd repo)
5. Pin the extension from the puzzle icon if you like

## Usage

1. Click the **Curatd Clipper** icon in the toolbar and **sign in** with your Curatd account email and password.
2. Open any YouTube video (`youtube.com/watch?v=...`).
3. Click **Save to Curatd** under the video title.
4. Adjust start/end times and click **Save Clip**.

## Requirements

- A Curatd account with **Email/Password** sign-in enabled in Firebase Auth (same as the web app).
- You must be signed in via the extension popup before saving clips.

## File structure

```
curatd-extension/
  manifest.json       Manifest V3
  popup.html / popup.js   Login UI
  content.js          Injected on YouTube watch pages
  background.js       Service worker (auth + Firestore writes)
  styles.css          Injected UI styles
  firebase-config.js  Firebase project config
  icons/              16, 48, 128px icons
```

## Development

No build step — edit files and click **Reload** on `chrome://extensions` for the extension.

Firebase is loaded from the CDN (compat SDK 9.23.0) in the popup and service worker.

## Firestore document shape

Clips include the fields requested for the extension plus fields used by the main app (`userId`, `title`, `moments`, `videoUrl`, etc.) so they appear in the Curatd feed.
