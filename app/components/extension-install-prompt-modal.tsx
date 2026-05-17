"use client";

import React from "react";
import { CHROME_EXTENSION_INSTALL_URL } from "../lib/extension";
import { useSupportsChromeExtension } from "../hooks/use-chromium-browser";

export function ExtensionInstallPromptModal({
  open,
  onSkip,
}: {
  open: boolean;
  onSkip: () => void;
}) {
  const supportsExtension = useSupportsChromeExtension();

  if (!open || !supportsExtension) return null;

  return (
    <div
      className="fixed inset-0 z-[208] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extension-prompt-title"
    >
      <div
        className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="extension-prompt-title" className="text-xl font-bold text-white">
          Want to add clips faster?
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          Install the Curatd Chrome extension to save moments directly from YouTube.
        </p>

        <a
          href={CHROME_EXTENSION_INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-4 text-sm font-bold text-black transition-colors hover:bg-emerald-400"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 8h3l1-4h8l1 4h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Install
        </a>

        <button
          type="button"
          onClick={onSkip}
          className="mt-4 w-full text-sm text-zinc-400 transition-colors hover:text-white"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
