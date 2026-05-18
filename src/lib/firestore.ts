import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";

export const USERNAME_TAKEN = "USERNAME_TAKEN";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const PUBLIC_PROFILE_COLLECTION = "publicProfiles";

function normalizeProfileTopics(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((t): t is string => typeof t === "string").slice(0, 20);
}

function safePublicProfileFields(data: {
  username?: unknown;
  photoURL?: unknown;
  profileTopics?: unknown;
}) {
  const out: Record<string, unknown> = {};
  if (typeof data.username === "string" && data.username.trim()) {
    out.username = data.username.trim().toLowerCase();
  }
  if (typeof data.photoURL === "string" && data.photoURL.trim()) {
    out.photoURL = data.photoURL.trim();
  } else if ("photoURL" in data) {
    out.photoURL = null;
  }
  const topics = normalizeProfileTopics(data.profileTopics);
  if (topics) out.profileTopics = topics;
  return out;
}

export async function syncPublicProfile(
  uid: string,
  data: {
    username?: unknown;
    photoURL?: unknown;
    profileTopics?: unknown;
    createdAt?: unknown;
  },
): Promise<void> {
  const fields = safePublicProfileFields(data);
  if ("createdAt" in data && data.createdAt != null) {
    fields.createdAt = data.createdAt;
  }
  if (Object.keys(fields).length === 0) return;
  await setDoc(doc(db, PUBLIC_PROFILE_COLLECTION, uid), fields, { merge: true });
}

export function profileNeedsLegalName(data: {
  firstName?: unknown;
  lastName?: unknown;
} | null): boolean {
  const firstName = typeof data?.firstName === "string" ? data.firstName.trim() : "";
  const lastName = typeof data?.lastName === "string" ? data.lastName.trim() : "";
  return !firstName || !lastName;
}

/** Internal-only profile fields — never shown in public UI. */
export function profileHasAddedClip(data: { hasAddedClip?: unknown } | null | undefined): boolean {
  return data?.hasAddedClip === true;
}

export async function markUserHasAddedClip(uid: string): Promise<void> {
  await setDoc(doc(db, "users", uid), { hasAddedClip: true }, { merge: true });
}

/** True when the user has never saved a clip and should see the extension install prompt. */
export async function shouldPromptExtensionInstall(uid: string): Promise<boolean> {
  const userSnap = await getDoc(doc(db, "users", uid));
  if (profileHasAddedClip(userSnap.exists() ? (userSnap.data() as { hasAddedClip?: unknown }) : null)) {
    return false;
  }
  const clipsSnap = await getDocs(
    query(collection(db, "clips"), where("userId", "==", uid), limit(1)),
  );
  if (!clipsSnap.empty) {
    await markUserHasAddedClip(uid);
    return false;
  }
  return true;
}

export async function saveUserLegalName(
  uid: string,
  params: { firstName: string; lastName: string },
) {
  const firstName = params.firstName.trim();
  const lastName = params.lastName.trim();
  if (!firstName || !lastName) {
    throw new Error("INVALID_NAME");
  }
  await setDoc(
    doc(db, "users", uid),
    { firstName, lastName },
    { merge: true },
  );
}

export function validateUsernameFormat(raw: string): { username: string; ok: true } {
  const username = String(raw).trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new Error("Username must be 3–20 characters, lowercase, and only a-z, 0-9, or _.");
  }
  return { username, ok: true as const };
}

function buildEmailBasedCandidate(email: string, fourDigitSuffix: string | null): string {
  const local = (email.split("@")[0] || "user").replace(/\./g, "").toLowerCase();
  let base = local.replace(/[^a-z0-9_]/g, "");
  if (base.length === 0) base = "user";
  if (fourDigitSuffix) {
    const maxBase = 20 - fourDigitSuffix.length;
    base = base.length > maxBase ? base.slice(0, maxBase) : base;
    base = `${base}${fourDigitSuffix}`;
  }
  if (base.length < 3) {
    base = (base + "cur").slice(0, 3);
  }
  if (base.length > 20) {
    base = base.slice(0, 20);
  }
  if (!USERNAME_RE.test(base)) {
    return "user" + (fourDigitSuffix || String(Math.floor(1000 + Math.random() * 9000)));
  }
  return base;
}

/**
 * On Google sign-in: claim a unique username from email, with optional random suffix.
 */
