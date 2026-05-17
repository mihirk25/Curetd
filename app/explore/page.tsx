"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../auth-context";
import { UsernameSetup } from "../username-setup";
import { CuratorSearchBar } from "../curator-search-bar";
import { SignInCuratorModal } from "../sign-in-curator-modal";
import { useUnreadMessageCount } from "../messages/use-unread-count";
import { followUser, getFollowerCount, unfollowUser } from "../lib/firestore";
import {
  extractVideoId,
  formatTimestamp,
  onYoutubeThumbnailError,
  toSeconds,
  youtubeThumbnailUrl,
} from "../lib/clip-playback";
import { ClipYoutubeModal } from "../components/clip-youtube-modal";

const EXPLORE_TOPICS = [
  "Philosophy",
  "Technology",
  "Business",
  "Science",
  "Comedy",
  "Politics",
  "Health & Fitness",
  "Psychology",
] as const;

type FeaturedCurator = {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string | null;
  followerCount: number;
};

function formatRelativeTime(createdAt: unknown) {
  const ms =
    typeof (createdAt as { toMillis?: () => number })?.toMillis === "function"
      ? (createdAt as { toMillis: () => number }).toMillis()
      : typeof (createdAt as { seconds?: number })?.seconds === "number"
        ? (createdAt as { seconds: number }).seconds * 1000
        : typeof createdAt === "number"
          ? createdAt
          : createdAt instanceof Date
            ? createdAt.getTime()
            : null;
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  try {
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/** Clips store topic on moments (and legacy `topic`); filter matches home feed behavior. */
function clipMatchesTopic(clip: Record<string, unknown>, topic: string): boolean {
  const needle = topic.trim().toLowerCase();
  if (!needle) return true;
  const ms = Array.isArray(clip.moments) ? clip.moments : null;
  const topics: string[] =
    ms && ms.length > 0
      ? (ms as { topic?: unknown }[])
          .map((m) => (typeof m?.topic === "string" ? m.topic : ""))
          .filter(Boolean)
      : [typeof clip.topic === "string" ? clip.topic : ""].filter(Boolean);
  return topics.some((t) => String(t).trim().toLowerCase() === needle);
}

export default function ExplorePage() {
  const router = useRouter();
  const { user, signIn } = useAuth();
  const unreadCount = useUnreadMessageCount(user?.uid);

  const [featuredCurators, setFeaturedCurators] = useState<FeaturedCurator[]>([]);
  const [curatorsLoading, setCuratorsLoading] = useState(true);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [clips, setClips] = useState<Array<{ id: string } & Record<string, unknown>>>([]);
  const [clipsLoading, setClipsLoading] = useState(true);
  const [followingByUid, setFollowingByUid] = useState<Record<string, boolean>>({});
  const [followBusyByUid, setFollowBusyByUid] = useState<Record<string, boolean>>({});
  const [selectedClip, setSelectedClip] = useState<Record<string, unknown> | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCuratorsLoading(true);
      try {
        let snap;
        try {
          snap = await getDocs(
            query(collection(db, "users"), orderBy("followerCount", "desc"), limit(10)),
          );
        } catch {
          snap = await getDocs(
            query(collection(db, "users"), orderBy("createdAt", "desc"), limit(10)),
          );
        }
        if (cancelled) return;
        const rows = await Promise.all(
          snap.docs.map(async (d) => {
            const data = d.data() as Record<string, unknown>;
            const username =
              typeof data.username === "string" && data.username.trim()
                ? data.username.trim().toLowerCase()
                : "";
            if (!username) return null;
            let followerCount =
              typeof data.followerCount === "number" ? data.followerCount : 0;
            if (!followerCount) {
              try {
                followerCount = await getFollowerCount(d.id);
              } catch {}
            }
            const displayName =
              typeof data.displayName === "string" && data.displayName.trim()
                ? data.displayName.trim()
                : username;
            return {
              uid: d.id,
              username,
              displayName,
              photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
              followerCount,
            } satisfies FeaturedCurator;
          }),
        );
        const valid = rows.filter(Boolean) as FeaturedCurator[];
        valid.sort((a, b) => b.followerCount - a.followerCount || a.username.localeCompare(b.username));
        setFeaturedCurators(valid.slice(0, 10));
      } catch {
        if (!cancelled) setFeaturedCurators([]);
      } finally {
        if (!cancelled) setCuratorsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setFollowingByUid({});
      return;
    }
    const followsQ = query(collection(db, "follows"), where("followerId", "==", user.uid));
    const unsub = onSnapshot(
      followsQ,
      (snap) => {
        const next: Record<string, boolean> = {};
        for (const d of snap.docs) {
          const followingId = (d.data() as { followingId?: string })?.followingId;
          if (followingId) next[followingId] = true;
        }
        setFollowingByUid(next);
      },
      () => setFollowingByUid({}),
    );
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setClipsLoading(true);
      try {
        const fetchLimit = selectedTopic ? 60 : 20;
        const snap = await getDocs(
          query(collection(db, "clips"), orderBy("createdAt", "desc"), limit(fetchLimit)),
        );
        if (cancelled) return;
        let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<
          { id: string } & Record<string, unknown>
        >;
        if (selectedTopic) {
          rows = rows.filter((c) => clipMatchesTopic(c, selectedTopic)).slice(0, 20);
        }
        setClips(rows);
      } catch (e) {
        console.error(e);
        if (!cancelled) setClips([]);
      } finally {
        if (!cancelled) setClipsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTopic]);

  const toggleFollow = useCallback(
    async (uid: string) => {
      if (!user?.uid) {
        setShowAuthModal(true);
        return;
      }
      if (uid === user.uid) return;
      if (followBusyByUid[uid]) return;
      const wasFollowing = followingByUid[uid];
      setFollowBusyByUid((prev) => ({ ...prev, [uid]: true }));
      setFollowingByUid((prev) => ({ ...prev, [uid]: !wasFollowing }));
      try {
        if (wasFollowing) await unfollowUser(user.uid, uid);
        else await followUser(user.uid, uid);
      } catch (e) {
        console.error(e);
        setFollowingByUid((prev) => ({ ...prev, [uid]: wasFollowing }));
      } finally {
        setFollowBusyByUid((prev) => ({ ...prev, [uid]: false }));
      }
    },
    [user?.uid, followingByUid, followBusyByUid],
  );

  const feedEmptyMessage = useMemo(() => {
    if (selectedTopic) return `No clips in ${selectedTopic} yet.`;
    return "No clips to explore yet.";
  }, [selectedTopic]);

  return (
    <div className="flex min-h-screen flex-col bg-black font-sans text-white">
      <UsernameSetup />
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
          {!user ? (
            <button
              type="button"
              onClick={() => void signIn()}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
            >
              Sign In
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 w-full flex-1">
        <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-zinc-800/60 px-3 pt-6 lg:flex">
          <span className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Menu</span>
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white"
          >
            🏠 Home
          </Link>
          <Link
            href="/explore"
            className="flex items-center gap-3 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
          >
            🔍 Explore
          </Link>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold text-white">Explore</h1>
          <p className="mt-1 text-sm text-zinc-500">Discover curators and clips across Curatd.</p>

          {/* Featured curators */}
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Featured curators</h2>
            {curatorsLoading ? (
              <div className="mt-4 text-sm text-zinc-500">Loading curators…</div>
            ) : featuredCurators.length === 0 ? (
              <div className="mt-4 text-sm text-zinc-500">No curators to feature yet.</div>
            ) : (
              <div className="-mx-1 mt-4 flex gap-3 overflow-x-auto pb-2 px-1 scrollbar-thin">
                {featuredCurators.map((c) => {
                  if (user?.uid && c.uid === user.uid) return null;
                  const following = Boolean(followingByUid[c.uid]);
                  const busy = Boolean(followBusyByUid[c.uid]);
                  return (
                    <div
                      key={c.uid}
                      className="flex w-[200px] shrink-0 flex-col rounded-xl border border-zinc-800/60 bg-zinc-950 p-4"
                    >
                      <button
                        type="button"
                        onClick={() => router.push(`/${c.username}`)}
                        className="flex flex-col items-center text-center"
                      >
                        {c.photoURL ? (
                          <img
                            src={c.photoURL}
                            alt=""
                            className="h-14 w-14 rounded-full border border-zinc-700 object-cover"
                          />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500 text-xl font-bold text-black">
                            {c.username.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="mt-2 line-clamp-1 text-sm font-semibold text-white">{c.displayName}</div>
                        <div className="mt-0.5 text-xs text-zinc-400">@{c.username}</div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {c.followerCount} follower{c.followerCount === 1 ? "" : "s"}
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleFollow(c.uid)}
                        className={`mt-3 w-full rounded-full border py-2 text-xs font-semibold transition-colors ${
                          following
                            ? "border-zinc-600 text-zinc-200 hover:border-zinc-500"
                            : "border-emerald-500 bg-emerald-500 text-black hover:bg-emerald-400"
                        } ${busy ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        {following ? "Following" : "Follow"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Browse by topic */}
          <section className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Browse by topic</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedTopic(null)}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  !selectedTopic
                    ? "border-white bg-white font-semibold text-black"
                    : "border-zinc-700 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                }`}
              >
                All
              </button>
              {EXPLORE_TOPICS.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => setSelectedTopic(topic)}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    selectedTopic === topic
                      ? "border-emerald-500/40 bg-emerald-500/15 font-semibold text-emerald-200"
                      : "border-zinc-700 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  {topic}
                </button>
              ))}
            </div>
          </section>

          {/* Explore feed */}
          <section className="mt-10 pb-16">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              {selectedTopic ? `${selectedTopic} clips` : "Recent clips"}
            </h2>
            {clipsLoading ? (
              <div className="mt-6 text-sm text-zinc-500">Loading clips…</div>
            ) : clips.length === 0 ? (
              <div className="mt-6 rounded-xl border border-zinc-800/60 bg-zinc-950/40 px-4 py-12 text-center text-sm text-zinc-500">
                {feedEmptyMessage}
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {clips.map((clip) => (
                  <ExploreClipCard
                    key={clip.id}
                    clip={clip}
                    onPlay={() => setSelectedClip(clip)}
                    onCuratorClick={(handle) => router.push(`/${handle}`)}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      <ClipYoutubeModal clip={selectedClip} onClose={() => setSelectedClip(null)} />
      <SignInCuratorModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        title="Sign in to follow curators"
        subtitle="Follow curators to personalize your feed."
      />
    </div>
  );
}

function ExploreClipCard({
  clip,
  onPlay,
  onCuratorClick,
}: {
  clip: { id: string } & Record<string, unknown>;
  onPlay: () => void;
  onCuratorClick: (username: string) => void;
}) {
  const moments = Array.isArray(clip.moments) ? clip.moments : null;
  const primary = moments && moments.length > 0 ? (moments[0] as Record<string, unknown>) : null;
  const clipUrl = clip.videoUrl || clip.url;
  const vid =
    (typeof clip.videoId === "string" ? clip.videoId : null) ||
    extractVideoId(typeof clipUrl === "string" ? clipUrl : "");
  const startSec = Math.max(0, Math.floor(toSeconds(String(primary?.startTime ?? clip.startTime ?? 0))));
  const endParsed = Math.max(0, Math.floor(toSeconds(String(primary?.endTime ?? clip.endTime ?? 0))));
  const hasEnd = endParsed > startSec && endParsed > 0;
  const timeRangeLabel = hasEnd
    ? `${formatTimestamp(startSec)} – ${formatTimestamp(endParsed)}`
    : vid
      ? formatTimestamp(startSec)
      : "";
  const handle =
    typeof clip.username === "string" && clip.username.trim()
      ? clip.username.trim().toLowerCase()
      : null;
  const topic =
    (typeof primary?.topic === "string" && primary.topic) ||
    (typeof clip.topic === "string" ? clip.topic : "");

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-950 transition-colors hover:border-zinc-700">
      <button
        type="button"
        onClick={onPlay}
        disabled={!vid}
        className="relative aspect-video w-full overflow-hidden rounded-t-xl bg-zinc-900 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:pointer-events-none disabled:opacity-60"
        aria-label="Play clip"
      >
        {vid ? (
          <img
            src={youtubeThumbnailUrl(vid, "max")}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => onYoutubeThumbnailError(e, vid)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" className="text-zinc-600" aria-hidden>
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          </div>
        )}
        {timeRangeLabel ? (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/80 px-2 py-0.5 text-xs font-medium text-white">
            {timeRangeLabel}
          </span>
        ) : null}
      </button>
      <div className="flex min-w-0 flex-col gap-1 p-2">
        <div className="line-clamp-2 text-sm font-semibold text-zinc-100">{String(clip.title || "Untitled clip")}</div>
        <div className="truncate text-xs text-zinc-400">
          {String(clip.channelName || clip.channel || "Unknown channel")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {handle ? (
            <button
              type="button"
              onClick={() => onCuratorClick(handle)}
              className="text-xs text-zinc-500 hover:text-emerald-400 hover:underline"
            >
              @{handle}
            </button>
          ) : null}
          {clip.createdAt ? (
            <span className="text-xs text-zinc-500">{formatRelativeTime(clip.createdAt)}</span>
          ) : null}
        </div>
        {topic ? (
          <span className="mt-0.5 inline-block w-fit rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
            {topic}
          </span>
        ) : null}
      </div>
    </article>
  );
}
