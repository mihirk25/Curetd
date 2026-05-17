# Curatd Clipper

Chrome extension to save YouTube clips directly to your Curatd Firestore account.

## Features

- **Save to Curatd** button below the video title on YouTube watch pages
- Set start/end timestamps (pre-filled from current playback time)
- Uses your existing [curatd.live](https://curatd.live) login — no separate extension sign-in
- Clips are saved to the `clips` collection with `source: "extension"`

## Load in Chrome (unpacked)

1. Open **Chrome** → **Settings** → **Extensions** (or go to `chrome://extensions/`)
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `curatd-extension` (inside the Curatd repo)
5. Pin the extension from the puzzle icon if you like

## Usage

1. **Sign in at [curatd.live](https://curatd.live)** in Chrome (same browser profile).
2. Click the **Curatd Clipper** icon — you should see “Logged in as [email]” with a green checkmark.
3. Open any YouTube video (`youtube.com/watch?v=...`).
4. Click **Save to Curatd** under the video title.
5. Drag the range handles to set clip start/end, then click **Save Clip**.

## Requirements

- Be signed in at **curatd.live** in the same Chrome profile.
- If the popup says “Please sign in at curatd.live first”, open the site, sign in, wait a moment (the bridge syncs automatically), then click the extension icon again.

## How auth sync works

1. You visit **curatd.live** while signed in.
2. `curatd-bridge.js` reads `firebase:authUser:…` from `localStorage` and sends it to the background worker.
3. The background stores the session in `chrome.storage.local`.
4. The popup and clip saves use that stored session.

## File structure

```
curatd-extension/
  manifest.json       Manifest V3
  popup.html / popup.js   Session status UI
  content.js          Injected on YouTube watch pages
  curatd-bridge.js    Syncs Firebase auth from curatd.live localStorage
  curatd-auth.js      Reads session from chrome.storage.local
  background.js       Service worker (session + Firestore writes)
  styles.css          Injected UI styles
  firebase-config.js  Firebase project config (API key, project ID)
  firebase-rest.js    Firestore via REST (no Firebase SDK)
  icons/              16, 48, 128px icons
```

## Development

No build step and **no external SDK** — all Firebase access uses `fetch` against:

- Auth: `identitytoolkit.googleapis.com` (sign-in) and `securetoken.googleapis.com` (token refresh)
- Firestore: `firestore.googleapis.com/v1/projects/.../documents/...`

Edit files and click **Reload** on `chrome://extensions` for the extension.

## Firestore document shape

Clips include the fields requested for the extension plus fields used by the main app (`userId`, `title`, `moments`, `videoUrl`, etc.) so they appear in the Curatd feed.
