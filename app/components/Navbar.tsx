"use client";

import Link from "next/link";
import React from "react";
import { CuratorSearchBar } from "../curator-search-bar";

export function Navbar(props: {
  user: any | null;
  unreadCount?: number;
  onSignIn?: () => void;
  hideAddClip?: boolean;
  onAddClip?: () => void;
}) {
  const { user, unreadCount = 0, onSignIn, hideAddClip, onAddClip } = props;

  return (
    <header className="shrink-0 h-14 border-b border-zinc-800 grid grid-cols-[minmax(0,auto)_1fr_minmax(0,auto)] items-center gap-4 px-4 bg-black">
      <Link href="/" className="text-sm font-bold tracking-tight text-white hover:text-zinc-200 transition-colors shrink-0">
        CURATD
      </Link>

      <div className="flex min-w-0 justify-center px-2">
        <CuratorSearchBar />
      </div>

      <div className="flex items-center gap-2 min-w-0 justify-self-end">
        <Link
          href="/messages"
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-zinc-200 hover:bg-zinc-900/80 transition-colors"
          title="Messages"
          aria-label="Messages"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4.5 6.5h15A2.5 2.5 0 0 1 22 9v9a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18V9a2.5 2.5 0 0 1 2.5-2.5Z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinejoin="round"
            />
            <path
              d="m4.8 9 6.2 5.1a2 2 0 0 0 2.6 0L19.8 9"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
          {user && unreadCount > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center border border-black">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Link>

        {!hideAddClip ? (
          <button
            type="button"
            onClick={() => onAddClip?.()}
            className="shrink-0 rounded-xl bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-black hover:bg-emerald-400 transition-colors"
            aria-label="Add clip"
          >
            + Add Clip
          </button>
        ) : null}

        {!user ? (
          <button
            type="button"
            onClick={() => onSignIn?.()}
            className="text-sm font-semibold px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors"
          >
            Sign In
          </button>
        ) : null}
      </div>
    </header>
  );
}

