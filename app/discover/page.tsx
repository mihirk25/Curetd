"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, getDoc, getDocs, limit, onSnapshot, orderBy, query, where, doc, startAfter } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../auth-context";
import { followUser, unfollowUser } from "../lib/firestore";

type CuratorCard = {
  uid: string;
  username: string;
  photoURL: string | null;
  profileTopics: string[];
  topics: string[];
};

function normalizeUsername(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

export default function DiscoverPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [curators, setCurators] = useState<CuratorCard[]>([]);
  const [followingUserIds, setFollowingUserIds] = useState<string[]>([]);
  const [busyByUid, setBusyByUid] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) {
      setFollowingUserIds([]);
      return;
    }
    const followsQ = query(collection(db, "follows"), where("followerId", "==", user.uid));
    const unsub = onSnapshot(
      followsQ,
      (snap) => {
        const ids = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return typeof data?.followingId === "string" ? data.followingId : null;
          })
          .filter(Boolean) as string[];
        setFollowingUserIds([...new Set(ids)]);
      },
      () => setFollowingUserIds([]),
    );
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const currentUid = user?.uid ?? null;
        // Gather curator userIds from clips (paged).
        const userIds = new Set<string>();
        const topicCountsByUid = new Map<string, Map<string, number>>();
        let last: any = null;
        for (let page = 0; page < 10; page++) {
          const base = query(collection(db, "clips"), orderBy("createdAt", "desc"), limit(1000));
          const q = last ? query(collection(db, "clips"), orderBy("createdAt", "desc"), startAfter(last), limit(1000)) : base;
          const snap = await getDocs(q as any);
          if (snap.empty) break;
          for (const d of snap.docs) {
            const data = d.data() as any;
            const uid = typeof data?.userId === "string" ? data.userId : null;
            if (uid && uid !== currentUid) userIds.add(uid);

             if (uid) {
               const moments = Array.isArray(data?.moments) ? (data.moments as any[]) : null;
               const primary = moments && moments.length > 0 ? moments[0] : null;
               const topicRaw =
                 (typeof primary?.topic === "string" && primary.topic) ||
                 (typeof data?.topic === "string" && data.topic) ||
                 "";
               const topic = typeof topicRaw === "string" ? topicRaw.trim() : "";
               if (topic) {
                 const map = topicCountsByUid.get(uid) ?? new Map<string, number>();
                 map.set(topic, (map.get(topic) ?? 0) + 1);
                 topicCountsByUid.set(uid, map);
               }
             }
          }
          last = snap.docs[snap.docs.length - 1];
          if (snap.docs.length < 1000) break;
        }

        // Fetch those user docs.
        const rows: CuratorCard[] = [];
        for (const uid of userIds) {
          if (currentUid && uid === currentUid) continue;
          try {
            const uSnap = await getDoc(doc(db, "users", uid));
            if (!uSnap.exists()) continue;
            const data = uSnap.data() as any;
            const username = normalizeUsername(data?.username);
            if (!username) continue;
            const profileTopics = Array.isArray(data?.profileTopics)
              ? data.profileTopics.filter((t: unknown) => typeof t === "string").slice(0, 8)
              : [];
            const clipTopicCounts = topicCountsByUid.get(uid) ?? new Map<string, number>();
            const clipTopics = [...clipTopicCounts.entries()]
              .filter(([t]) => typeof t === "string" && t.trim())
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
              .map(([t]) => t);
            const topics =
              profileTopics.length > 0
                ? profileTopics.filter((t: string) => clipTopicCounts.has(String(t)))
                : clipTopics;
            rows.push({
              uid,
              username,
              photoURL: typeof data?.photoURL === "string" ? data.photoURL : null,
              profileTopics,
              topics: topics.slice(0, 12),
            });
          } catch {}
        }

        rows.sort((a, b) => a.username.localeCompare(b.username));
        if (!cancelled) setCurators(rows);
      } catch {
        if (!cancelled) setCurators([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const followingSet = useMemo(() => new Set(followingUserIds), [followingUserIds]);

  const toggleFollow = async (uid: string) => {
    if (!user?.uid) {
      router.push("/");
      return;
    }
    const targetUid = String(uid || "");
    if (!targetUid) return;

    const currentlyFollowing = followingSet.has(targetUid);
    setBusyByUid((prev) => ({ ...prev, [targetUid]: true }));
    setFollowingUserIds((prev) =>
      currentlyFollowing ? prev.filter((id) => id !== targetUid) : [...prev, targetUid],
    );
    try {
      if (currentlyFollowing) await unfollowUser(user.uid, targetUid);
      else await followUser(user.uid, targetUid);
    } catch {
      setFollowingUserIds((prev) =>
        currentlyFollowing ? [...prev, targetUid] : prev.filter((id) => id !== targetUid),
      );
    } finally {
      setBusyByUid((prev) => ({ ...prev, [targetUid]: false }));
    }
  };

  return (
    <main className="min-h-screen bg-black font-sans text-white">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link href="/" className="text-sm font-bold tracking-tight text-white hover:text-zinc-200">
            CURATD
          </Link>
          <Link href="/" className="text-sm text-zinc-500 transition-colors hover:text-white">
            Back to feed
          </Link>
        </div>

        <h1 className="text-3xl font-bold">Discover curators</h1>
        <p className="mt-2 text-sm text-zinc-400">Follow people to see their clips in your Following tab.</p>

        {loading ? (
          <div className="mt-10 text-sm text-zinc-500">Loading…</div>
        ) : curators.length === 0 ? (
          <div className="mt-10 text-sm text-zinc-500">No curators found.</div>
        ) : (
          <div className="mt-8 grid gap-3">
            {curators.map((c) => {
              if (user?.uid && c.uid === user.uid) return null;
              const following = followingSet.has(c.uid);
              const busy = Boolean(busyByUid[c.uid]);
              return (
                <div
                  key={c.uid}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/${c.username}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/${c.username}`);
                    }
                  }}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 flex items-center gap-3 hover:bg-zinc-900/60 transition-colors"
                  aria-label={`Open @${c.username}`}
                >
                  {c.photoURL ? (
                    <img
                      src={c.photoURL}
                      alt=""
                      className="h-11 w-11 rounded-full object-cover border border-zinc-700"
                    />
                  ) : (
                    <div className="h-11 w-11 rounded-full bg-emerald-500 text-black font-bold flex items-center justify-center border border-emerald-400/30">
                      {(c.username || "U").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">@{c.username}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.topics.slice(0, 12).map((t) => (
                        <span
                          key={t}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/?topic=${encodeURIComponent(t)}&curator=${encodeURIComponent(c.username)}`);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              router.push(`/?topic=${encodeURIComponent(t)}&curator=${encodeURIComponent(c.username)}`);
                            }
                          }}
                          className="text-[11px] rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-700/60 transition-colors"
                          aria-label={`Filter feed by ${t}`}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleFollow(c.uid);
                    }}
                    className={`rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${
                      following
                        ? "border-zinc-600 bg-transparent text-zinc-200 hover:border-zinc-500 hover:text-white"
                        : "border-emerald-500 bg-emerald-500 text-black hover:bg-emerald-400"
                    } ${busy ? "opacity-60 cursor-not-allowed" : ""}`}
                    aria-label={following ? `Unfollow @${c.username}` : `Follow @${c.username}`}
                  >
                    {following ? "Following" : "Follow"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

