/* global firebase, FIREBASE_CONFIG */

importScripts(
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js",
  "firebase-config.js",
);

function initFirebase() {
  if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }
  return {
    auth: firebase.auth(),
    db: firebase.firestore(),
  };
}

const { auth, db } = initFirebase();

auth.onAuthStateChanged((user) => {
  if (user) {
    chrome.storage.local.set({
      user: { uid: user.uid, email: user.email || "" },
    });
  } else {
    chrome.storage.local.remove(["user"]);
  }
});

function newMomentId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function getUserProfile(uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    return { username: null, displayName: null };
  }
  const data = snap.data() || {};
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

async function saveClipToFirestore(data) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Not signed in. Open the Curatd Clipper popup and sign in.");
  }

  const videoId = String(data.videoId || "").trim();
  const videoTitle = String(data.videoTitle || "Untitled").trim();
  const startTime = Math.max(0, Number(data.startTime) || 0);
  const endTime = Math.max(startTime + 1, Number(data.endTime) || startTime + 60);
  const channelName = String(data.channelName || "YouTube").trim() || "YouTube";

  if (!videoId) {
    throw new Error("Missing YouTube video ID.");
  }

  const profile = await getUserProfile(user.uid);
  const username = profile.username;
  const displayName = profile.displayName || username || "Anonymous";

  const moment = {
    id: newMomentId(),
    startTime,
    endTime,
    note: "",
    topic: "General",
    addedAt: firebase.firestore.Timestamp.now(),
  };

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const existingSnap = await db
    .collection("clips")
    .where("videoId", "==", videoId)
    .where("audioOnly", "==", false)
    .where("userId", "==", user.uid)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    const docRef = existingSnap.docs[0].ref;
    await docRef.update({
      title: videoTitle,
      channelName,
      videoId,
      videoUrl,
      audioOnly: false,
      username,
      displayName,
      source: "extension",
      curatorId: user.uid,
      curatorEmail: user.email || "",
      videoTitle,
      startTime,
      endTime,
      moments: firebase.firestore.FieldValue.arrayUnion(moment),
    });
    return { ok: true, clipId: docRef.id, merged: true };
  }

  const docRef = await db.collection("clips").add({
    videoId,
    videoTitle,
    videoUrl,
    title: videoTitle,
    channelName,
    startTime,
    endTime,
    curatorId: user.uid,
    curatorEmail: user.email || "",
    userId: user.uid,
    username,
    displayName,
    audioOnly: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    source: "extension",
    moments: [moment],
  });

  return { ok: true, clipId: docRef.id, merged: false };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_USER") {
    chrome.storage.local.get(["user"], (result) => {
      sendResponse({ user: result.user || null });
    });
    return true;
  }

  if (message?.type === "SAVE_CLIP") {
    saveClipToFirestore(message.data || {})
      .then((result) => sendResponse(result))
      .catch((err) => {
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true;
  }

  return false;
});