export async function ensureGoogleUserHasUsername(params: {
  uid: string;
  email: string | null;
  photoURL?: string | null;
}): Promise<string | null> {
  const { uid, email, photoURL } = params;
  if (!email) return null;

  const userRef = doc(db, "users", uid);
  const pre = await getDoc(userRef);
  if (pre.exists()) {
    const data = pre.data() as { username?: string; photoURL?: unknown; profileTopics?: unknown };
    const u = data.username;
    if (typeof u === "string" && u.trim()) {
      const username = u.trim().toLowerCase();
      await syncPublicProfile(uid, {
        username,
        photoURL: data.photoURL ?? photoURL ?? null,
        profileTopics: data.profileTopics,
      });
      return username;
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix =
      attempt === 0 ? null : String(Math.floor(1000 + Math.random() * 9000));
    const candidate = buildEmailBasedCandidate(email, suffix);
    if (!USERNAME_RE.test(candidate)) continue;
    try {
      await runTransaction(db, async (tx) => {
        const uSnap = await tx.get(userRef);
        if (uSnap.exists()) {
          const existing = (uSnap.data() as { username?: string }).username;
          if (typeof existing === "string" && existing.trim()) {
            return;
          }
        }
        const hRef = doc(db, "usernames", candidate);
        const hSnap = await tx.get(hRef);
        if (hSnap.exists()) {
          throw new Error("collision");
        }
        tx.set(hRef, { uid });
        const merge: Record<string, unknown> = {
          username: candidate,
          photoURL: photoURL ?? null,
        };
        if (!uSnap.exists() || (uSnap.data() as { createdAt?: unknown }).createdAt == null) {
          merge.createdAt = serverTimestamp();
        }
        tx.set(userRef, merge, { merge: true });
        tx.set(doc(db, PUBLIC_PROFILE_COLLECTION, uid), merge, { merge: true });
      });
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "";
      if (msg === "collision" && attempt < 4) {
        continue;
      }
      if (msg === "collision") {
        return null;
      }
      throw e;
    }
    const verify = await getDoc(userRef);
    if (verify.exists() && (verify.data() as { username?: string }).username) {
      return String((verify.data() as { username: string }).username).toLowerCase();
    }
  }
  return null;
}

/**
 * First-time claim from the "Choose username" modal.
 */
export async function registerInitialUsername(
  uid: string,
  raw: string,
  options?: { photoURL?: string | null },
) {
  const { username: normalized } = validateUsernameFormat(raw);
  const userRef = doc(db, "users", uid);
  const handleRef = doc(db, "usernames", normalized);

  await runTransaction(db, async (tx) => {
    const uSnap = await tx.get(userRef);
    if (uSnap.exists()) {
      const existing = (uSnap.data() as { username?: string }).username;
      if (typeof existing === "string" && existing.trim()) {
        if (existing.trim().toLowerCase() === normalized) {
          return;
        }
        throw new Error("ALREADY_HAS_USERNAME");
      }
    }
    const hSnap = await tx.get(handleRef);
    if (hSnap.exists()) {
      const u = (hSnap.data() as { uid?: string })?.uid;
      if (u && u === uid) {
        tx.set(userRef, { username: normalized }, { merge: true });
        tx.set(doc(db, PUBLIC_PROFILE_COLLECTION, uid), { username: normalized }, { merge: true });
        return;
      }
      throw new Error(USERNAME_TAKEN);
    }
    tx.set(handleRef, { uid });
    const merge: Record<string, unknown> = {
      username: normalized,
      photoURL: options?.photoURL ?? null,
    };
    if (!uSnap.exists() || (uSnap.data() as { createdAt?: unknown }).createdAt == null) {
      merge.createdAt = serverTimestamp();
    }
    tx.set(userRef, merge, { merge: true });
    tx.set(doc(db, PUBLIC_PROFILE_COLLECTION, uid), merge, { merge: true });
  });
}

/**
 * Change handle for an existing user (move usernames/ doc atomically).
 */
export async function changeUsername(uid: string, raw: string) {
  const { username: normalized } = validateUsernameFormat(raw);

  const userRef = doc(db, "users", uid);
  const newRef = doc(db, "usernames", normalized);

  try {
    await runTransaction(db, async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) {
        throw new Error("user not found");
      }
      const old = (userSnap.data() as { username?: string }).username;
      const oldNorm = typeof old === "string" && old.trim() ? old.trim().toLowerCase() : null;
      if (oldNorm === normalized) {
        return;
      }

      const newSnap = await tx.get(newRef);
      const oldRef =
        oldNorm && oldNorm !== normalized ? doc(db, "usernames", oldNorm) : null;
      const oldHandleSnap = oldRef ? await tx.get(oldRef) : null;

      if (newSnap.exists()) {
        const owner = (newSnap.data() as { uid?: string })?.uid;
        if (owner && owner !== uid) {
          throw new Error(USERNAME_TAKEN);
        }
      } else {
        tx.set(newRef, { uid });
      }

      if (oldRef && oldHandleSnap?.exists()) {
        const oldOwner = (oldHandleSnap.data() as { uid?: string })?.uid;
        if (oldOwner === uid) {
          tx.delete(oldRef);
        }
      }

      tx.update(userRef, { username: normalized });
      tx.set(doc(db, PUBLIC_PROFILE_COLLECTION, uid), { username: normalized }, { merge: true });
    });
  } catch (error) {
    console.error("changeUsername transaction failed:", error);
    throw error;
  }
}
