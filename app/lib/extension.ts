/** Chrome Web Store or install page — set `NEXT_PUBLIC_CHROME_EXTENSION_URL` in Vercel. */
export const CHROME_EXTENSION_INSTALL_URL =
  typeof process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL === "string" &&
  process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL.trim()
    ? process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL.trim()
    : "https://chromewebstore.google.com/search/curatd%20clipper";
