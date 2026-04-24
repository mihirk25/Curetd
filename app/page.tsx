"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { db } from '../firebase'; 
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy, onSnapshot, setDoc } from "firebase/firestore";
import { useAuth } from "./auth-context";
import { UsernameSetup, useUsername } from "./username-setup";
import { CuratorSearchBar } from "./curator-search-bar";
import { SignInCuratorModal } from "./sign-in-curator-modal";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYouTubeIframeAPI(): Promise<any> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.YT?.Player) return Promise.resolve(window.YT);

  return new Promise((resolve) => {
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
  });
}

function ClipYouTubePlayer({
  videoId,
  startTime,
  endTime,
}: {
  videoId: string;
  startTime: number;
  endTime?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const YT = await loadYouTubeIframeAPI();
      if (cancelled || !YT?.Player || !wrapperRef.current) return;

      // Create a mount node outside of React's VDOM control.
      // The YT IFrame API replaces the element you pass in; we do that on an
      // imperatively-created child to avoid React removeChild mismatches.
      const mount = document.createElement('div');
      mount.style.width = '100%';
      mount.style.height = '100%';
      wrapperRef.current.appendChild(mount);
      mountRef.current = mount;

      playerRef.current = new YT.Player(mount, {
        videoId,
        playerVars: {
          autoplay: 1,
          start: startTime || 0,
          ...(endTime ? { end: endTime } : {}),
          rel: 0,
          iv_load_policy: 3,
        },
        events: {
          onReady: (e: any) => {
            try {
              e?.target?.seekTo(startTime || 0, true);
              e?.target?.playVideo?.();
            } catch {}
          },
          onStateChange: (event: any) => {
            try {
              // 0 = ENDED
              if (event?.data === 0) {
                event?.target?.seekTo(startTime || 0, true);
                event?.target?.pauseVideo?.();
              }
              // Also guard against replay-from-0 behavior
              if (event?.data === 1) {
                const t = event?.target?.getCurrentTime?.() ?? 0;
                if ((startTime || 0) > 0 && t < (startTime || 0) - 0.25) {
                  event?.target?.seekTo(startTime || 0, true);
                }
              }
            } catch {}
          },
        },
      });
    })();

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy?.();
      } catch {}
      playerRef.current = null;
      try {
        if (mountRef.current?.parentNode) {
          mountRef.current.parentNode.removeChild(mountRef.current);
        }
      } catch {}
      mountRef.current = null;
    };
  }, [videoId, startTime, endTime]);

  return <div ref={wrapperRef} className="absolute inset-0 w-full h-full" />;
}

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

const TOPICS = ["Economics", "Startups", "Stand-up", "Data", "Finance", "Tech", "Science", "Design", "History", "Fitness", "Philosophy", "Music", "Podcast", "Other"];

