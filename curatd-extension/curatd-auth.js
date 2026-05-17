/**
 * Auth session stored in chrome.storage.local by curatd-bridge.js on curatd.live.
 */
(function (globalScope) {
  const STORAGE_KEY = "curatdSession";

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function storageSet(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, resolve);
    });
  }

  async function saveSession(session) {
    if (!session?.idToken) {
      await storageRemove([STORAGE_KEY, "user"]);
      return null;
    }
    await storageSet({
      [STORAGE_KEY]: session,
      user: { uid: session.uid, email: session.email || "" },
    });
    return session;
  }

  async function getStoredSession() {
    const result = await storageGet([STORAGE_KEY]);
    return result[STORAGE_KEY] || null;
  }

  async function clearSession() {
    await storageRemove([STORAGE_KEY, "user"]);
  }

  globalScope.CuratdAuth = {
    STORAGE_KEY,
    saveSession,
    getStoredSession,
    clearSession,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
