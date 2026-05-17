importScripts("firebase-config.js", "curatd-auth.js", "firebase-rest.js");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_CURATD_SESSION" || message?.type === "GET_USER") {
    CuratdAuth.getCuratdLiveSession()
      .then(async (session) => {
        if (!session?.idToken) {
          sendResponse({ session: null, user: null });
          return;
        }
        if (session.expiresAt > Date.now() + 60_000) {
          sendResponse({
            session,
            user: { uid: session.uid, email: session.email || "" },
          });
          return;
        }
        if (!session.refreshToken) {
          sendResponse({ session: null, user: null });
          return;
        }
        try {
          const refreshed = await CuratdFirebaseRest.getValidSession();
          sendResponse({
            session: refreshed,
            user: refreshed
              ? { uid: refreshed.uid, email: refreshed.email || "" }
              : null,
          });
        } catch {
          sendResponse({ session: null, user: null });
        }
      })
      .catch(() => sendResponse({ session: null, user: null }));
    return true;
  }

  if (message?.type === "SAVE_CLIP") {
    CuratdFirebaseRest.saveClip(message.data || {})
      .then((result) => sendResponse(result))
      .catch((err) => {
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true;
  }

  return false;
});
