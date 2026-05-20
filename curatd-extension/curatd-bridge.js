/**
 * Runs on curatd.live — reads Firebase auth from IndexedDB and syncs to the extension.
 */
(function () {
  const DB_NAME = "firebaseLocalStorageDb";
  const STORE_NAME = "firebaseLocalStorage";
  const AUTH_KEY = `firebase:authUser:${FIREBASE_CONFIG.apiKey}:[DEFAULT]`;

  let lastPayload = null;

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  function getAllFromStore(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  function getByKey(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /** @param {unknown} entry */
  function parseAuthEntry(entry) {
    if (entry == null) return null;

    let raw = entry;
    if (typeof entry === "object") {
      const row = /** @type {Record<string, unknown>} */ (entry);
      if (typeof row.value === "string") {
        raw = row.value;
      } else if (row.value && typeof row.value === "object") {
        raw = row.value;
      } else if (row.stsTokenManager) {
        raw = entry;
      }
    }

    let data;
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw);
      } catch {
        return null;
      }
    } else if (typeof raw === "object") {
      data = raw;
    } else {
      return null;
    }

    const tm = data?.stsTokenManager;
    if (!tm?.accessToken || !data?.uid) return null;

    return {
      uid: data.uid,
      email: data.email || "",
      idToken: tm.accessToken,
      refreshToken: tm.refreshToken || "",
      expiresAt: Number(tm.expirationTime) || 0,
    };
  }

  async function readSessionFromIndexedDB() {
    let db;
    try {
      db = await openDb();
    } catch {
      return null;
    }

    try {
      const direct = await getByKey(db, AUTH_KEY);
      const fromDirect = parseAuthEntry(direct);
      if (fromDirect) return fromDirect;

      const rows = await getAllFromStore(db);
      for (const row of rows) {
        const rowKey =
          row && typeof row === "object"
            ? row.fbase_key || row.key || null
            : null;
        if (rowKey === AUTH_KEY) {
          const session = parseAuthEntry(row);
          if (session) return session;
        }
      }

      return null;
    } catch {
      return null;
    } finally {
      db.close();
    }
  }

  async function syncSession() {
    const session = await readSessionFromIndexedDB();
    const payload = session ? JSON.stringify(session) : "null";
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

  window.addEventListener("focus", () => {
    void syncSession();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncSession();
  });

  setInterval(() => {
    void syncSession();
  }, 3000);
})();
