"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-context";
import { useRefreshUsername } from "./username-setup";
import { changeUsername, USERNAME_TAKEN, validateUsernameFormat } from "../src/lib/firestore";

type EditUsernameControlProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Empty when the user has not claimed a handle yet; first save uses the same flow as change. */
  currentUsername: string;
};

export function EditUsernameModal({ open, onOpenChange, currentUsername }: EditUsernameControlProps) {
  const { user } = useAuth();
  const refreshUsername = useRefreshUsername();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setInput(currentUsername);
      setError(null);
    }
  }, [open, currentUsername]);

  if (!open) return null;

  const handleClose = () => {
    onOpenChange(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!user) return;
    let normalized: string;
    try {
      ({ username: normalized } = validateUsernameFormat(input));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid username.");
      return;
    }
    if (currentUsername && normalized === currentUsername) {
      handleClose();
      return;
    }
    setSaving(true);
    try {
      await changeUsername(user.uid, normalized);
      await refreshUsername();
      if (
        currentUsername &&
        typeof window !== "undefined" &&
        window.location.pathname === `/${currentUsername}`
      ) {
        router.replace(`/${normalized}`);
      }
      handleClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === USERNAME_TAKEN) {
        setError("That username is taken.");
      } else {
        setError("Could not update username. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="text-lg font-bold">{currentUsername ? "Edit username" : "Choose username"}</h2>
        <p className="mt-1 text-sm text-zinc-500">3–20 characters, lowercase, only a–z, 0–9, and _.</p>
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-black p-3 text-sm outline-none focus:border-zinc-500"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="username"
          />
          {error ? <div className="text-xs text-red-400">{error}</div> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
