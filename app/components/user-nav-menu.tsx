"use client";

import Link from "next/link";
import React from "react";

export function UserNavMenu({
  open,
  onClose,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
}) {
  if (!open) return null;

  return (
    <div className="absolute right-0 top-[calc(100%+4px)] z-[80] w-56 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-lg">
      <Link
        href="/settings"
        onClick={onClose}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800/70"
      >
        <span className="text-zinc-400" aria-hidden>
          ⚙
        </span>
        Settings
      </Link>
      <button
        type="button"
        onClick={() => {
          onClose();
          onSignOut();
        }}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-300 hover:bg-zinc-800/70"
      >
        <span className="text-red-300/80" aria-hidden>
          ⏻
        </span>
        Sign out
      </button>
    </div>
  );
}
