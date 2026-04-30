"use client";

import React, { useMemo, useState } from "react";
import { RepostButton } from "./repost-button";

export function ShareActionsRow({
  clipId,
  originalCuratorId,
}: {
  clipId: string;
  originalCuratorId: string;
}) {
  const [copied, setCopied] = useState(false);
  const url = useMemo(() => `https://curatd.vercel.app/clip/${clipId}`, [clipId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="mt-2 flex items-center gap-1">
      <button
        type="button"
        onClick={() => void copy()}
        className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-zinc-800 transition-colors"
        aria-label="Share"
        title="Share"
      >
        <span className="inline-flex items-center gap-1">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M8.5 12.5 15 9M8.5 11.5 15 15M7 15.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM17 9.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM17 20.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
          {copied ? "Copied!" : "Share"}
        </span>
      </button>

      <div className="[&>button]:text-[11px] [&>button]:text-zinc-400 [&>button:hover]:text-white [&>button]:px-2.5 [&>button]:py-1 [&>button]:rounded-md [&>button:hover]:bg-zinc-800 [&>button]:transition-colors">
        <RepostButton clipId={clipId} originalCuratorId={originalCuratorId} />
      </div>
    </div>
  );
}

