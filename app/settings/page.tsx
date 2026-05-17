"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth-context";
import { UsernameSetup, useUsername } from "../username-setup";
import { EditUsernameModal } from "../edit-username-control";
import { CuratorSearchBar } from "../curator-search-bar";
import { SignInCuratorModal } from "../sign-in-curator-modal";
import { useUnreadMessageCount } from "../messages/use-unread-count";
import { CHROME_EXTENSION_INSTALL_URL } from "../lib/extension";
import { useSupportsChromeExtension } from "../hooks/use-chromium-browser";
import { uploadProfilePhoto } from "../lib/profile-photo";

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

function SettingsRowButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-4 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-900/80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SettingsRowLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex w-full items-center gap-3 px-4 py-4 text-sm text-zinc-200 transition-colors hover:bg-zinc-900/80"
    >
      {children}
    </Link>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const username = useUsername();
  const unreadCount = useUnreadMessageCount(user?.uid);
  const supportsExtension = useSupportsChromeExtension();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [editUsernameOpen, setEditUsernameOpen] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!user) setShowAuthModal(true);
  }, [user]);

  const handlePhotoSelected = useCallback(
    async (file: File) => {
      if (!user) return;
      setUploadingPhoto(true);
      try {
        await uploadProfilePhoto(user.uid, file);
      } catch (e) {
        const code = e instanceof Error ? e.message : "";
        if (code === "INVALID_TYPE") {
          alert("Please choose a JPG, PNG, or WebP image.");
        } else if (code === "TOO_LARGE") {
          alert("Image must be under 2MB");
        } else {
          console.error(e);
          alert("Could not upload photo. Please try again.");
        }
      } finally {
        setUploadingPhoto(false);
      }
    },
    [user],
  );

  const profileHref = username ? `/${username}` : "/";

  return (
    <div className="flex min-h-screen flex-col bg-black font-sans text-white">
      <UsernameSetup />
      {user ? (
        <EditUsernameModal
          open={editUsernameOpen}
          onOpenChange={setEditUsernameOpen}
          currentUsername={username ?? ""}
        />
      ) : null}

      <header className="grid h-14 shrink-0 grid-cols-[minmax(0,auto)_1fr_minmax(0,auto)] items-center gap-4 border-b border-zinc-800 bg-black px-4">
        <Link href="/" className="shrink-0 text-sm font-bold tracking-tight text-white hover:text-zinc-200">
          CURATD
        </Link>
        <div className="flex min-w-0 justify-center px-2">
          <CuratorSearchBar />
        </div>
        <div className="flex min-w-0 items-center justify-self-end gap-2">
          <Link
            href="/messages"
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-zinc-200 hover:bg-zinc-900/80"
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
              <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-black bg-red-500 px-1 text-[11px] font-bold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>

        {!user ? (
          <p className="mt-6 text-sm text-zinc-500">Sign in to manage your account.</p>
        ) : (
          <>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handlePhotoSelected(f);
              }}
            />

            <nav
              className="mt-8 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800"
              aria-label="Account settings"
            >
              <SettingsRowLink href={profileHref}>
                <span className="text-zinc-400" aria-hidden>
                  👤
                </span>
                My Profile
              </SettingsRowLink>

              <SettingsRowButton
                disabled={uploadingPhoto}
                onClick={() => photoInputRef.current?.click()}
              >
                <span className="text-zinc-400" aria-hidden>
                  📷
                </span>
                {uploadingPhoto ? "Uploading..." : "Change Photo"}
              </SettingsRowButton>

              <SettingsRowButton onClick={() => setEditUsernameOpen(true)}>
                <span className="text-zinc-400" aria-hidden>
                  @
                </span>
                Edit Username
              </SettingsRowButton>

              {supportsExtension ? (
                <a
                  href={CHROME_EXTENSION_INSTALL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-3 px-4 py-4 text-sm text-zinc-200 transition-colors hover:bg-zinc-900/80"
                >
                  <ExtensionIcon />
                  <span className="flex-1">Install Extension</span>
                  <span className="text-xs text-zinc-500" aria-hidden>
                    ↗
                  </span>
                </a>
              ) : null}
            </nav>

            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-4 text-sm font-semibold text-red-300 transition-colors hover:bg-zinc-900/80"
            >
              <span className="text-red-300/80" aria-hidden>
                ⏻
              </span>
              Sign out
            </button>
          </>
        )}
      </main>

      <SignInCuratorModal open={showAuthModal} onClose={() => router.push("/")} />
    </div>
  );
}
