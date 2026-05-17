importScripts("firebase-config.js", "curatd-auth.js", "firebase-rest.js");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CURATD_AUTH_SESSION") {
    const session = message.session || null;
    if (session?.idToken) {
      CuratdAuth.saveSession(session)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
    } else {
      CuratdAuth.clearSession()
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
    }
    return true;
  }

  if (message?.type === "GET_CURATD_SESSION" || message?.type === "GET_USER") {
    CuratdFirebaseRest.getValidSession()
      .then((session) => {
        if (!session?.idToken) {
          sendResponse({ session: null, user: null });
          return;
        }
        sendResponse({
          session,
          user: { uid: session.uid, email: session.email || "" },
        });
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
