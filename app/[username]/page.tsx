"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { updateProfile } from "firebase/auth";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  limit,
} from "firebase/firestore";
import { auth, db, storage } from "../../firebase";
import { useAuth } from "../auth-context";
import { UsernameSetup, useUsername } from "../username-setup";
import { EditUsernameModal } from "../edit-username-control";
import { CuratorSearchBar } from "../curator-search-bar";
import { SignInCuratorModal } from "../sign-in-curator-modal";
import { CuratorRequiredModal } from "../curator-required-modal";
import { useUnreadMessageCount } from "../messages/use-unread-count";
import { getConversationId } from "../messages/messaging";

function extractVideoId(url: string) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function formatDuration(start: number, end: number) {
  if (!end) return "";
  const diff = Math.max(0, end - start);
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatRelativeTime(createdAt: any) {
  const ms =
    typeof createdAt?.toMillis === "function"
      ? createdAt.toMillis()
      : typeof createdAt?.seconds === "number"
        ? createdAt.seconds * 1000
        : typeof createdAt === "number"
          ? createdAt
          : createdAt instanceof Date
            ? createdAt.getTime()
            : null;

  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < week) return `${Math.floor(diff / day)}d ago`;
  if (diff < month) return `${Math.floor(diff / week)}w ago`;
  if (diff < year) return `${Math.floor(diff / month)}mo ago`;

  try {
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

export default function PublicProfilePage() {
  const params = useParams<{ username?: string }>();
  const router = useRouter();
  const usernameParam = (params?.username || "").toString();
  const username = useMemo(() => decodeURIComponent(usernameParam).trim().toLowerCase(), [usernameParam]);

  const { user, signIn, signOut: handleSignOut } = useAuth();
  const myUsername = useUsername();
  const unreadCount = useUnreadMessageCount(user?.uid);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState<{ uid: string; username: string; photoURL: string | null } | null>(null);
  const [clips, setClips] = useState<any[]>([]);
  const [topicSearch, setTopicSearch] = useState("");
  const [playingClip, setPlayingClip] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalCopy, setAuthModalCopy] = useState<{ title: string; subtitle: string }>({
    title: "Sign in to follow curators",
    subtitle: "Follow curators to keep track of their clips (saves to your account).",
  });
  const [showCuratorRequiredModal, setShowCuratorRequiredModal] = useState(false);
  const [isCurator, setIsCurator] = useState<boolean | null>(null);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [editUsernameOpen, setEditUsernameOpen] = useState(false);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const navPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [navUploadingPhoto, setNavUploadingPhoto] = useState(false);
  const [navPhotoUrl, setNavPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setNotFound(false);
      setProfile(null);
      setClips([]);
      setPlayingClip(null);

      if (!username) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      try {
        const handleSnap = await getDoc(doc(db, "usernames", username.toLowerCase()));
        if (!handleSnap.exists()) {
          if (!cancelled) {
            setNotFound(true);
            setLoading(false);
          }
          return;
        }

        const uid = String((handleSnap.data() as any)?.uid || "");
        if (!uid) {
          if (!cancelled) {
            setNotFound(true);
            setLoading(false);
          }
          return;
        }

        const userSnap = await getDoc(doc(db, "users", uid));
        const userData = userSnap.exists() ? userSnap.data() : null;

        const clipsQ = query(collection(db, "clips"), where("userId", "==", uid), orderBy("createdAt", "desc"));
        const clipsSnap = await getDocs(clipsQ);

        if (cancelled) return;
        setProfile({
          uid,
          username,
          photoURL: (userData as any)?.photoURL || null,
        });
        setClips(clipsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      } catch (err) {
        console.error("Profile load error:", err);
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => {
    if (!user || !profile || user.uid === profile.uid) {
      setFollowing(false);
      return;
    }
    const followId = `${user.uid}_${profile.uid}`;
    const followRef = doc(db, "follows", followId);
    const unsub = onSnapshot(followRef, (snap) => {
      setFollowing(snap.exists());
    });
    return () => unsub();
  }, [user?.uid, profile?.uid]);

  const toggleFollow = useCallback(async () => {
    if (!profile) return;
    if (user == null) {
      setAuthModalCopy({
        title: "Sign in to follow curators",
        subtitle: "Follow curators to keep track of their clips (saves to your account).",
      });
      setShowAuthModal(true);
      return;
    }
    if (user.uid === profile.uid) return;
    const followId = `${user.uid}_${profile.uid}`;
    const followRef = doc(db, "follows", followId);
    setFollowBusy(true);
    try {
      if (following) {
        await deleteDoc(followRef);
      } else {
        await setDoc(followRef, {
          followerUid: user.uid,
          followingUid: profile.uid,
          createdAt: serverTimestamp(),
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setFollowBusy(false);
    }
  }, [user, profile, following]);

  const showFollowButton = profile != null && (!user || user.uid !== profile.uid);
  const isOwnProfile = profile != null && user?.uid === profile.uid;

  const filteredClips = useMemo(() => {
    const q = topicSearch.trim().toLowerCase();
    if (!q) return clips;
    return clips.filter((c) => {
      const t = c?.topic;
      if (typeof t !== "string") return false;
      return t.toLowerCase().includes(q);
    });
  }, [clips, topicSearch]);

  useEffect(() => {
    setPlayingClip(null);
  }, [topicSearch]);

  useEffect(() => {
    setTopicSearch("");
  }, [username]);

  useEffect(() => {
    setNavPhotoUrl(user?.photoURL ?? null);
  }, [user?.photoURL]);

  useEffect(() => {
    let cancelled = false;
    setIsCurator(null);
    if (!user) return;
    getDocs(query(collection(db, "clips"), where("userId", "==", user.uid), limit(1)))
      .then((snap) => {
        if (!cancelled) setIsCurator(!snap.empty);
      })
      .catch(() => {
        if (!cancelled) setIsCurator(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!navMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = navMenuRef.current;
      if (el && !el.contains(e.target as Node)) setNavMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [navMenuOpen]);

  const uploadNavPhoto = useCallback(
    async (file: File) => {
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(file.type)) {
        alert("Please choose a JPG, PNG, or WebP image.");
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        alert("Image must be under 2MB");
        return;
      }
      if (!user) return;

      setNavUploadingPhoto(true);
      try {
        const storageRef = ref(storage, `profilePhotos/${user.uid}`);
        await uploadBytes(storageRef, file, { contentType: file.type });
        const url = await getDownloadURL(storageRef);
        await updateDoc(doc(db, "users", user.uid), { photoURL: url });
        if (auth.currentUser) {
          await updateProfile(auth.currentUser, { photoURL: url });
        }
        setNavPhotoUrl(url);
        setNavMenuOpen(false);
      } catch (e) {
        console.error(e);
        alert("Could not upload photo. Please try again.");
      } finally {
        setNavUploadingPhoto(false);
      }
    },
    [user],
  );

  const handleAvatarFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !user || !profile || user.uid !== profile.uid) return;

      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(file.type)) {
        alert("Please choose a JPG, PNG, or WebP image.");
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        alert("Image must be under 2MB");
        return;
      }

      setAvatarUploading(true);
      try {
        const storageRef = ref(storage, `profilePhotos/${user.uid}`);
        await uploadBytes(storageRef, file, { contentType: file.type });
        const url = await getDownloadURL(storageRef);
        await updateDoc(doc(db, "users", user.uid), { photoURL: url });
        if (auth.currentUser) {
          await updateProfile(auth.currentUser, { photoURL: url });
        }
        setProfile((prev) => (prev ? { ...prev, photoURL: url } : null));
      } catch (err) {
        console.error(err);
        alert("Could not upload photo. Please try again.");
      } finally {
        setAvatarUploading(false);
      }
    },
    [user, profile],
  );

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col">
      <UsernameSetup />
      {user ? (
        <EditUsernameModal
          open={editUsernameOpen}
          onOpenChange={setEditUsernameOpen}
          currentUsername={myUsername ?? ""}
        />
      ) : null}
      <header className="shrink-0 h-14 border-b border-zinc-800 grid grid-cols-[minmax(0,auto)_1fr_minmax(0,auto)] items-center gap-4 px-4 bg-black">
        <Link href="/" className="text-sm font-bold tracking-tight text-white hover:text-zinc-200 transition-colors shrink-0">
          CURATD
        </Link>
        <div className="flex min-w-0 justify-center px-2">
          <CuratorSearchBar />
        </div>
        <div className="flex items-center gap-2 min-w-0 justify-self-end" ref={navMenuRef}>
          {user ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (isCurator === false) {
                    setShowCuratorRequiredModal(true);
                    return;
                  }
                  router.push("/messages");
                }}
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
                {unreadCount > 0 ? (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center border border-black">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </button>
              <input
                ref={navPhotoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadNavPhoto(f);
                }}
              />
              <button
                type="button"
                onClick={() => setNavMenuOpen((v) => !v)}
                className="flex items-center gap-2 min-w-0 rounded-xl px-2 py-1.5 hover:bg-zinc-900/80 transition-colors"
                title={myUsername ? `@${myUsername}` : "Setting up..."}
              >
                {navPhotoUrl ? (
                  <img
                    src={navPhotoUrl}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover border border-zinc-700 shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-black text-xs font-bold shrink-0">
                    {(myUsername || "U").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="text-sm font-medium text-zinc-100 truncate max-w-[160px] sm:max-w-[220px]">
                  {myUsername ? `@${myUsername}` : "Setting up..."}
                </span>
              </button>

              {navMenuOpen ? (
                <div className="absolute right-4 top-14 z-[80] w-56 rounded-lg border border-zinc-700 bg-zinc-900 shadow-lg p-1">
                  <Link
                    href={myUsername ? `/${myUsername}` : "/"}
                    onClick={() => setNavMenuOpen(false)}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800/70"
                  >
                    <span className="text-zinc-400" aria-hidden>👤</span>
                    My Profile
                  </Link>
                  <button
                    type="button"
                    disabled={navUploadingPhoto}
                    onClick={() => navPhotoInputRef.current?.click()}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800/70 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="text-zinc-400" aria-hidden>📷</span>
                    {navUploadingPhoto ? "Uploading..." : "Change Photo"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditUsernameOpen(true);
                      setNavMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800/70"
                  >
                    <span className="text-zinc-400" aria-hidden>@</span>
                    Edit username
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-300 hover:bg-zinc-800/70"
                  >
                    <span className="text-red-300/80" aria-hidden>⏻</span>
                    Sign out
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
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
              </button>
              <button
                type="button"
                onClick={() => void signIn()}
                className="text-sm font-semibold px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors"
              >
                Sign In
              </button>
            </>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto w-full flex-1 px-6 py-10">
        {loading ? (
          <div className="text-zinc-500 text-sm">Loading…</div>
        ) : notFound || !profile ? (
          <div className="border border-zinc-800 rounded-2xl bg-zinc-900/20 p-8 text-center">
            <div className="text-lg font-semibold">User not found</div>
            <div className="text-sm text-zinc-500 mt-1">
              No profile exists for <span className="text-emerald-500 font-semibold">@{usernameParam}</span>.
            </div>
            <Link
              href="/"
              className="mt-6 inline-block text-sm font-semibold text-emerald-500 hover:text-emerald-400 transition-colors"
            >
              ← Back to feed
            </Link>
          </div>
        ) : (
          <>
            <div className="border border-zinc-800 rounded-3xl bg-zinc-900/20 p-6">
              <div className="flex items-start gap-4">
                {isOwnProfile ? (
                  <div className="relative h-14 w-14 shrink-0 group">
                    <input
                      ref={avatarFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                      className="hidden"
                      onChange={(ev) => void handleAvatarFileSelected(ev)}
                    />
                    {profile.photoURL ? (
                      <img
                        src={profile.photoURL}
                        alt=""
                        className="pointer-events-none h-14 w-14 rounded-full border border-zinc-800 object-cover"
                      />
                    ) : (
                      <div className="pointer-events-none flex h-14 w-14 items-center justify-center rounded-full border border-zinc-800 bg-emerald-500 text-xl font-bold text-black">
                        {(profile.username || "A").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={avatarUploading}
                      onClick={() => avatarFileInputRef.current?.click()}
                      className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/0 transition-colors hover:bg-black/55 group-hover:bg-black/55 disabled:cursor-not-allowed disabled:opacity-100"
                      aria-label="Change profile photo"
                      title="Change profile photo"
                    >
                      {!avatarUploading ? (
                        <span className="rounded-full bg-black/50 p-2 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="text-white">
                            <path
                              d="M4 7h3l1.5-2h7L17 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              strokeLinejoin="round"
                            />
                            <circle cx="12" cy="13" r="3.25" stroke="currentColor" strokeWidth="1.75" />
                          </svg>
                        </span>
                      ) : null}
                    </button>
                    {avatarUploading ? (
                      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-full bg-black/70">
                        <div
                          className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-500 border-t-emerald-400"
                          role="status"
                          aria-label="Uploading"
                        />
                      </div>
                    ) : null}
                  </div>
                ) : profile.photoURL ? (
                  <img
                    src={profile.photoURL}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-full border border-zinc-800 object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xl font-bold text-black">
                    {(profile.username || "A").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-2xl font-bold leading-tight truncate">@{profile.username}</div>
                      <div className="text-sm text-zinc-500 mt-1">
                        <span>
                          <span className="text-white font-semibold">{clips.length}</span>{" "}
                          <span className="text-zinc-500">clips</span>
                        </span>
                      </div>
                    </div>
                    {showFollowButton ? (
                      <div className="shrink-0 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={followBusy}
                          onClick={() => void toggleFollow()}
                          className={`text-sm font-semibold px-4 py-2 rounded-full border transition-colors ${
                            following
                              ? "border-zinc-600 text-zinc-300 hover:bg-zinc-800/60"
                              : "border-emerald-500 text-emerald-500 hover:bg-emerald-500/10"
                          } ${followBusy ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          {following ? "Following" : "Follow"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!profile) return;
                            if (!user) {
                              setAuthModalCopy({
                                title: "Sign in to message curators",
                                subtitle: "Messaging is private between two curators.",
                              });
                              setShowAuthModal(true);
                              return;
                            }
                            if (isCurator === false) {
                              setShowCuratorRequiredModal(true);
                              return;
                            }
                            const convId = getConversationId(user.uid, profile.uid);
                            void (async () => {
                              try {
                                await setDoc(
                                  doc(db, "conversations", convId),
                                  {
                                    participants: [user.uid, profile.uid],
                                    unreadBy: { [user.uid]: 0, [profile.uid]: 0 },
                                    lastMessage: "",
                                    lastMessageAt: serverTimestamp(),
                                  },
                                  { merge: true },
                                );
                              } catch {}
                              router.push(`/messages?c=${encodeURIComponent(convId)}`);
                            })();
                          }}
                          className="text-sm font-semibold px-4 py-2 rounded-full border border-zinc-700 text-zinc-200 hover:bg-zinc-800/60 transition-colors"
                        >
                          Message
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {clips.length > 0 ? (
              <section className="mt-6 border-b border-zinc-800/80 pb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
                  <button
                    type="button"
                    onClick={() => setTopicSearch("")}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      !topicSearch.trim()
                        ? "border-white bg-white font-semibold text-black"
                        : "border-zinc-700 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                    }`}
                  >
                    All
                  </button>
                  <div className="relative min-w-0 flex-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden>
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
                      value={topicSearch}
                      onChange={(e) => setTopicSearch(e.target.value)}
                      placeholder="Search topics..."
                      autoComplete="off"
                      className="w-full rounded-full border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
                    />
                  </div>
                </div>
              </section>
            ) : null}

            <div className={`space-y-4 pb-16 ${clips.length > 0 ? "mt-4" : "mt-6"}`}>
              {clips.length === 0 ? (
                <div className="text-center py-16 border border-zinc-800 rounded-2xl bg-zinc-900/20">
                  <div className="text-zinc-500 text-sm">No clips yet</div>
                </div>
              ) : filteredClips.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/20 py-20 px-6 text-center">
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="text-zinc-600"
                    aria-hidden
                  >
                    <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M2 10h4l2-2h12v9H2V10Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <circle cx="9" cy="13" r="2" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  <p className="text-sm text-zinc-400">
                    No clips match &ldquo;{topicSearch.trim()}&rdquo;
                  </p>
                </div>
              ) : (
                filteredClips.map((clip, idx) => {
                  const moments = Array.isArray(clip?.moments) ? clip.moments : null;
                  const primary = moments && moments.length > 0 ? moments[0] : null;
                  const clipUrl = clip.videoUrl || clip.url;
                  const vid = clip.videoId || extractVideoId(clipUrl);
                  const isPlaying = playingClip === clip.id;
                  const embedUrl = vid
                    ? `https://www.youtube.com/embed/${vid}?start=${primary?.startTime ?? clip.startTime ?? 0}${(primary?.endTime ?? clip.endTime) ? `&end=${primary?.endTime ?? clip.endTime}` : ""}&autoplay=1&rel=0&iv_load_policy=3`
                    : "";

                  return (
                    <div
                      key={clip.id}
                      className={`group relative rounded-2xl border bg-zinc-900/30 transition-colors overflow-hidden ${
                        idx === 0
                          ? "border-blue-500/40 hover:border-blue-500/60"
                          : "border-zinc-800/70 hover:border-zinc-700"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!vid) return;
                          setPlayingClip((prev) => (prev === clip.id ? null : clip.id));
                        }}
                        className="block w-full text-left"
                        aria-label={isPlaying ? "Stop clip" : "Play clip"}
                      >
                        <div className="relative aspect-video w-full bg-zinc-950 border-b border-zinc-800 rounded-t-2xl overflow-hidden">
                          {isPlaying && vid ? (
                            <iframe
                              width="100%"
                              height="100%"
                              src={embedUrl}
                              title={clip.title || "Clip"}
                              frameBorder="0"
                              allowFullScreen
                              className="absolute inset-0 w-full h-full"
                            />
                          ) : (
                            <>
                              {vid ? (
                                <img
                                  src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`}
                                  alt={clip.title || "Video thumbnail"}
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                              ) : null}
                              <div className="absolute inset-0 bg-black/10 group-hover:bg-black/30 transition-colors" />
                              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="w-16 h-16 rounded-full bg-black/40 border border-white/25 backdrop-blur-sm flex items-center justify-center">
                                  <div
                                    className="ml-1"
                                    style={{
                                      width: 0,
                                      height: 0,
                                      borderLeft: "18px solid white",
                                      borderTop: "12px solid transparent",
                                      borderBottom: "12px solid transparent",
                                    }}
                                  />
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </button>

                      <div className="p-5">
                        <div className="min-w-0">
                          <div className="text-lg font-semibold text-white leading-snug line-clamp-2">
                            {clip.title || "Untitled clip"}
                          </div>
                          <div className="text-sm text-zinc-500 mt-1 truncate">{clip.channelName || clip.channel || "Unknown channel"}</div>
                          {clip.note ? (
                            <div className="text-base text-zinc-100 font-medium italic border-l-2 border-emerald-500 pl-3 mt-2 line-clamp-3">
                              &ldquo;{clip.note}&rdquo;
                            </div>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-zinc-800/70">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-[11px] font-mono font-semibold bg-emerald-500 text-white px-2.5 py-1 rounded-md">
                              {(primary?.endTime ?? clip.endTime)
                                ? `${Math.floor(((primary?.startTime ?? clip.startTime) || 0) / 60)}:${String((((primary?.startTime ?? clip.startTime) || 0) % 60)).padStart(2, "0")} — ${Math.floor(((primary?.endTime ?? clip.endTime) || 0) / 60)}:${String((((primary?.endTime ?? clip.endTime) || 0) % 60)).padStart(2, "0")}`
                                : "Full video"}
                            </span>
                            {((primary?.endTime ?? clip.endTime) ?? 0) > 0 ? (
                              <span className="text-xs text-zinc-500">{formatDuration(primary?.startTime ?? clip.startTime, primary?.endTime ?? clip.endTime)}</span>
                            ) : null}
                            {clip.createdAt ? (
                              <span className="text-xs text-zinc-500">{formatRelativeTime(clip.createdAt)}</span>
                            ) : null}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              if (!vid) return;
                              window.open(
                                `https://www.youtube.com/watch?v=${vid}&t=${clip.startTime || 0}s`,
                                "_blank",
                              );
                            }}
                            className="text-xs font-semibold text-emerald-500 hover:text-emerald-400 transition-colors"
                          >
                            Watch clip ↗
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      <SignInCuratorModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        title={authModalCopy.title}
        subtitle={authModalCopy.subtitle}
      />
      <CuratorRequiredModal open={showCuratorRequiredModal} onClose={() => setShowCuratorRequiredModal(false)} />
    </div>
  );
}
