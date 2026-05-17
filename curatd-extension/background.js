importScripts("firebase-config.js", "firebase-rest.js");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_USER") {
    CuratdFirebaseRest.getValidSession()
      .then((session) => {
        if (!session) {
          sendResponse({ user: null });
          return;
        }
        sendResponse({
          user: { uid: session.uid, email: session.email || "" },
        });
      })
      .catch(() => sendResponse({ user: null }));
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
