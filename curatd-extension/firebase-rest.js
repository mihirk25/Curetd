/**
 * Firestore REST (no SDK). Auth session comes from curatd.live via CuratdAuth.
 */
(function (globalScope) {
  function cfg() {
    if (typeof FIREBASE_CONFIG === "undefined") {
      throw new Error("FIREBASE_CONFIG is not defined.");
    }
    return FIREBASE_CONFIG;
  }

  function encodeValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === "string") return { stringValue: val };
    if (typeof val === "boolean") return { booleanValue: val };
    if (typeof val === "number") {
      if (Number.isInteger(val)) return { integerValue: String(val) };
      return { doubleValue: val };
    }
    if (val instanceof Date) return { timestampValue: val.toISOString() };
    if (Array.isArray(val)) {
      return { arrayValue: { values: val.map((v) => encodeValue(v)) } };
    }
    if (typeof val === "object") {
      const fields = {};
      for (const [k, v] of Object.entries(val)) {
        fields[k] = encodeValue(v);
      }
      return { mapValue: { fields } };
    }
    throw new Error(`Unsupported Firestore value type: ${typeof val}`);
  }

  function decodeValue(v) {
    if (!v || typeof v !== "object") return null;
    if ("nullValue" in v) return null;
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return v.doubleValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("arrayValue" in v) {
      const values = v.arrayValue?.values || [];
      return values.map(decodeValue);
    }
    if ("mapValue" in v) {
      const fields = v.mapValue?.fields || {};
      const out = {};
      for (const [k, fv] of Object.entries(fields)) {
        out[k] = decodeValue(fv);
      }
      return out;
    }
    return null;
  }

  function decodeDocument(doc) {
    if (!doc?.fields) return {};
    const out = {};
    for (const [key, val] of Object.entries(doc.fields)) {
      out[key] = decodeValue(val);
    }
    return out;
  }

  function docIdFromName(name) {
    if (!name) return "";
    const parts = String(name).split("/");
    return parts[parts.length - 1] || "";
  }

  async function refreshSession(session) {
    const { apiKey } = cfg();
    const res = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: session.refreshToken,
        }),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || "Token refresh failed.");
    }
    const expiresIn = Number(data.expires_in) || 3600;
    return {
      idToken: data.id_token,
      refreshToken: data.refresh_token || session.refreshToken,
      uid: data.user_id || session.uid,
      email: session.email || "",
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }

  async function getValidSession() {
    if (typeof CuratdAuth === "undefined") {
      throw new Error("CuratdAuth is not loaded.");
    }
    let session = await CuratdAuth.getStoredSession();
    if (!session?.idToken) return null;
    if (session.expiresAt > Date.now() + 60_000) return session;
    if (!session.refreshToken) return null;
    try {
      session = await refreshSession(session);
      await CuratdAuth.saveSession(session);
      return session;
    } catch {
      return null;
    }
  }

  async function firestoreRequest(path, options = {}) {
    const session = await getValidSession();
    if (!session) {
      throw new Error("Please sign in at curatd.live first, then try again.");
    }
    const { projectId } = cfg();
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.idToken}`,
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.error?.message || `Firestore request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  async function runQuery(structuredQuery) {
    const { projectId } = cfg();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
    const session = await getValidSession();
    if (!session) {
      throw new Error("Please sign in at curatd.live first, then try again.");
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.idToken}`,
      },
      body: JSON.stringify({ structuredQuery }),
    });
    const rows = await res.json();
    if (!res.ok) {
      throw new Error(rows?.error?.message || "Firestore query failed.");
    }
    const docs = [];
    for (const row of rows || []) {
      if (row?.document) docs.push(row.document);
    }
    return docs;
  }

  async function getUserProfile(uid) {
    const doc = await firestoreRequest(`/users/${encodeURIComponent(uid)}`);
    const data = decodeDocument(doc);
    const username =
      typeof data.username === "string" && data.username.trim()
        ? data.username.trim().toLowerCase()
        : null;
    const displayName =
      typeof data.displayName === "string" && data.displayName.trim()
        ? data.displayName.trim()
        : username;
    return { username, displayName };
  }

  async function findExistingClip(uid, videoId) {
    const docs = await runQuery({
      from: [{ collectionId: "clips" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: "videoId" },
                op: "EQUAL",
                value: { stringValue: videoId },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: "audioOnly" },
                op: "EQUAL",
                value: { booleanValue: false },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: "userId" },
                op: "EQUAL",
                value: { stringValue: uid },
              },
            },
          ],
        },
      },
      limit: 1,
    });
    if (!docs.length) return null;
    const doc = docs[0];
    return {
      id: docIdFromName(doc.name),
      data: decodeDocument(doc),
      raw: doc,
    };
  }

  function newMomentId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function buildFieldsObject(data) {
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
      fields[k] = encodeValue(v);
    }
    return fields;
  }

  async function createClip(fields) {
    const doc = await firestoreRequest("/clips", {
      method: "POST",
      body: JSON.stringify({ fields: buildFieldsObject(fields) }),
    });
    return docIdFromName(doc.name);
  }

  async function patchClip(docId, fields) {
    const mask = Object.keys(fields)
      .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
      .join("&");
    await firestoreRequest(`/clips/${encodeURIComponent(docId)}?${mask}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: buildFieldsObject(fields) }),
    });
  }

  async function saveClip(data) {
    const session = await getValidSession();
    if (!session) {
      throw new Error("Please sign in at curatd.live first, then try again.");
    }

    const videoId = String(data.videoId || "").trim();
    const videoTitle = String(data.videoTitle || "Untitled").trim();
    const startTime = Math.max(0, Number(data.startTime) || 0);
    const endTime = Math.max(startTime + 1, Number(data.endTime) || startTime + 60);
    const channelName = String(data.channelName || "YouTube").trim() || "YouTube";

    if (!videoId) {
      throw new Error("Missing YouTube video ID.");
    }

    const profile = await getUserProfile(session.uid);
    const username = profile.username;
    const displayName = profile.displayName || username || "Anonymous";

    const moment = {
      id: newMomentId(),
      startTime,
      endTime,
      note: "",
      topic: "General",
      addedAt: new Date().toISOString(),
    };

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const existing = await findExistingClip(session.uid, videoId);

    if (existing) {
      const moments = Array.isArray(existing.data.moments) ? [...existing.data.moments] : [];
      moments.push(moment);
      await patchClip(existing.id, {
        title: videoTitle,
        channelName,
        videoId,
        videoUrl,
        audioOnly: false,
        username,
        displayName,
        source: "extension",
        curatorId: session.uid,
        curatorEmail: session.email || "",
        videoTitle,
        startTime,
        endTime,
        moments,
      });
      return { ok: true, clipId: existing.id, merged: true };
    }

    const clipId = await createClip({
      videoId,
      videoTitle,
      videoUrl,
      title: videoTitle,
      channelName,
      startTime,
      endTime,
      curatorId: session.uid,
      curatorEmail: session.email || "",
      userId: session.uid,
      username,
      displayName,
      audioOnly: false,
      createdAt: new Date().toISOString(),
      source: "extension",
      moments: [moment],
    });

    return { ok: true, clipId, merged: false };
  }

  globalScope.CuratdFirebaseRest = {
    getValidSession,
    saveClip,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