export default function CuratdMVP() {
  const { user, signIn, signOut: handleSignOut } = useAuth();
  const username = useUsername();
  const [url, setUrl] = useState('');
  const [startMin, setStartMin] = useState('');
  const [startSec, setStartSec] = useState('');
  const [endMin, setEndMin] = useState('');
  const [endSec, setEndSec] = useState('');
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [channel, setChannel] = useState('');
  const [topic, setTopic] = useState("Other");
  const [customTopicDraft, setCustomTopicDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchingInfo, setFetchingInfo] = useState(false);
  const [savedClips, setSavedClips] = useState<string[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [clips, setClips] = useState<any[]>([]);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const pendingAddClipAfterAuth = useRef(false);
  const hadAuthenticatedUser = useRef(false);
  const [playingClip, setPlayingClip] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState("All");

  useEffect(() => {
    const q = query(collection(db, "clips"), orderBy("createdAt", "desc"));
    const unsubscribeClips = onSnapshot(q, (snapshot) => {
      setClips(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => {
      unsubscribeClips();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setSavedClips([]);
      return;
    }
    const unsubscribeSaved = onSnapshot(collection(db, "savedClips"), (snapshot) => {
      setSavedClips(snapshot.docs.map((d) => d.id));
    });
    return () => {
      unsubscribeSaved();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (user) {
      hadAuthenticatedUser.current = true;
      if (!pendingAddClipAfterAuth.current) return;
      pendingAddClipAfterAuth.current = false;
      setShowAuthModal(false);
      setUrl("");
      setStartMin("");
      setStartSec("");
      setEndMin("");
      setEndSec("");
      setNote("");
      setTitle("");
      setChannel("");
      setTopic("Other");
      setEditingClipId(null);
      setShowForm(true);
      return;
    }
    if (hadAuthenticatedUser.current) {
      hadAuthenticatedUser.current = false;
      pendingAddClipAfterAuth.current = false;
      setShowAuthModal(false);
    }
  }, [user]);

  useEffect(() => {
    setPlayingClip(null);
  }, [selectedTopic]);

  const fetchVideoInfo = async (ytUrl: string) => {
    try {
      setFetchingInfo(true);
      const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(ytUrl)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.title) setTitle((prev) => (prev ? prev : data.title));
      if (data?.author_name) setChannel((prev) => (prev ? prev : data.author_name));
    } catch (e) {
      // silent: user can type manually
    } finally {
      setFetchingInfo(false);
    }
  };

  const resetForm = () => {
    setUrl("");
    setStartMin("");
    setStartSec("");
    setEndMin("");
    setEndSec("");
    setNote("");
    setTitle("");
    setChannel("");
    setTopic("Other");
    setCustomTopicDraft("");
    setEditingClipId(null);
    setShowForm(false);
  };

  const openNewClipForm = () => {
    setUrl("");
    setStartMin("");
    setStartSec("");
    setEndMin("");
    setEndSec("");
    setNote("");
    setTitle("");
    setChannel("");
    setTopic("Other");
    setCustomTopicDraft("");
    setEditingClipId(null);
    setShowForm(true);
  };

  const applyCustomTopic = () => {
    const v = customTopicDraft.trim();
    if (!v) return;
    setTopic(v);
    setCustomTopicDraft("");
  };

  const closeAuthModal = () => {
    pendingAddClipAfterAuth.current = false;
    setShowAuthModal(false);
  };

  const handleSave = async () => {
    if (!user) return alert("Please sign in to save clips");
    if (!url) return alert("Please paste a YouTube URL");
    if (!title) return alert("Please add a title");
    const totalStart = (parseInt(startMin) || 0) * 60 + (parseInt(startSec) || 0);
    const totalEnd = (parseInt(endMin) || 0) * 60 + (parseInt(endSec) || 0);
    const videoId = extractVideoId(url);

    setLoading(true);
    try {
      const clipData = {
        url, videoId, title, channel, topic,
        userId: user.uid,
        userDisplayName: user.displayName || "Anonymous",
        username: username ?? null,
        startTime: totalStart, endTime: totalEnd,
        displayStart: `${startMin || 0}:${(startSec || '00').toString().padStart(2, '0')}`,
        displayEnd: `${endMin || 0}:${(endSec || '00').toString().padStart(2, '0')}`,
        note,
      };
      if (editingClipId) {
        await updateDoc(doc(db, "clips", editingClipId), clipData);
      } else {
        await addDoc(collection(db, "clips"), { ...clipData, createdAt: serverTimestamp() });
      }
      resetForm();
    } catch (e) {
      alert("Error saving clip.");
    }
    setLoading(false);
  };

  const handleEdit = (clip: any) => {
    if (!user || user.uid !== clip.userId) return;
    setUrl(clip.url || '');
    setTitle(clip.title || '');
    setChannel(clip.channel || '');
    setTopic(clip.topic || "Other");
    setCustomTopicDraft("");
    setNote(clip.note || "");
    const sMin = Math.floor((clip.startTime || 0) / 60);
    const sSec = (clip.startTime || 0) % 60;
    const eMin = Math.floor((clip.endTime || 0) / 60);
    const eSec = (clip.endTime || 0) % 60;
    setStartMin(sMin.toString());
    setStartSec(sSec.toString());
    setEndMin(eMin.toString());
    setEndSec(eSec.toString());
    setEditingClipId(clip.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (clipId: string) => {
    if (!user) return;
    const clip = clips.find((c) => c.id === clipId);
    if (!clip || user.uid !== clip.userId) return;
    if (!confirm("Delete this clip?")) return;
    try {
      await deleteDoc(doc(db, "clips", clipId));
    } catch (e) {
      alert("Error deleting.");
    }
  };

  const usedTopics = useMemo(() => {
    if (!user?.uid) return [];
    const set = new Set<string>();
    for (const c of clips) {
      if (c?.userId !== user.uid) continue;
      const t = c?.topic;
      if (typeof t === "string" && t.trim()) set.add(t.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [clips, user?.uid]);

  const filtered = (() => {
    const bySaved = showSaved ? clips.filter((c) => savedClips.includes(c.id)) : clips;
    if (selectedTopic === "All") return bySaved;
    return bySaved.filter((c) => c.topic === selectedTopic);
  })();
  const previewId = extractVideoId(url);

  return (
    <div className="h-screen bg-black text-white font-sans flex flex-col">
      <UsernameSetup />
      <header className="shrink-0 h-14 border-b border-zinc-800 grid grid-cols-[minmax(0,auto)_1fr_minmax(0,auto)] items-center gap-4 px-4 bg-black">
        <Link href="/" className="text-sm font-bold tracking-tight text-white hover:text-zinc-200 transition-colors shrink-0">
          CURATD
        </Link>
        <div className="flex min-w-0 justify-center px-2">
          <CuratorSearchBar />
        </div>
        <div className="flex items-center gap-3 min-w-0 justify-self-end">
          {user ? (
            <>
              <Link
                href={username ? `/${username}` : "/"}
                className="flex items-center gap-2 min-w-0 rounded-xl px-2 py-1.5 hover:bg-zinc-900/80 transition-colors"
                title={user.displayName || "Your library"}
              >
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover border border-zinc-700 shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-black text-xs font-bold shrink-0">
                    {(user.displayName || "U").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="text-sm font-medium text-zinc-100 truncate max-w-[160px] sm:max-w-[220px]">
                  {user.displayName || "Account"}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="text-xs text-zinc-500 hover:text-red-400 px-2 py-1.5 rounded-lg hover:bg-zinc-900 transition-colors shrink-0"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void signIn()}
              className="text-sm font-semibold px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
      {/* Left icon sidebar */}
      <aside className="w-14 border-r border-zinc-800 flex flex-col items-center py-4 gap-3 shrink-0">
        <button
          type="button"
          onClick={() => {
            setShowSaved(false);
            setPlayingClip(null);
          }}
          className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center hover:bg-emerald-500/20 transition-colors"
          aria-label="CURATD Home"
          title="Home"
        >
          <div className="w-6 h-6 rounded-md bg-emerald-500 flex items-center justify-center">
            <span className="text-black text-[10px] leading-none">▶</span>
          </div>
        </button>

        <div className="flex-1 flex flex-col items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              setShowSaved(false);
              setPlayingClip(null);
            }}
            className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-colors ${
              !showSaved
                ? 'bg-zinc-900 border-zinc-700 text-white'
                : 'bg-black border-transparent text-zinc-500 hover:text-white hover:bg-zinc-900/60'
            }`}
            aria-label="Home"
            title="Home"
          >
            <span className="text-lg leading-none">⌂</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (user == null) {
                pendingAddClipAfterAuth.current = true;
                setShowAuthModal(true);
                return;
              }
              openNewClipForm();
            }}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-900/60 transition-colors"
            aria-label="Add clip"
            title="Add clip"
          >
            <span className="text-lg leading-none">＋</span>
          </button>
        </div>
      </aside>

      {/* Middle sidebar */}
      <aside className="w-[220px] border-r border-zinc-800 px-5 py-5 overflow-y-auto">
        <div className="space-y-8">
          {/* Your Topics */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Your Topics</h3>
            </div>
            <div className="flex gap-2 flex-wrap mt-3">
              <button
                type="button"
                onClick={() => setSelectedTopic("All")}
                className={`text-[11px] px-3 py-1 rounded-full transition-colors ${
                  selectedTopic === "All" ? "bg-white text-black" : "bg-zinc-900 text-zinc-400 border border-zinc-700"
                }`}
              >
                All
              </button>
              {usedTopics.length === 0 ? (
                <span className="text-xs text-zinc-500 self-center">No topics yet</span>
              ) : (
                usedTopics.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSelectedTopic(t)}
                    className={`text-[11px] px-3 py-1 rounded-full transition-colors ${
                      selectedTopic === t ? "bg-white text-black" : "bg-zinc-900 text-zinc-400 border border-zinc-700"
                    }`}
                  >
                    {t}
                  </button>
                ))
              )}
            </div>
          </section>

          {/* Saved Clips */}
          <section>
            <button
              type="button"
              onClick={() => {
                if (user == null) {
                  setShowAuthModal(true);
                  return;
                }
                setShowSaved(true);
              }}
              className={`w-full flex items-center justify-between rounded-xl border px-3 py-3 transition-colors ${
                showSaved
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'border-zinc-800 bg-zinc-900/20 hover:bg-zinc-900/40'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">🔖</span>
                <h3 className="text-sm font-semibold text-white">Saved Clips</h3>
                <span className="text-xs text-zinc-500">({savedClips.length})</span>
              </div>
              <span className="text-xs text-zinc-500">View</span>
            </button>
            {showSaved && (
              <button
                type="button"
                onClick={() => setShowSaved(false)}
                className="mt-2 text-xs text-zinc-500 hover:text-white transition-colors"
              >
                Show All
              </button>
            )}
          </section>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {/* Feed */}
          <div className="space-y-4 pb-20">
            {clips.length === 0 ? (
              <div className="text-center py-20">
                <div className="text-5xl mb-4 opacity-20">▶</div>
                <p className="text-zinc-500 text-lg font-medium">No clips yet</p>
                <p className="text-zinc-600 text-sm mt-1">Hit the + Add icon to start curating</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-zinc-500">No clips in {selectedTopic} yet</p>
              </div>
            ) : (
              filtered.map((clip, idx) => {
                const vid = clip.videoId || extractVideoId(clip.url);
                const isPlaying = playingClip === clip.id;
                const isSaved = savedClips.includes(clip.id);

                return (
                  <div
                    key={clip.id}
                    className={`group relative rounded-2xl border bg-zinc-900/30 transition-colors overflow-hidden ${
                      idx === 0
                        ? 'border-blue-500/40 hover:border-blue-500/60'
                        : 'border-zinc-800/70 hover:border-zinc-700'
                    }`}
                  >
                    {/* Video / Thumbnail (stacked, full width) */}
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
                          <ClipYouTubePlayer
                            videoId={vid}
                            startTime={clip.startTime || 0}
                            endTime={clip.endTime || undefined}
                          />
                        ) : (
                          <>
                            {vid ? (
                              <img
                                src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`}
                                alt={clip.title || 'Video thumbnail'}
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
                                    borderLeft: '18px solid white',
                                    borderTop: '12px solid transparent',
                                    borderBottom: '12px solid transparent',
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
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-lg font-semibold text-white leading-snug line-clamp-2">
                            {clip.title || 'Untitled clip'}
                          </div>
                          <div className="text-sm text-zinc-500 mt-1 truncate">
                            {clip.channel || 'Unknown channel'}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            {clip.topic ? (
                              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-200 border border-zinc-700/80">
                                {clip.topic}
                              </span>
                            ) : null}
                            <span className="text-xs text-zinc-500">
                              Curated by{" "}
                              {typeof clip.username === "string" && clip.username.trim() ? (
                                <Link
                                  href={`/${clip.username.trim().toLowerCase()}`}
                                  className="font-medium text-zinc-300 hover:text-emerald-400 hover:underline"
                                >
                                  @{clip.username.trim().toLowerCase()}
                                </Link>
                              ) : (
                                <span className="text-zinc-300 font-medium">
                                  {clip.userDisplayName || "Unknown curator"}
                                </span>
                              )}
                            </span>
                          </div>
                          {clip.note ? (
                            <div className="text-base text-zinc-100 font-medium italic border-l-2 border-emerald-500 pl-3 mt-2 line-clamp-3">
                              &ldquo;{clip.note}&rdquo;
                            </div>
                          ) : null}
                        </div>

                        {/* Hover actions */}
                        {user && clip.userId && user.uid === clip.userId ? (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => handleEdit(clip)}
                              className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-zinc-800 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(clip.id)}
                              className="text-[11px] text-zinc-400 hover:text-red-400 px-2.5 py-1 rounded-md hover:bg-zinc-800 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-zinc-800/70">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-[11px] font-mono font-semibold bg-emerald-500 text-white px-2.5 py-1 rounded-md">
                            {clip.endTime ? `${clip.displayStart} — ${clip.displayEnd}` : 'Full video'}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={async () => {
                              if (!user) {
                                setShowAuthModal(true);
                                return;
                              }
                              try {
                                if (isSaved) {
                                  await deleteDoc(doc(db, "savedClips", clip.id));
                                } else {
                                  await setDoc(doc(db, "savedClips", clip.id), { clipId: clip.id, savedAt: serverTimestamp() });
                                }
                              } catch (e) {
                                // silent
                              }
                            }}
                            className="text-xs px-3 py-1.5 rounded-full border border-zinc-700 text-zinc-300 hover:bg-zinc-800/60 transition-colors"
                          >
                            <span className={isSaved ? "text-emerald-500 font-semibold" : undefined}>
                              {isSaved ? "Saved ✓" : "Save"}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!vid) return;
                              window.open(`https://www.youtube.com/watch?v=${vid}&t=${clip.startTime || 0}s`, '_blank');
                            }}
                            className="text-xs font-semibold text-emerald-500 hover:text-emerald-400 transition-colors"
                          >
                            Watch clip ↗
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>

      <SignInCuratorModal open={showAuthModal} onClose={closeAuthModal} />

      {/* ── ADD/EDIT MODAL ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => resetForm()}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold">{editingClipId ? 'Edit Clip' : 'Add a Clip'}</h2>
                <p className="text-zinc-500 text-sm mt-0.5">
                  {editingClipId ? 'Update your clip details' : 'Paste a YouTube URL and highlight the best part'}
                </p>
              </div>
              <button onClick={resetForm} className="text-zinc-500 hover:text-white text-2xl leading-none transition-colors">×</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1.5 block">YouTube URL</label>
                <input
                  type="text" value={url} placeholder="https://youtube.com/watch?v=..."
                  className="w-full bg-black border border-zinc-700 p-3.5 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm"
                  onChange={(e) => {
                    const next = e.target.value;
                    setUrl(next);
                    const looksLikeYoutube = next.includes("youtube.com") || next.includes("youtu.be");
                    if (looksLikeYoutube && (!title.trim() || !channel.trim())) {
                      fetchVideoInfo(next);
                    }
                  }}
                />
                {fetchingInfo && (
                  <div className="text-xs text-zinc-500 mt-2">Fetching info...</div>
                )}
                {previewId && (
                  <img
                    src={`https://img.youtube.com/vi/${previewId}/mqdefault.jpg`}
                    className="w-full rounded-xl mt-3 border border-zinc-800"
                    alt="Preview"
                  />
                )}
              </div>

              <div>
                <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1.5 block">Video Title</label>
                <input
                  type="text" value={title} placeholder="e.g. Why developing nations fail at industrialization"
                  className="w-full bg-black border border-zinc-700 p-3.5 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1.5 block">Channel Name</label>
                <input
                  type="text" value={channel} placeholder="e.g. World Bank"
                  className="w-full bg-black border border-zinc-700 p-3.5 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm"
                  onChange={(e) => setChannel(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1.5 block">Start Time</label>
                  <div className="flex gap-2">
                    <input type="number" value={startMin} placeholder="Min" className="w-full bg-black border border-zinc-700 p-3 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm" onChange={(e) => setStartMin(e.target.value)} />
                    <input type="number" value={startSec} placeholder="Sec" className="w-full bg-black border border-zinc-700 p-3 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm" onChange={(e) => setStartSec(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1.5 block">End Time</label>
                  <div className="flex gap-2">
                    <input type="number" value={endMin} placeholder="Min" className="w-full bg-black border border-zinc-700 p-3 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm" onChange={(e) => setEndMin(e.target.value)} />
                    <input type="number" value={endSec} placeholder="Sec" className="w-full bg-black border border-zinc-700 p-3 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm" onChange={(e) => setEndSec(e.target.value)} />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1.5 block">Your Note</label>
                <textarea
                  value={note} placeholder="Why should someone watch this?"
                  className="w-full bg-black border border-zinc-700 p-3.5 rounded-xl h-20 outline-none resize-none focus:border-zinc-500 transition-colors text-sm"
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2 block">Topic</label>
                <div className="flex flex-wrap gap-2">
                  {TOPICS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTopic(t)}
                      className={`text-xs px-3.5 py-1.5 rounded-full transition-all ${
                        topic === t
                          ? "bg-white text-black font-semibold"
                          : "bg-zinc-800 text-zinc-500 hover:text-white border border-zinc-700/50"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                  {topic && !TOPICS.includes(topic) ? (
                    <button
                      type="button"
                      onClick={() => setTopic(topic)}
                      className="text-xs px-3.5 py-1.5 rounded-full bg-white font-semibold text-black"
                    >
                      {topic}
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={customTopicDraft}
                    onChange={(e) => setCustomTopicDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyCustomTopic();
                      }
                    }}
                    placeholder="Add new topic"
                    className="min-w-0 flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => applyCustomTopic()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-lg font-semibold text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-700 hover:text-white"
                    aria-label="Add new topic"
                    title="Add topic"
                  >
                    +
                  </button>
                </div>
              </div>

              <button
                onClick={handleSave}
                disabled={loading || !url || !title}
                className={`w-full font-bold py-4 rounded-xl transition-all text-sm mt-2 ${
                  url && title
                    ? 'bg-white text-black hover:bg-zinc-200'
                    : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                }`}
              >
                {loading ? "Saving..." : editingClipId ? "Save Changes" : "Save Clip"}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}