"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../../../firebase";
import { useAuth } from "../../../auth-context";
import { UsernameSetup } from "../../../username-setup";
import { CuratorSearchBar } from "../../../curator-search-bar";
import { followUser, isFollowing, unfollowUser } from "../../../lib/firestore";
import { extractVideoId, formatTimestamp, toSeconds } from "../../../lib/clip-playback";
import { ClipYoutubeModal } from "../../../components/clip-youtube-modal";

function getPrimaryMoment(clip: Record<string, any>) {
  const m = Array.isArray(clip?.moments) && clip.moments.length > 0 ? clip.moments[0] : null;
  if (m) return m;
  return {
    startTime: clip?.startTime ?? 0,
    endTime: clip?.endTime ?? 0,
  };
}

export default function CollectionDetailPage() {
  const params = useParams<{ username?: string; slug?: string }>();
  const { user, signIn } = useAuth();

  const username = useMemo(
    () => decodeURIComponent((params?.username || "").toString()).trim().toLowerCase(),
    [params?.username],
  );
  const slug = useMemo(() => decodeURIComponent((params?.slug || "").toString()).trim(), [params?.slug]);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [collectionData, setCollectionData] = useState<Record<string, any> | null>(null);
  const [orderedClips, setOrderedClips] = useState<any[]>([]);
  const [followingOwner, setFollowingOwner] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [selectedClip, setSelectedClip] = useState<any | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const ownerUid = typeof collectionData?.userId === "string" ? collectionData.userId : "";
  const isOwner = Boolean(user?.uid && ownerUid && user.uid === ownerUid);
  const canView = isOwner || followingOwner;

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/${username}/collections/${encodeURIComponent(slug)}`
      : `https://curatd.live/${username}/collections/${encodeURIComponent(slug)}`;

  const loadClipsForCollection = useCallback(async (col: Record<string, any>) => {
    const ids: string[] = Array.isArray(col.clipIds) ? col.clipIds : [];
    const rows: any[] = [];
    for (const id of ids) {
      try {
        const snap = await getDoc(doc(db, "clips", id));
        if (snap.exists()) rows.push({ id: snap.id, ...snap.data() });
      } catch {}
    }
    setOrderedClips(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setNotFound(false);
      setCollectionData(null);
      setOrderedClips([]);
      if (!username || !slug) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      try {
        const q = query(
          collection(db, "collections"),
          where("username", "==", username),
          where("slug", "==", slug),
          limit(1),
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        if (snap.empty) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const docSnap = snap.docs[0];
        const data = { id: docSnap.id, ...docSnap.data() } as Record<string, any>;
        setCollectionData(data);
        await loadClipsForCollection(data);
        const oid = String(data.userId || "");
        if (user?.uid && oid && user.uid !== oid) {
          const f = await isFollowing(user.uid, oid);
          if (!cancelled) setFollowingOwner(f);
        } else {
          setFollowingOwner(false);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [username, slug, user?.uid, loadClipsForCollection]);

  useEffect(() => {
    if (!user?.uid || !ownerUid || user.uid === ownerUid) return;
    void isFollowing(user.uid, ownerUid)
      .then((v) => setFollowingOwner(v))
      .catch(() => setFollowingOwner(false));
  }, [user?.uid, ownerUid]);

  const toggleFollow = async () => {
    if (!user || !ownerUid) return;
    const next = !followingOwner;
    setFollowingOwner(next);
    setFollowBusy(true);
    try {
      if (next) await followUser(user.uid, ownerUid);
      else await unfollowUser(user.uid, ownerUid);
    } catch (e) {
      console.error(e);
      setFollowingOwner(!next);
    } finally {
      setFollowBusy(false);
    }
  };

  const moveClip = async (index: number, dir: -1 | 1) => {
    if (!collectionData || !isOwner || reorderBusy) return;
    const ids = [...(Array.isArray(collectionData.clipIds) ? collectionData.clipIds : [])];
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setReorderBusy(true);
    try {
      await updateDoc(doc(db, "collections", collectionData.id), {
        clipIds: ids,
        updatedAt: serverTimestamp(),
      });
      setCollectionData((prev) => (prev ? { ...prev, clipIds: ids } : prev));
      await loadClipsForCollection({ ...collectionData, clipIds: ids });
    } catch (e) {
      console.error(e);
      alert("Could not reorder.");
    } finally {
      setReorderBusy(false);
    }
  };

  const topic = typeof collectionData?.topic === "string" ? collectionData.topic.trim() : "";
  const clipCount = Array.isArray(collectionData?.clipIds) ? collectionData.clipIds.length : 0;

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      <UsernameSetup />
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-zinc-800 bg-black px-4">
        <Link href="/" className="shrink-0 text-sm font-bold tracking-tight text-white hover:text-zinc-200">
          CURATD
        </Link>
        <div className="flex min-w-0 flex-1 justify-center px-2">
          <CuratorSearchBar />
        </div>
        <div className="w-10 shrink-0" />
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {loading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : notFound || !collectionData ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/20 p-8 text-center">
            <div className="text-lg font-semibold">Collection not found</div>
            <Link href={username ? `/${username}` : "/"} className="mt-4 inline-block text-sm text-emerald-500 hover:underline">
              ← Back to profile
            </Link>
          </div>
        ) : !user ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
            <p className="text-zinc-200">Sign in to view this collection.</p>
            <button
              type="button"
              onClick={() => void signIn()}
              className="mt-4 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
            >
              Sign in
            </button>
          </div>
        ) : !canView ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
            <p className="text-zinc-200">
              Follow @{username} to view this collection.
            </p>
            <button
              type="button"
              disabled={followBusy}
              onClick={() => void toggleFollow()}
              className="mt-4 rounded-full border border-zinc-300 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {followBusy ? "…" : "Follow"}
            </button>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-white">{collectionData.title || "Untitled"}</h1>
              {typeof collectionData.description === "string" && collectionData.description.trim() ? (
                <p className="mt-2 text-zinc-400">{collectionData.description}</p>
              ) : null}
              {topic ? (
                <span className="mt-3 inline-block rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                  {topic}
                </span>
              ) : null}
              <p className="mt-3 text-sm text-zinc-500">
                {clipCount} clips · Curated by @{username}
              </p>
            </div>

            <ul className="space-y-3">
              {orderedClips.map((clip, idx) => {
                const primary = getPrimaryMoment(clip);
                const clipUrl = clip.videoUrl || clip.url;
                const vid = clip.videoId || extractVideoId(typeof clipUrl === "string" ? clipUrl : "");
                const startSec = Math.max(
                  0,
                  Math.floor(toSeconds(String(primary?.startTime ?? clip.startTime ?? 0))),
                );
                const endParsed = Math.max(
                  0,
                  Math.floor(toSeconds(String(primary?.endTime ?? clip.endTime ?? 0))),
                );
                const hasEnd = endParsed > startSec && endParsed > 0;
                const rangeLabel = hasEnd
                  ? `${formatTimestamp(startSec)} – ${formatTimestamp(endParsed)}`
                  : formatTimestamp(startSec);
                const thumb = vid ? `https://img.youtube.com/vi/${vid}/mqdefault.jpg` : "";
                const num = String(idx + 1).padStart(2, "0");
                return (
                  <li
                    key={clip.id}
                    className="flex items-center gap-3 rounded-xl border border-zinc-800/60 bg-zinc-950 px-3 py-2"
                  >
                    <span className="w-8 shrink-0 text-sm font-mono text-zinc-600">{num}</span>
                    {thumb ? (
                      <img src={thumb} alt="" className="h-16 w-28 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="h-16 w-28 shrink-0 rounded-lg bg-zinc-800" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-zinc-100">{clip.title || "Untitled"}</div>
                      <div className="truncate text-xs text-zinc-500">
                        {clip.channelName || clip.channel || "Unknown channel"}
                      </div>
                      <span className="mt-1 inline-block rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                        {rangeLabel}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {isOwner ? (
                        <div className="flex gap-0.5">
                          <button
                            type="button"
                            disabled={reorderBusy || idx === 0}
                            onClick={() => void moveClip(idx, -1)}
                            className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
                            aria-label="Move up"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            disabled={reorderBusy || idx >= orderedClips.length - 1}
                            onClick={() => void moveClip(idx, 1)}
                            className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
                            aria-label="Move down"
                          >
                            ▼
                          </button>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        disabled={!vid}
                        onClick={() => {
                          if (!vid) return;
                          setSelectedClip(clip);
                        }}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
                      >
                        Watch
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/20 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Share</div>
              <div className="mt-2 break-all font-mono text-sm text-zinc-300">{shareUrl}</div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    alert("Could not copy.");
                  }
                }}
                className="mt-3 rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
              >
                {copied ? "Copied!" : "Copy link"}
              </button>
            </div>
          </>
        )}
      </main>

      <ClipYoutubeModal clip={selectedClip} onClose={() => setSelectedClip(null)} />
    </div>
  );
}
