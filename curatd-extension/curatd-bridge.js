/**
 * Runs on curatd.live — reads Firebase auth from localStorage and syncs to the extension.
 */
(function () {
  const AUTH_KEY = `firebase:authUser:${FIREBASE_CONFIG.apiKey}:[DEFAULT]`;
  let lastPayload = "";

  function readSession() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
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

  function syncSession() {
    const session = readSession();
    const payload = session ? JSON.stringify(session) : "";
    if (payload === lastPayload) return;
    lastPayload = payload;

    chrome.runtime.sendMessage(
      {
        type: "CURATD_AUTH_SESSION",
        session,
      },
      () => {
        void chrome.runtime.lastError;
      },
    );
  }

  syncSession();

  // Re-sync when auth changes (other tabs) or periodically while user is on site
  window.addEventListener("storage", (e) => {
    if (e.key === AUTH_KEY || (e.key && e.key.startsWith("firebase:authUser:"))) {
      syncSession();
    }
  });

  window.addEventListener("focus", syncSession);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncSession();
  });

  setInterval(syncSession, 3000);
})();
