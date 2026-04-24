"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";

export type CuratorSearchHit = {
  id: string;
  username?: string;
  displayName?: string | null;
  photoURL?: string | null;
};

export function CuratorSearchBar() {
  const [searchText, setSearchText] = useState("");
  const [debouncedPrefix, setDebouncedPrefix] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<CuratorSearchHit[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedPrefix(searchText.trim().toLowerCase());
    }, 200);
    return () => window.clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    if (!debouncedPrefix) {
      setHits([]);
      return;
    }
    const q = query(
      collection(db, "users"),
      where("displayNameLower", ">=", debouncedPrefix),
      where("displayNameLower", "<=", `${debouncedPrefix}\uf8ff`),
      orderBy("displayNameLower"),
      limit(20),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: CuratorSearchHit[] = snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              username: typeof data.username === "string" ? data.username : undefined,
              displayName: (data.displayName as string | null | undefined) ?? null,
              photoURL: (data.photoURL as string | null | undefined) ?? null,
            };
          })
          .filter((row) => row.username);
        setHits(rows);
      },
      () => setHits([]),
    );
    return () => unsub();
  }, [debouncedPrefix]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = wrapRef.current;
      if (el && !el.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const showDropdown = open && searchText.trim().length > 0;
  const trimmedLower = searchText.trim().toLowerCase();
  const pendingSync = trimmedLower !== debouncedPrefix;

  return (
    <div ref={wrapRef} className="relative w-[300px] max-w-full">
      <div className="flex h-9 w-full items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3">
        <span className="text-zinc-500 shrink-0" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="opacity-80">
            <path
              d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search curators..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
        />
      </div>
      {showDropdown ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[60] max-h-64 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 py-1 shadow-xl">
          {pendingSync ? (
            <div className="px-3 py-3 text-center text-sm text-zinc-600">…</div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-3 text-center text-sm text-zinc-500">No curators found</div>
          ) : (
            hits.map((h) => (
              <Link
                key={h.id}
                href={`/${h.username}`}
                onClick={() => {
                  setOpen(false);
                  setSearchText("");
                  setDebouncedPrefix("");
                }}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-900/90 transition-colors"
              >
                {h.photoURL ? (
                  <img
                    src={h.photoURL}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full border border-zinc-700 object-cover"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-300">
                    {(h.displayName || "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium text-zinc-100">{h.displayName || "Anonymous"}</div>
                  <div className="truncate text-xs text-zinc-500">@{h.username}</div>
                </div>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
