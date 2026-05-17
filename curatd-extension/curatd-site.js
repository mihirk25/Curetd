/**
 * Runs on curatd.live — exposes Firebase auth from localStorage to the extension.
 */
(function () {
  function readSession() {
    if (typeof FIREBASE_CONFIG === "undefined") {
      const prefix = "firebase:authUser:";
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        try {
          const data = JSON.parse(localStorage.getItem(key) || "");
          const tm = data?.stsTokenManager;
          if (tm?.accessToken && data?.uid) {
            return {
              uid: data.uid,
              email: data.email || "",
              idToken: tm.accessToken,
              refreshToken: tm.refreshToken || "",
              expiresAt: Number(tm.expirationTime) || 0,
            };
          }
        } catch {
          /* skip */
        }
      }
      return null;
    }
    const apiKey = FIREBASE_CONFIG.apiKey;
    const key = `firebase:authUser:${apiKey}:[DEFAULT]`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_CURATD_AUTH") {
      sendResponse({ session: readSession() });
      return true;
    }
    return false;
  });
})();
