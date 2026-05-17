"use client";

import Link from "next/link";
import React from "react";
import { CHROME_EXTENSION_INSTALL_URL } from "../lib/extension";
import { useSupportsChromeExtension } from "../hooks/use-chromium-browser";

function SettingsRow({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800/70 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function SettingsLinkRow({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-zinc-200 transition-colors hover:bg-zinc-800/70"
    >
      {children}
    </Link>
  );
}

function ExtensionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-zinc-400" aria-hidden>
      <path
        d="M4 8h3l1-4h8l1 4h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function SettingsModal({
  open,
  onClose,
  profileHref,
  uploadingPhoto,
  onChangePhoto,
  onEditUsername,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  profileHref: string;
  uploadingPhoto: boolean;
  onChangePhoto: () => void;
  onEditUsername: () => void;
  onSignOut: () => void;
}) {
  const supportsExtension = useSupportsChromeExtension();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 id="settings-modal-title" className="text-lg font-bold text-white">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-800 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <nav className="space-y-1">
          <SettingsLinkRow href={profileHref} onClick={onClose}>
            <span className="text-zinc-400" aria-hidden>
              👤
            </span>
            My Profile
          </SettingsLinkRow>

          <SettingsRow disabled={uploadingPhoto} onClick={onChangePhoto}>
            <span className="text-zinc-400" aria-hidden>
              📷
            </span>
            {uploadingPhoto ? "Uploading..." : "Change Photo"}
          </SettingsRow>

          <SettingsRow
            onClick={() => {
              onClose();
              onEditUsername();
            }}
          >
            <span className="text-zinc-400" aria-hidden>
              @
            </span>
            Edit username
          </SettingsRow>

          {supportsExtension ? (
            <a
              href={CHROME_EXTENSION_INSTALL_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-zinc-200 transition-colors hover:bg-zinc-800/70"
            >
              <ExtensionIcon />
              <span className="flex-1">Install Extension</span>
              <span className="text-xs text-zinc-500" aria-hidden>
                ↗
              </span>
            </a>
          ) : null}
        </nav>

        <div className="mt-6 border-t border-zinc-800 pt-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              onSignOut();
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-red-300 transition-colors hover:bg-zinc-800/70"
          >
            <span className="text-red-300/80" aria-hidden>
              ⏻
            </span>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
