"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../firebase";
import { ensureGoogleUserHasUsername } from "../src/lib/firestore";

/** Firebase Auth user plus Firestore profile (`users/{uid}`), kept fresh via `onSnapshot`. */
export type AuthUser = User & {
  username: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

function mergeAuthProfile(
  base: User,
  fs: { username: string | null; photoURL: string | null } | null,
): AuthUser {
  const username = fs?.username ?? null;
  const photoURL = fs?.photoURL ?? base.photoURL ?? null;
  return Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
    username,
    photoURL,
  }) as AuthUser;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profileDoc, setProfileDoc] = useState<{
    username: string | null;
    photoURL: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u);
      setLoading(false);
      if (!u) {
        setProfileDoc(null);
      }
      if (u) {
        void ensureGoogleUserHasUsername({
          uid: u.uid,
          email: u.email,
          googleDisplayName: u.displayName,
          photoURL: u.photoURL,
        }).catch(() => {
          // Rules/network failures are surfaced in UsernameSetup / choose-username flow
        });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;

    const userRef = doc(db, "users", firebaseUser.uid);
    const unsub = onSnapshot(
      userRef,
      (snap) => {
        if (!snap.exists()) {
          setProfileDoc({ username: null, photoURL: null });
          return;
        }
        const raw = snap.data() as { username?: unknown; photoURL?: unknown };
        const username =
          typeof raw.username === "string" && raw.username.trim()
            ? raw.username.trim().toLowerCase()
            : null;
        const photoURL =
          typeof raw.photoURL === "string" && raw.photoURL.trim()
            ? raw.photoURL.trim()
            : null;
        setProfileDoc({ username, photoURL });
      },
      (err) => {
        console.error("users/{uid} snapshot error:", err);
      },
    );

    return () => unsub();
  }, [firebaseUser?.uid]);

  const user = useMemo(
    () => (firebaseUser ? mergeAuthProfile(firebaseUser, profileDoc) : null),
    [firebaseUser, profileDoc],
  );

  const value = useMemo<AuthContextValue>(() => {
    return {
      user,
      loading,
      signIn: async () => {
        try {
          const provider = new GoogleAuthProvider();
          await signInWithPopup(auth, provider);
          // ensureGoogleUserHasUsername runs from onAuthStateChanged for the signed-in user
        } catch (e: any) {
          const code = e?.code as string | undefined;
          if (
            code === "auth/popup-closed-by-user" ||
            code === "auth/cancelled-popup-request" ||
            code === "auth/popup-blocked"
          ) {
            return;
          }
          throw e;
        }
      },
      signOut: async () => {
        await firebaseSignOut(auth);
      },
    };
  }, [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
