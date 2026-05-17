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
4. Drag the range handles to set clip start/end, then click **Save Clip**.

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
  firebase-config.js  Firebase project config (API key, project ID)
  firebase-rest.js    Auth + Firestore via REST (no Firebase SDK)
  icons/              16, 48, 128px icons
```

## Development

No build step and **no external SDK** — all Firebase access uses `fetch` against:

- Auth: `identitytoolkit.googleapis.com` (sign-in) and `securetoken.googleapis.com` (token refresh)
- Firestore: `firestore.googleapis.com/v1/projects/.../documents/...`

Edit files and click **Reload** on `chrome://extensions` for the extension.

## Firestore document shape

Clips include the fields requested for the extension plus fields used by the main app (`userId`, `title`, `moments`, `videoUrl`, etc.) so they appear in the Curatd feed.
