"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth } from "../firebase";
import { ensureGoogleUserHasUsername } from "../src/lib/firestore";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
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
