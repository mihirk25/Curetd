/**
 * Read Firebase Auth session from curatd.live (cookies + site localStorage).
 */
(function (globalScope) {
  const CURATD_ORIGIN = "https://curatd.live";
  const CURATD_URL = `${CURATD_ORIGIN}/`;

  function cfg() {
    if (typeof FIREBASE_CONFIG === "undefined") {
      throw new Error("FIREBASE_CONFIG is not defined.");
    }
    return FIREBASE_CONFIG;
  }

  /** @param {unknown} data */
  function parseFirebaseAuthUser(data) {
    if (!data || typeof data !== "object") return null;
    const u = /** @type {Record<string, unknown>} */ (data);
    const tm = u.stsTokenManager;
    if (!tm || typeof tm !== "object") return null;
    const tokenMgr = /** @type {Record<string, unknown>} */ (tm);
    const idToken =
      typeof tokenMgr.accessToken === "string" ? tokenMgr.accessToken : "";
    if (!idToken) return null;
    const refreshToken =
      typeof tokenMgr.refreshToken === "string" ? tokenMgr.refreshToken : "";
    const expiresAt = Number(tokenMgr.expirationTime) || 0;
    const uid = typeof u.uid === "string" ? u.uid : "";
    const email = typeof u.email === "string" ? u.email : "";
    if (!uid) return null;
    return { uid, email, idToken, refreshToken, expiresAt };
  }

  /** @param {string} raw */
  function parseAuthJson(raw) {
    if (!raw) return null;
    try {
      return parseFirebaseAuthUser(JSON.parse(raw));
    } catch {
      try {
        return parseFirebaseAuthUser(JSON.parse(decodeURIComponent(raw)));
      } catch {
        return null;
      }
    }
  }

  function readAuthFromStorageInPage(apiKey) {
    function parse(raw) {
      if (!raw) return null;
      try {
        const data = JSON.parse(raw);
        const tm = data?.stsTokenManager;
        if (!tm?.accessToken || !data?.uid) return null;
        return {
          uid: data.uid,
          email: data.email || "",
          idToken: tm.accessToken,
          refreshToken: tm.refreshToken || "",
          expiresAt: Number(tm.expirationTime) || 0,
        };
      } catch {
        return null;
      }
    }
    if (apiKey) {
      const exact = localStorage.getItem(`firebase:authUser:${apiKey}:[DEFAULT]`);
      const fromExact = parse(exact);
      if (fromExact) return fromExact;
    }
    const prefix = "firebase:authUser:";
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const session = parse(localStorage.getItem(key));
      if (session) return session;
    }
    return null;
  }

  function getAllCookies() {
    return new Promise((resolve) => {
      chrome.cookies.getAll({ url: CURATD_URL }, resolve);
    });
  }

  function queryCuratdTabs() {
    return new Promise((resolve) => {
      chrome.tabs.query({ url: `${CURATD_ORIGIN}/*` }, resolve);
    });
  }

  async function readAuthFromCookies() {
    const cookies = await getAllCookies();
    for (const cookie of cookies) {
      if (
        cookie.name.startsWith("firebase:authUser:") ||
        cookie.name.includes("firebase") ||
        cookie.name === "__session"
      ) {
        const session = parseAuthJson(cookie.value);
        if (session) return session;
      }
    }
    return null;
  }

  async function readAuthFromOpenTab() {
    const tabs = await queryCuratdTabs();
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_CURATD_AUTH" });
        if (response?.session) return response.session;
      } catch {
        /* content script may not be loaded yet */
      }
    }
    return null;
  }

  async function readAuthViaScripting() {
    const tabs = await queryCuratdTabs();
    if (!tabs.length) return null;
    const tabId = tabs[0].id;
    if (!tabId) return null;
    try {
      const { apiKey } = cfg();
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: readAuthFromStorageInPage,
        args: [apiKey],
      });
      return results?.[0]?.result || null;
    } catch {
      return null;
    }
  }

  async function getCuratdLiveSession() {
    const fromCookies = await readAuthFromCookies();
    if (fromCookies) return fromCookies;

    const fromTab = await readAuthFromOpenTab();
    if (fromTab) return fromTab;

    const fromScript = await readAuthViaScripting();
    if (fromScript) return fromScript;

    return null;
  }

  globalScope.CuratdAuth = {
    CURATD_ORIGIN,
    CURATD_URL,
    getCuratdLiveSession,
    parseFirebaseAuthUser,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
