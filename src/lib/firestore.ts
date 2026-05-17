import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../firebase";

export const USERNAME_TAKEN = "USERNAME_TAKEN";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function profileNeedsLegalName(data: {
  firstName?: unknown;
  lastName?: unknown;
} | null): boolean {
  const firstName = typeof data?.firstName === "string" ? data.firstName.trim() : "";
  const lastName = typeof data?.lastName === "string" ? data.lastName.trim() : "";
  return !firstName || !lastName;
}

/** Internal-only profile fields — never shown in public UI. */
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
    const u = (pre.data() as { username?: string }).username;
    if (typeof u === "string" && u.trim()) {
      return u.trim().toLowerCase();
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
    });
  } catch (error) {
    console.error("changeUsername transaction failed:", error);
    throw error;
  }
}
