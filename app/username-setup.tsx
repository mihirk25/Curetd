"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./auth-context";

const UsernameContext = createContext<string | null>(null);

export function useUsername() {
  return useContext(UsernameContext);
}

function validateUsername(raw: string) {
  const username = raw.trim().toLowerCase();
  const ok = /^[a-z0-9_]{3,20}$/.test(username);
  return { username, ok };
}

export function UsernameSetup({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth();
  const [username, setUsername] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setError(null);
      setSaving(false);
      setInput("");

      if (!user) {
        setUsername(null);
        setOpen(false);
        return;
      }

      setChecking(true);
      try {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        const u = snap.exists() ? (snap.data() as any) : null;
        const existing = u?.username ? String(u.username) : null;
        if (cancelled) return;
        if (existing) {
          setUsername(existing);
          setOpen(false);
          const dn = u?.displayName ?? user.displayName ?? null;
          if (dn != null && u?.displayNameLower == null) {
            updateDoc(userRef, {
              displayNameLower: String(dn).toLowerCase(),
            }).catch(() => {});
          }
        } else {
          setUsername(null);
          setOpen(true);
        }
      } catch {
        if (!cancelled) {
          setUsername(null);
          setOpen(true);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const contextValue = useMemo(() => username, [username]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!user) return;
    const { username: normalized, ok } = validateUsername(input);
    if (!ok) {
      setError("Username must be 3–20 chars, lowercase, and only a-z, 0-9, or _.");
      return;
    }

    setSaving(true);
    try {
      const handleRef = doc(db, "usernames", normalized);
      const handleSnap = await getDoc(handleRef);
      if (handleSnap.exists()) {
        setError("That username is taken.");
        setSaving(false);
        return;
      }

      const batch = writeBatch(db);
      const displayName = user.displayName ?? null;
      batch.set(doc(db, "users", user.uid), {
        username: normalized,
        displayName,
        displayNameLower: (displayName ?? "").toLowerCase(),
        photoURL: user.photoURL,
        createdAt: serverTimestamp(),
      });
      batch.set(handleRef, { uid: user.uid });
      await batch.commit();

      setUsername(normalized);
      setOpen(false);
    } catch {
      setError("Could not save username. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <UsernameContext.Provider value={contextValue}>
      {children}

      {open && user && !checking && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => {}}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-8"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-6">
              <h2 className="text-xl font-bold">Choose a username</h2>
              <p className="text-zinc-500 text-sm mt-0.5">
                Pick a unique handle to claim your curator profile.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1.5 block">
                  Username
                </label>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="e.g. mihir_kuvadiya"
                  className="w-full bg-black border border-zinc-700 p-3.5 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <div className="text-xs text-zinc-500 mt-2">
                  Lowercase, 3–20 characters, letters/numbers/underscores only.
                </div>
                {error ? <div className="text-xs text-red-400 mt-2">{error}</div> : null}
              </div>

              <button
                type="submit"
                disabled={saving}
                className={`w-full font-bold py-4 rounded-xl transition-all text-sm ${
                  saving
                    ? "bg-zinc-800 text-zinc-400 cursor-not-allowed"
                    : "bg-white text-black hover:bg-zinc-200"
                }`}
              >
                {saving ? "Saving..." : "Save username"}
              </button>
            </form>
          </div>
        </div>
      )}
    </UsernameContext.Provider>
  );
}

