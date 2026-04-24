"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "../../firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";

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

export default function PublicProfilePage() {
  const params = useParams<{ username?: string }>();
  const usernameParam = (params?.username || "").toString();
  const username = useMemo(() => decodeURIComponent(usernameParam).trim().toLowerCase(), [usernameParam]);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState<any | null>(null);
  const [clips, setClips] = useState<any[]>([]);
  const [playingClip, setPlayingClip] = useState<string | null>(null);

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

        const clipsQ = query(
          collection(db, "clips"),
          where("userId", "==", uid),
          orderBy("createdAt", "desc"),
        );
        const clipsSnap = await getDocs(clipsQ);

        if (cancelled) return;
        setProfile({
          uid,
          username,
          displayName: (userData as any)?.displayName || "Anonymous",
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

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      <div className="max-w-3xl mx-auto px-6 py-10">
        {loading ? (
          <div className="text-zinc-500 text-sm">Loading…</div>
        ) : notFound || !profile ? (
          <div className="border border-zinc-800 rounded-2xl bg-zinc-900/20 p-8 text-center">
            <div className="text-lg font-semibold">User not found</div>
            <div className="text-sm text-zinc-500 mt-1">
              No profile exists for <span className="text-emerald-500 font-semibold">@{usernameParam}</span>.
            </div>
          </div>
        ) : (
          <>
            {/* Profile header */}
            <div className="border border-zinc-800 rounded-3xl bg-zinc-900/20 p-6">
              <div className="flex items-start gap-4">
                {profile.photoURL ? (
                  <img
                    src={profile.photoURL}
                    alt={profile.displayName}
                    className="w-14 h-14 rounded-full object-cover border border-zinc-800"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center text-black text-xl font-bold">
                    {(profile.displayName || "A").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-2xl font-bold leading-tight truncate">{profile.displayName}</div>
                  <div className="text-sm text-zinc-500 mt-1">
                    <span className="text-emerald-500 font-semibold">@{profile.username}</span>
                    <span className="mx-2 text-zinc-700">·</span>
                    <span>
                      <span className="text-white font-semibold">{clips.length}</span>{" "}
                      <span className="text-zinc-500">clips</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Clips */}
            <div className="mt-6 space-y-4 pb-16">
              {clips.length === 0 ? (
                <div className="text-center py-16 border border-zinc-800 rounded-2xl bg-zinc-900/20">
                  <div className="text-zinc-500 text-sm">No clips yet</div>
                </div>
              ) : (
                clips.map((clip, idx) => {
                  const vid = clip.videoId || extractVideoId(clip.url);
                  const isPlaying = playingClip === clip.id;
                  const embedUrl = vid
                    ? `https://www.youtube.com/embed/${vid}?start=${clip.startTime || 0}${clip.endTime ? `&end=${clip.endTime}` : ""}&autoplay=1&rel=0&iv_load_policy=3`
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
                      {/* Video / Thumbnail */}
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

                      {/* Text content */}
                      <div className="p-5">
                        <div className="min-w-0">
                          <div className="text-lg font-semibold text-white leading-snug line-clamp-2">
                            {clip.title || "Untitled clip"}
                          </div>
                          <div className="text-sm text-zinc-500 mt-1 truncate">
                            {clip.channel || "Unknown channel"}
                          </div>
                          {clip.note ? (
                            <div className="text-base text-zinc-100 font-medium italic border-l-2 border-emerald-500 pl-3 mt-2 line-clamp-3">
                              &ldquo;{clip.note}&rdquo;
                            </div>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-zinc-800/70">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-[11px] font-mono font-semibold bg-emerald-500 text-white px-2.5 py-1 rounded-md">
                              {clip.endTime ? `${clip.displayStart} — ${clip.displayEnd}` : "Full video"}
                            </span>
                            <span className="text-xs text-zinc-500">
                              {Math.max(1, 7 + (idx % 9))} users clipped
                              {clip.endTime > 0 ? (
                                <span className="ml-2 text-zinc-600">
                                  · {formatDuration(clip.startTime, clip.endTime)}
                                </span>
                              ) : null}
                            </span>
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
    </div>
  );
}

