"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./auth-context";
import {
  ensureGoogleUserHasUsername,
  PRIVATE_USERS_COLLECTION,
  profileNeedsLegalName,
  registerInitialUsername,
  saveUserLegalName,
} from "../src/lib/firestore";

const UsernameStateContext = createContext<{
  username: string | null;
  refreshUsername: () => Promise<void>;
}>({ username: null, refreshUsername: async () => {} });

export function useUsername() {
  return useContext(UsernameStateContext).username;
}

export function useRefreshUsername() {
  return useContext(UsernameStateContext).refreshUsername;
}

function validateUsername(raw: string) {
  const username = raw.trim().toLowerCase();
  const ok = /^[a-z0-9_]{3,20}$/.test(username);
  return { username, ok };
}

type OnboardingStep = "names" | "username";

export function UsernameSetup({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth();
  const [username, setUsername] = useState<string | null>(null);
  const [needsNames, setNeedsNames] = useState(false);
  const [checking, setChecking] = useState(false);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<OnboardingStep>("names");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshUsername = useCallback(async () => {
    if (!user) {
      setUsername(null);
      return;
    }
    try {
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      const u = snap.exists() ? (snap.data() as { username?: string }) : null;
      const existing = u?.username ? String(u.username).toLowerCase() : null;
      setUsername(existing);
    } catch {
      setUsername(null);
    }
  }, [user?.uid]);

  useEffect(() => {
    setError(null);
    setSaving(false);
    setInput("");
    setFirstName("");
    setLastName("");

    if (!user) {
      setUsername(null);
      setNeedsNames(false);
      setOpen(false);
      setChecking(false);
      return;
    }

    const userRef = doc(db, "users", user.uid);
    const privateUserRef = doc(db, PRIVATE_USERS_COLLECTION, user.uid);
    const unsubUser = onSnapshot(
      userRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        const v =
          data?.username && String(data.username).trim()
            ? String(data.username).toLowerCase()
            : null;
        setUsername(v);
      },
      () => {
        setUsername(null);
      },
    );
    const unsubPrivateUser = onSnapshot(
      privateUserRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        setNeedsNames(profileNeedsLegalName(data));
      },
      () => {
        setNeedsNames(true);
      },
    );

    let cancelled = false;
    setChecking(true);
    void (async () => {
      try {
        await ensureGoogleUserHasUsername({
          uid: user.uid,
          email: user.email,
          photoURL: user.photoURL,
        });
      } catch {
        // Firestore rules or offline; snapshot + onboarding flow still apply
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
      unsubUser();
      unsubPrivateUser();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user) {
      setOpen(false);
      return;
    }
    if (checking) return;

    if (needsNames) {
      setStep("names");
      setOpen(true);
      return;
    }
    if (!username) {
      setStep("username");
      setOpen(true);
      return;
    }
    setOpen(false);
  }, [user, username, needsNames, checking]);

  const contextValue = useMemo(
    () => ({ username, refreshUsername }),
    [username, refreshUsername],
  );

  async function handleNamesSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!user) return;
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) {
      setError("Please enter your first and last name.");
      return;
    }

    setSaving(true);
    try {
      await saveUserLegalName(user.uid, { firstName: fn, lastName: ln });
      setNeedsNames(false);
      if (!username) {
        setStep("username");
      } else {
        setOpen(false);
      }
    } catch {
      setError("Could not save your name. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUsernameSubmit(e: React.FormEvent) {
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
      await registerInitialUsername(user.uid, normalized, {
        photoURL: user.photoURL,
      });

      setUsername(normalized);
      setOpen(false);
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
      if (code === "USERNAME_TAKEN") {
        setError("That username is taken.");
      } else if (code === "ALREADY_HAS_USERNAME") {
        setError("You already have a username on this account.");
      } else {
        setError("Could not save username. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <UsernameStateContext.Provider value={contextValue}>
      {children}

      {open && user && !checking ? (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => {}}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-8"
            onClick={(ev) => ev.stopPropagation()}
          >
            {step === "names" ? (
              <>
                <div className="mb-6">
                  <h2 className="text-xl font-bold">Welcome to Curatd</h2>
                  <p className="text-zinc-500 text-sm mt-0.5">
                    Your name is kept private and never shown on your public profile.
                  </p>
                </div>

                <form onSubmit={handleNamesSubmit} className="space-y-4">
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1.5 block">
                      First name
                    </label>
                    <input
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="e.g. Raj"
                      className="w-full bg-black border border-zinc-700 p-3.5 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm"
                      autoComplete="given-name"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1.5 block">
                      Last name
                    </label>
                    <input
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="e.g. Patel"
                      className="w-full bg-black border border-zinc-700 p-3.5 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm"
                      autoComplete="family-name"
                    />
                  </div>
                  {error ? <div className="text-xs text-red-400">{error}</div> : null}

                  <button
                    type="submit"
                    disabled={saving}
                    className={`w-full font-bold py-4 rounded-xl transition-all text-sm ${
                      saving
                        ? "bg-zinc-800 text-zinc-400 cursor-not-allowed"
                        : "bg-white text-black hover:bg-zinc-200"
                    }`}
                  >
                    {saving ? "Saving..." : "Continue"}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="mb-6">
                  <h2 className="text-xl font-bold">Choose a username</h2>
                  <p className="text-zinc-500 text-sm mt-0.5">
                    This is your public handle — only @username is visible to others.
                  </p>
                </div>

                <form onSubmit={handleUsernameSubmit} className="space-y-4">
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
              </>
            )}
          </div>
        </div>
      ) : null}

    </UsernameStateContext.Provider>
  );
}
