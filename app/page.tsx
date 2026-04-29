"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db, storage } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs, serverTimestamp, query, orderBy, onSnapshot, setDoc, where, limit, arrayUnion, Timestamp } from "firebase/firestore";
import { useAuth } from "./auth-context";
import { UsernameSetup } from "./username-setup";
import { EditUsernameModal } from "./edit-username-control";
import { CuratorSearchBar } from "./curator-search-bar";
import { SignInCuratorModal } from "./sign-in-curator-modal";
import { CuratorRequiredModal } from "./curator-required-modal";
import { updateProfile } from "firebase/auth";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useUnreadMessageCount } from "./messages/use-unread-count";
import { CURATD_TOPICS } from "./lib/topics";
import {
  followUser,
  getFollowerCount,
  isFollowing,
  unfollowUser,
} from "./lib/firestore";
import {
  adjustTopicUsage,
  ensureSeedTopics,
  normalizeTopicName,
  recordTopicUsage,
  subscribeToTopics,
  topicDocId,
  type TopicRecord,
} from "./lib/topic-directory";

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
    let timeGuardInterval: ReturnType<typeof setInterval> | null = null;
    const clearTimeGuard = () => {
      if (timeGuardInterval != null) {
        clearInterval(timeGuardInterval);
        timeGuardInterval = null;
      }
    };

    const startSeconds = Math.max(0, startTime || 0);
    const hasEnd = endTime != null && endTime > startSeconds;
    const endClipSeconds = hasEnd && endTime != null ? endTime : null;

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
          autoplay: 0,
          rel: 0,
          iv_load_policy: 3,
        },
        events: {
          onReady: (e: any) => {
            try {
              const p = e?.target;
              if (!p) return;
              if (hasEnd && endClipSeconds != null) {
                p.cueVideoById({
                  videoId,
                  startSeconds,
                  endSeconds: endClipSeconds,
                });
              } else {
                p.cueVideoById({ videoId, startSeconds });
              }
              p.playVideo?.();
            } catch {}
          },
          onStateChange: (event: any) => {
            try {
              if (event?.data === YT.PlayerState.PLAYING) {
                clearTimeGuard();
                const p = event?.target;
                if (!p) return;
                timeGuardInterval = setInterval(() => {
                  try {
                    const t = p.getCurrentTime?.() ?? 0;
                    if (t < startSeconds) {
                      p.seekTo?.(startSeconds, true);
                      return;
                    }
                    if (hasEnd && endClipSeconds != null && t >= endClipSeconds) {
                      p.pauseVideo?.();
                      p.seekTo?.(startSeconds, true);
                    }
                  } catch {}
                }, 250);
              } else {
                clearTimeGuard();
              }
            } catch {}
          },
        },
      });
    })();

    return () => {
      cancelled = true;
      clearTimeGuard();
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

function AudioOnlyYouTubePlayer({
  videoId,
  startSeconds,
  endSeconds,
  shouldPlay,
}: {
  videoId: string;
  startSeconds: number;
  endSeconds?: number;
  shouldPlay: boolean;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const [readyNonce, setReadyNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const YT = await loadYouTubeIframeAPI();
      if (cancelled || !YT?.Player || !mountRef.current || playerRef.current) return;

      playerRef.current = new YT.Player(mountRef.current, {
        videoId,
        playerVars: {
          autoplay: 0,
          start: startSeconds,
          rel: 0,
          iv_load_policy: 3,
        },
        events: {
          onReady: (e: any) => {
            playerRef.current = e?.target;
            setReadyNonce((v) => v + 1);
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
    };
  }, [videoId, startSeconds]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (shouldPlay) {
      player.seekTo?.(startSeconds, true);
      player.playVideo?.();
      return;
    }
    player.pauseVideo?.();
  }, [shouldPlay, startSeconds, readyNonce]);

  useEffect(() => {
    if (!shouldPlay || endSeconds == null || endSeconds <= startSeconds) return;
    const player = playerRef.current;
    if (!player) return;
    const id = setInterval(() => {
      try {
        const t = player.getCurrentTime?.() ?? 0;
        if (t >= endSeconds) {
          player.pauseVideo?.();
          player.seekTo?.(startSeconds, true);
        }
      } catch {}
    }, 250);
    return () => clearInterval(id);
  }, [shouldPlay, startSeconds, endSeconds, readyNonce]);

  return (
    <div
      ref={mountRef}
      className="absolute top-0 left-0 w-px h-px opacity-0 pointer-events-none"
      aria-hidden
    />
  );
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

export default function CuratdMVP() {
  const { user, signIn, signOut: handleSignOut } = useAuth();
  const router = useRouter();
  const username = user?.username ?? null;
  const [url, setUrl] = useState('');
  const [startMin, setStartMin] = useState('');
  const [startSec, setStartSec] = useState('');
  const [endMin, setEndMin] = useState('');
  const [endSec, setEndSec] = useState('');
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [channel, setChannel] = useState('');
  const [topic, setTopic] = useState("");
  const [audioOnly, setAudioOnly] = useState(false);
  const [topicOptions, setTopicOptions] = useState<TopicRecord[]>([]);
  const [topicDropdownOptions, setTopicDropdownOptions] = useState<TopicRecord[]>([]);
  const [topicInput, setTopicInput] = useState("");
  const [topicDropdownOpen, setTopicDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchingInfo, setFetchingInfo] = useState(false);
  const [savedClips, setSavedClips] = useState<string[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [clips, setClips] = useState<any[]>([]);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalCopy, setAuthModalCopy] = useState<{ title: string; subtitle: string }>({
    title: "Sign in to keep curating",
    subtitle: "Create your curator identity to save clips and follow people.",
  });
  const [showCuratorRequiredModal, setShowCuratorRequiredModal] = useState(false);
  const [isCurator, setIsCurator] = useState<boolean | null>(null);
  const pendingAddClipAfterAuth = useRef(false);
  const hadAuthenticatedUser = useRef(false);
  const [playingMoment, setPlayingMoment] = useState<{ clipId: string; momentId: string } | null>(null);
  const [topicSearch, setTopicSearch] = useState("");
  const [usernamesByUid, setUsernamesByUid] = useState<Record<string, string>>({});
  const [activeFeedTab, setActiveFeedTab] = useState<"explore" | "following">("explore");
  const [followingUserIds, setFollowingUserIds] = useState<string[]>([]);
  const [followingClips, setFollowingClips] = useState<any[]>([]);
  const [followingProfiles, setFollowingProfiles] = useState<
    { uid: string; username: string; photoURL: string | null }[]
  >([]);
  const [openShareMenuClipId, setOpenShareMenuClipId] = useState<string | null>(null);
  const shareMenuRef = useRef<HTMLDivElement | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [editUsernameOpen, setEditUsernameOpen] = useState(false);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const navPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const topicPickerRef = useRef<HTMLDivElement | null>(null);
  const [navUploadingPhoto, setNavUploadingPhoto] = useState(false);
  const [navPhotoUrl, setNavPhotoUrl] = useState<string | null>(null);
  const unreadCount = useUnreadMessageCount(user?.uid);
  const [inlineAddForClipId, setInlineAddForClipId] = useState<string | null>(null);
  const [inlineEdit, setInlineEdit] = useState<{ clipId: string; momentId: string } | null>(null);
  const [inlineStartMin, setInlineStartMin] = useState("");
  const [inlineStartSec, setInlineStartSec] = useState("");
  const [inlineEndMin, setInlineEndMin] = useState("");
  const [inlineEndSec, setInlineEndSec] = useState("");
  const [inlineNote, setInlineNote] = useState("");
  const [inlineTopic, setInlineTopic] = useState("Other");
  const [inlineCustomTopicDraft, setInlineCustomTopicDraft] = useState("");
  const [inlineSubmitting, setInlineSubmitting] = useState(false);
  const [likesByClipId, setLikesByClipId] = useState<Record<string, { count: number; liked: boolean }>>({});
  const [reactionsByClipId, setReactionsByClipId] = useState<
    Record<string, { counts: Record<string, number>; mine: string | null }>
  >({});
  const [commentCountsByClipId, setCommentCountsByClipId] = useState<Record<string, number>>({});
  const [openCommentsByClipId, setOpenCommentsByClipId] = useState<Record<string, boolean>>({});
  const [commentsByClipId, setCommentsByClipId] = useState<Record<string, any[]>>({});
  const [commentDraftByClipId, setCommentDraftByClipId] = useState<Record<string, string>>({});
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | null>(null);
  const [curatorTopicsDraft, setCuratorTopicsDraft] = useState<string[]>([]);
  const [curatorTopicsSaving, setCuratorTopicsSaving] = useState(false);
  const [postFirstClipTopicsOpen, setPostFirstClipTopicsOpen] = useState(false);
  const [suggestedCurators, setSuggestedCurators] = useState<
    { uid: string; username: string; photoURL: string | null; profileTopics: string[]; followerCount: number }[]
  >([]);
  const [followBusyByUid, setFollowBusyByUid] = useState<Record<string, boolean>>({});

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
    void ensureSeedTopics(user?.uid ?? null).catch(() => {});
  }, [user?.uid]);

  useEffect(() => {
    const unsub = subscribeToTopics(
      (topics) => {
        setTopicOptions(topics);
        if (topics.length > 0) {
          setTopicDropdownOptions(topics.slice(0, 20));
        }
      },
      () => {
        const fallback = CURATD_TOPICS.map((name) => ({ id: topicDocId(name), name, count: 0 }));
        setTopicOptions(fallback);
        setTopicDropdownOptions(fallback.slice(0, 20));
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!topicDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = topicPickerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setTopicDropdownOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [topicDropdownOpen]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("selectedTopics");
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      const topics = Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
      setSelectedTopics(topics);
      const completed = window.localStorage.getItem("onboardingComplete") === "1";
      if (!completed) setOnboardingStep(1);
    } catch {
      setSelectedTopics([]);
      setOnboardingStep(1);
    }
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const topicFromUrl = params.get("topic");
      if (topicFromUrl) setTopicSearch(topicFromUrl);
    } catch {}
  }, []);

  useEffect(() => {
    if (onboardingStep !== 2 || selectedTopics.length === 0) return;
    let cancelled = false;
    const usersQ = query(
      collection(db, "users"),
      where("profileTopics", "array-contains-any", selectedTopics.slice(0, 10)),
      limit(10),
    );
    getDocs(usersQ)
      .then(async (snap) => {
        if (cancelled) return;
        const cards = await Promise.all(
          snap.docs.map(async (d) => {
            const data = d.data() as any;
            const uid = d.id;
            const usernameVal = typeof data?.username === "string" ? data.username.trim().toLowerCase() : "";
            if (!usernameVal) return null;
            let followerCount = 0;
            try {
              followerCount = await getFollowerCount(uid);
            } catch {}
            return {
              uid,
              username: usernameVal,
              photoURL: typeof data?.photoURL === "string" ? data.photoURL : null,
              profileTopics: Array.isArray(data?.profileTopics)
                ? data.profileTopics.filter((t: unknown) => typeof t === "string").slice(0, 4)
                : [],
              followerCount,
            };
          }),
        );
        if (cancelled) return;
        setSuggestedCurators(cards.filter(Boolean) as any);
      })
      .catch(() => {
        if (!cancelled) setSuggestedCurators([]);
      });
    return () => {
      cancelled = true;
    };
  }, [onboardingStep, selectedTopics]);

  useEffect(() => {
    if (!user) {
      setSavedClips([]);
      return;
    }
    const savedQ = query(collection(db, "savedClips"), where("userId", "==", user.uid));
    const unsubscribeSaved = onSnapshot(savedQ, (snapshot) => {
      setSavedClips(
        snapshot.docs
          .map((d) => {
            const data = d.data() as { clipId?: unknown };
            return typeof data.clipId === "string" ? data.clipId : null;
          })
          .filter(Boolean) as string[],
      );
    });
    return () => {
      unsubscribeSaved();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user) {
      setFollowingUserIds([]);
      setFollowingClips([]);
      if (activeFeedTab === "following") setActiveFeedTab("explore");
      return;
    }

    const followsQ = query(collection(db, "follows"), where("followerId", "==", user.uid));
    const unsubscribeFollows = onSnapshot(
      followsQ,
      (snapshot) => {
        const ids = snapshot.docs
          .map((d) => {
            const data = d.data() as any;
            return typeof data?.followingId === "string" ? data.followingId : null;
          })
          .filter(Boolean) as string[];
        setFollowingUserIds([...new Set(ids)]);
      },
      () => setFollowingUserIds([]),
    );

    return () => unsubscribeFollows();
  }, [user?.uid, activeFeedTab]);

  useEffect(() => {
    if (!user || followingUserIds.length === 0) {
      setFollowingClips([]);
      return;
    }

    const chunks: string[][] = [];
    for (let i = 0; i < followingUserIds.length; i += 30) {
      chunks.push(followingUserIds.slice(i, i + 30));
    }

    const resultsByChunk = new Map<number, any[]>();
    const publish = () => {
      const merged = [...resultsByChunk.values()].flat();
      merged.sort((a, b) => {
        const bt = b?.createdAt?.toMillis?.() ?? 0;
        const at = a?.createdAt?.toMillis?.() ?? 0;
        return bt - at;
      });
      setFollowingClips(merged);
    };

    const unsubs = chunks.map((ids, idx) => {
      const clipsQ = query(collection(db, "clips"), where("userId", "in", ids));
      return onSnapshot(
        clipsQ,
        (snapshot) => {
          resultsByChunk.set(idx, snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          publish();
        },
        () => {
          resultsByChunk.set(idx, []);
          publish();
        },
      );
    });

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [user?.uid, followingUserIds]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!user || activeFeedTab !== "following" || followingUserIds.length === 0) {
        setFollowingProfiles([]);
        return;
      }

      const entries = await Promise.all(
        followingUserIds.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "users", uid));
            const data = snap.exists() ? (snap.data() as any) : null;
            const usernameVal = typeof data?.username === "string" ? data.username.trim().toLowerCase() : null;
            const photoURLVal = typeof data?.photoURL === "string" ? data.photoURL : null;
            return {
              uid,
              username: usernameVal,
              photoURL: photoURLVal,
            };
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;
      const cleaned = entries
        .filter(Boolean)
        .filter((p) => (p as any).username) as {
        uid: string;
        username: string;
        photoURL: string | null;
      }[];

      cleaned.sort((a, b) => a.username.localeCompare(b.username));

      setFollowingProfiles(cleaned);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, activeFeedTab, followingUserIds]);

  useEffect(() => {
    if (user) {
      hadAuthenticatedUser.current = true;
      if (!pendingAddClipAfterAuth.current) return;
      pendingAddClipAfterAuth.current = false;
      setShowAuthModal(false);
      openNewClipForm();
      return;
    }
    if (hadAuthenticatedUser.current) {
      hadAuthenticatedUser.current = false;
      pendingAddClipAfterAuth.current = false;
      setShowAuthModal(false);
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const missing = new Set<string>();
      for (const c of clips) {
        const uid = c?.userId;
        if (typeof uid !== "string" || !uid) continue;
        const hasClipUsername = typeof c?.username === "string" && c.username.trim();
        if (hasClipUsername) continue;
        if (usernamesByUid[uid]) continue;
        missing.add(uid);
      }
      if (missing.size === 0) return;

      const entries = await Promise.all(
        [...missing].map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "users", uid));
            const data = snap.exists() ? (snap.data() as any) : null;
            const u = typeof data?.username === "string" ? data.username.trim().toLowerCase() : "";
            if (!u) return null;
            return [uid, u] as const;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const e of entries) {
        if (!e) continue;
        next[e[0]] = e[1];
      }
      if (Object.keys(next).length === 0) return;
      setUsernamesByUid((prev) => ({ ...prev, ...next }));
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [clips, usernamesByUid]);

  useEffect(() => {
    setPlayingMoment(null);
  }, [topicSearch]);

  const toggleLike = async (clipId: string) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    const refLike = doc(db, "clips", clipId, "likes", user.uid);
    const current = likesByClipId[clipId]?.liked;
    try {
      if (current) {
        await deleteDoc(refLike);
      } else {
        await setDoc(refLike, { likedAt: serverTimestamp() });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const setReaction = async (clipId: string, type: "🔥" | "🧠" | "💎") => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    const refReaction = doc(db, "clips", clipId, "reactions", user.uid);
    const mine = reactionsByClipId[clipId]?.mine;
    try {
      if (mine === type) {
        await deleteDoc(refReaction);
      } else {
        await setDoc(refReaction, { type, reactedAt: serverTimestamp() });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleComments = (clipId: string) => {
    setOpenCommentsByClipId((prev) => ({ ...prev, [clipId]: !prev[clipId] }));
  };

  const sendComment = async (clip: any) => {
    const clipId = String(clip?.id || "");
    if (!clipId) return;
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    const text = (commentDraftByClipId[clipId] || "").trim();
    if (!text) return;
    try {
      await addDoc(collection(db, "clips", clipId, "comments"), {
        userId: user.uid,
        username: username ?? null,
        displayName: username ?? null,
        photoURL: user.photoURL ?? null,
        text,
        createdAt: serverTimestamp(),
      });
      setCommentDraftByClipId((prev) => ({ ...prev, [clipId]: "" }));
      setOpenCommentsByClipId((prev) => ({ ...prev, [clipId]: true }));
    } catch (e) {
      console.error(e);
      alert("Could not post comment.");
    }
  };

  const deleteComment = async (clip: any, commentId: string, commentUserId: string | null) => {
    const clipId = String(clip?.id || "");
    if (!clipId || !user) return;
    const isOwner = user.uid === clip.userId;
    const isSelf = !!commentUserId && user.uid === commentUserId;
    if (!isOwner && !isSelf) return;
    try {
      await deleteDoc(doc(db, "clips", clipId, "comments", commentId));
    } catch (e) {
      console.error(e);
      alert("Could not delete comment.");
    }
  };

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
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const [userSnap, clipSnap] = await Promise.all([
          getDoc(doc(db, "users", user.uid)),
          getDocs(query(collection(db, "clips"), where("userId", "==", user.uid), limit(1))),
        ]);
        if (cancelled || clipSnap.empty || !userSnap.exists()) return;
        const data = userSnap.data() as { hasSeenTopicPrompt?: unknown; profileTopics?: unknown[] };
        const hasSeenPrompt = Boolean(data?.hasSeenTopicPrompt);
        const hasProfileTopics = Array.isArray(data?.profileTopics) && data.profileTopics.length > 0;
        if (!hasSeenPrompt && !hasProfileTopics) {
          await updateDoc(doc(db, "users", user.uid), { hasSeenTopicPrompt: true });
        }
      } catch (err) {
        console.error("Failed to backfill hasSeenTopicPrompt:", err);
      }
    })();
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

  useEffect(() => {
    if (!openShareMenuClipId) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = shareMenuRef.current;
      if (el && !el.contains(e.target as Node)) setOpenShareMenuClipId(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openShareMenuClipId]);

  const uploadNavPhoto = async (file: File) => {
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
  };

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
    setTopic("");
    setAudioOnly(false);
    setEditingClipId(null);
    setShowForm(false);
  };

  const openNewClipForm = () => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    setUrl("");
    setStartMin("");
    setStartSec("");
    setEndMin("");
    setEndSec("");
    setNote("");
    setTitle("");
    setChannel("");
    setTopic("");
    setTopicInput("");
    setAudioOnly(false);
    setEditingClipId(null);
    setShowForm(true);
  };

  const newMomentId = () => {
    try {
      return (globalThis.crypto?.randomUUID?.() as string | undefined) || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    } catch {
      return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
  };

  const getPrimaryMoment = (clip: any) => {
    const m = Array.isArray(clip?.moments) && clip.moments.length > 0 ? clip.moments[0] : null;
    if (m) return m;
    return {
      id: clip?.id ? `${clip.id}_legacy` : "legacy",
      startTime: clip?.startTime ?? 0,
      endTime: clip?.endTime ?? 0,
      note: clip?.note ?? "",
      topic: clip?.topic ?? "",
      addedAt: clip?.createdAt ?? null,
    };
  };

  const closeAuthModal = () => {
    pendingAddClipAfterAuth.current = false;
    setShowAuthModal(false);
  };

  const handleSave = async () => {
    if (!user) return alert("Please sign in to save clips");
    if (!url) return alert("Please paste a YouTube URL");
    if (!title) return alert("Please add a title");
    const normalizedTopic = normalizeTopicName(topic);
    if (!normalizedTopic) return alert("Please choose a topic");
    const totalStart = (parseInt(startMin) || 0) * 60 + (parseInt(startSec) || 0);
    const totalEnd = (parseInt(endMin) || 0) * 60 + (parseInt(endSec) || 0);
    const videoId = extractVideoId(url);

    setLoading(true);
    try {
      const existingCountSnap = await getDocs(
        query(collection(db, "clips"), where("userId", "==", user.uid), limit(1)),
      );
      const isFirstClipEver = existingCountSnap.empty;
      const moment = {
        id: newMomentId(),
        startTime: totalStart,
        endTime: totalEnd,
        note,
        topic: normalizedTopic,
        addedAt: Timestamp.now(),
      };

      // If editing, update the first moment (legacy UI behavior).
      if (editingClipId) {
        const snap = await getDoc(doc(db, "clips", editingClipId));
        const data = snap.exists() ? (snap.data() as any) : null;
        const previousMoments = Array.isArray(data?.moments) ? data.moments : [];
        const previousTopic =
          typeof previousMoments[0]?.topic === "string" ? normalizeTopicName(previousMoments[0].topic) : "";
        const moments = Array.isArray(data?.moments) ? [...data.moments] : [];
        if (moments.length === 0) moments.push(moment);
        else moments[0] = { ...moments[0], startTime: totalStart, endTime: totalEnd, note, topic: normalizedTopic };
        await updateDoc(doc(db, "clips", editingClipId), {
          videoUrl: url,
          videoId,
          audioOnly,
          title,
          channelName: channel,
          userId: user.uid,
          username: username ?? null,
          displayName: username || "Anonymous",
          createdAt: data?.createdAt ?? serverTimestamp(),
          moments,
        });
        if (previousTopic && previousTopic !== normalizedTopic) {
          await adjustTopicUsage(previousTopic, -1, user.uid);
          await recordTopicUsage(normalizedTopic, user.uid);
        }
      } else {
        // Multi-clip structure: group by videoId + clip type + userId.
        const existingQ = query(
          collection(db, "clips"),
          where("videoId", "==", videoId),
          where("audioOnly", "==", audioOnly),
          where("userId", "==", user.uid),
          limit(1),
        );
        const existingSnap = await getDocs(existingQ);
        if (!existingSnap.empty) {
          const existingId = existingSnap.docs[0].id;
          await updateDoc(doc(db, "clips", existingId), {
            title,
            channelName: channel,
            videoId,
            audioOnly,
            username: username ?? null,
            displayName: username || "Anonymous",
            moments: arrayUnion(moment),
          });
        } else {
          await addDoc(collection(db, "clips"), {
            videoUrl: url,
            videoId,
            audioOnly,
            title,
            channelName: channel,
            userId: user.uid,
            username: username ?? null,
            displayName: username || "Anonymous",
            createdAt: serverTimestamp(),
            moments: [moment],
          });
        }
        await recordTopicUsage(normalizedTopic, user.uid);
      }
      const userSnap = await getDoc(doc(db, "users", user.uid));
      const userData = userSnap.exists()
        ? (userSnap.data() as { profileTopics?: unknown[]; hasSeenTopicPrompt?: unknown })
        : null;
      const hasProfileTopics = Array.isArray(userData?.profileTopics) && userData.profileTopics.length > 0;
      const hasSeenPrompt = userData?.hasSeenTopicPrompt === true;
      const shouldPromptForTopics =
        !editingClipId &&
        isFirstClipEver &&
        !hasProfileTopics &&
        !hasSeenPrompt;
      if (shouldPromptForTopics) {
        setCuratorTopicsDraft((prev) => {
          const next = [...new Set([normalizedTopic, ...prev])];
          return next.slice(0, Math.max(next.length, 1));
        });
        setPostFirstClipTopicsOpen(true);
        resetForm();
      } else {
        resetForm();
      }
    } catch (e) {
      alert("Error saving clip.");
    }
    setLoading(false);
  };

  const handleEdit = (clip: any) => {
    if (!user || user.uid !== clip.userId) return;
    const m = getPrimaryMoment(clip);
    setUrl(clip.videoUrl || clip.url || '');
    setTitle(clip.title || '');
    setChannel(clip.channelName || clip.channel || '');
    setTopic(m?.topic || "");
    setTopicInput(m?.topic || "");
    setAudioOnly(Boolean(clip?.audioOnly));
    setNote(m?.note || "");
    const sMin = Math.floor(((m?.startTime as number) || 0) / 60);
    const sSec = (((m?.startTime as number) || 0) % 60);
    const eMin = Math.floor(((m?.endTime as number) || 0) / 60);
    const eSec = (((m?.endTime as number) || 0) % 60);
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

  const getMoments = (clip: any) => {
    const ms = Array.isArray(clip?.moments) ? clip.moments : null;
    if (ms && ms.length > 0) return ms;
    return [
      {
        id: clip?.id ? `${clip.id}_legacy` : "legacy",
        startTime: clip?.startTime ?? 0,
        endTime: clip?.endTime ?? 0,
        note: clip?.note ?? "",
        topic: clip?.topic ?? "",
        addedAt: clip?.createdAt ?? null,
      },
    ];
  };

  const formatTime = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  };

  const openInlineAdd = (clip: any) => {
    setInlineAddForClipId(clip.id);
    setInlineEdit(null);
    setInlineStartMin("");
    setInlineStartSec("");
    setInlineEndMin("");
    setInlineEndSec("");
    setInlineNote("");
    setInlineTopic("Other");
    setInlineCustomTopicDraft("");
  };

  const openInlineEdit = (clip: any, moment: any) => {
    setInlineAddForClipId(clip.id);
    setInlineEdit({ clipId: clip.id, momentId: String(moment?.id || "") });
    const s = Number(moment?.startTime || 0);
    const e = Number(moment?.endTime || 0);
    setInlineStartMin(String(Math.floor(s / 60)));
    setInlineStartSec(String(s % 60));
    setInlineEndMin(String(Math.floor(e / 60)));
    setInlineEndSec(String(e % 60));
    setInlineNote(String(moment?.note || ""));
    setInlineTopic(String(moment?.topic || "Other"));
    setInlineCustomTopicDraft("");
  };

  const applyInlineCustomTopic = () => {
    const v = inlineCustomTopicDraft.trim();
    if (!v) return;
    setInlineTopic(v);
    setInlineCustomTopicDraft("");
  };

  const submitInlineMoment = async (clip: any) => {
    if (!user || user.uid !== clip.userId) return;
    const totalStart = (parseInt(inlineStartMin) || 0) * 60 + (parseInt(inlineStartSec) || 0);
    const totalEnd = (parseInt(inlineEndMin) || 0) * 60 + (parseInt(inlineEndSec) || 0);
    if (!inlineTopic.trim()) return;

    setInlineSubmitting(true);
    try {
      const moment = {
        id: inlineEdit && inlineEdit.clipId === clip.id ? inlineEdit.momentId : newMomentId(),
        startTime: totalStart,
        endTime: totalEnd,
        note: inlineNote,
        topic: inlineTopic,
        addedAt: Timestamp.now(),
      };

      if (inlineEdit && inlineEdit.clipId === clip.id) {
        const editingMomentId = inlineEdit.momentId;
        const next = getMoments(clip).map((m: any) => (String(m?.id) === editingMomentId ? { ...m, ...moment } : m));
        await updateDoc(doc(db, "clips", clip.id), { moments: next });
      } else {
        await updateDoc(doc(db, "clips", clip.id), { moments: arrayUnion(moment) });
      }

      setInlineAddForClipId(null);
      setInlineEdit(null);
    } catch (e) {
      console.error(e);
      alert("Could not save moment. Please try again.");
    } finally {
      setInlineSubmitting(false);
    }
  };

  const deleteMoment = async (clip: any, momentId: string) => {
    if (!user || user.uid !== clip.userId) return;
    const next = getMoments(clip).filter((m: any) => String(m?.id) !== momentId);
    try {
      await updateDoc(doc(db, "clips", clip.id), { moments: next });
      if (playingMoment?.clipId === clip.id && playingMoment?.momentId === momentId) {
        setPlayingMoment(null);
      }
    } catch (e) {
      console.error(e);
      alert("Could not delete moment. Please try again.");
    }
  };

  const filtered = useMemo(() => {
    const topicSet = new Set(selectedTopics.map((t) => t.toLowerCase()));
    const matchesSelectedTopics = (c: any) => {
      if (topicSet.size === 0) return true;
      const ms = Array.isArray(c?.moments) ? c.moments : null;
      const topics: string[] =
        ms && ms.length > 0
          ? ms.map((m: any) => (typeof m?.topic === "string" ? m.topic : "")).filter(Boolean)
          : [typeof c?.topic === "string" ? c.topic : ""].filter(Boolean);
      return topics.some((t) => topicSet.has(String(t).toLowerCase()));
    };

    let base: any[] = [];
    if (!user) {
      base = clips.filter((c) => matchesSelectedTopics(c));
    } else if (activeFeedTab === "following") {
      if (followingUserIds.length === 0) {
        base = clips.filter((c) => matchesSelectedTopics(c));
      } else {
        const followingSet = new Set(followingUserIds);
        const followingPart = followingClips;
        const discoveryPart = clips.filter(
          (c) =>
            !followingSet.has(String(c?.userId || "")) &&
            String(c?.userId || "") !== user.uid &&
            matchesSelectedTopics(c),
        );
        base = [...followingPart, ...discoveryPart];
      }
    } else {
      base = clips;
    }
    const bySaved = showSaved ? base.filter((c) => savedClips.includes(c.id)) : base;
    const q = topicSearch.trim().toLowerCase();
    if (!q) return bySaved;
    return bySaved.filter((c) => {
      const ms = Array.isArray(c?.moments) ? c.moments : null;
      const topics: string[] =
        ms && ms.length > 0
          ? ms.map((m: any) => (typeof m?.topic === "string" ? m.topic : "")).filter(Boolean)
          : [typeof c?.topic === "string" ? c.topic : ""].filter(Boolean);
      return topics.some((t) => t.toLowerCase().includes(q));
    });
  }, [clips, followingClips, activeFeedTab, showSaved, savedClips, topicSearch, selectedTopics, user?.uid, followingUserIds]);

  useEffect(() => {
    // Keep subscriptions bounded to currently visible clips.
    const unsubs: Array<() => void> = [];
    const visible = filtered.slice(0, 30);

    for (const clip of visible) {
      const clipId = String(clip?.id || "");
      if (!clipId) continue;

      const likesRef = collection(db, "clips", clipId, "likes");
      unsubs.push(
        onSnapshot(
          likesRef,
          (snap) => {
            const liked = !!user?.uid && snap.docs.some((d) => d.id === user.uid);
            setLikesByClipId((prev) => ({ ...prev, [clipId]: { count: snap.size, liked } }));
          },
          () => {
            setLikesByClipId((prev) => ({ ...prev, [clipId]: { count: 0, liked: false } }));
          },
        ),
      );

      const reactionsRef = collection(db, "clips", clipId, "reactions");
      unsubs.push(
        onSnapshot(
          reactionsRef,
          (snap) => {
            const counts: Record<string, number> = { "🔥": 0, "🧠": 0, "💎": 0 };
            let mine: string | null = null;
            for (const d of snap.docs) {
              const data = d.data() as any;
              const t = typeof data?.type === "string" ? data.type : null;
              if (t && counts[t] != null) counts[t] += 1;
              if (user?.uid && d.id === user.uid) mine = t;
            }
            setReactionsByClipId((prev) => ({ ...prev, [clipId]: { counts, mine } }));
          },
          () => {
            setReactionsByClipId((prev) => ({
              ...prev,
              [clipId]: { counts: { "🔥": 0, "🧠": 0, "💎": 0 }, mine: null },
            }));
          },
        ),
      );

      const commentsRef = collection(db, "clips", clipId, "comments");
      unsubs.push(
        onSnapshot(
          commentsRef,
          (snap) => {
            setCommentCountsByClipId((prev) => ({ ...prev, [clipId]: snap.size }));
          },
          () => {
            setCommentCountsByClipId((prev) => ({ ...prev, [clipId]: 0 }));
          },
        ),
      );
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [filtered, user?.uid]);

  useEffect(() => {
    // Subscribe to full comment lists only when expanded.
    const unsubs: Array<() => void> = [];
    for (const [clipId, open] of Object.entries(openCommentsByClipId)) {
      if (!open) continue;
      const q = query(collection(db, "clips", clipId, "comments"), orderBy("createdAt", "desc"), limit(50));
      unsubs.push(
        onSnapshot(
          q,
          (snap) => {
            setCommentsByClipId((prev) => ({
              ...prev,
              [clipId]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
            }));
          },
          () => {
            setCommentsByClipId((prev) => ({ ...prev, [clipId]: [] }));
          },
        ),
      );
    }
    return () => unsubs.forEach((u) => u());
  }, [openCommentsByClipId]);

  const topTopics = useMemo(() => {
    const feedClips = activeFeedTab === "following" ? followingClips : clips;
    const source = showSaved ? feedClips.filter((c) => savedClips.includes(c.id)) : feedClips;
    const counts = new Map<string, { label: string; count: number }>();
    for (const c of source) {
      const ms = Array.isArray(c?.moments) ? c.moments : null;
      const topics: string[] =
        ms && ms.length > 0
          ? ms.map((m: any) => (typeof m?.topic === "string" ? m.topic : "")).filter(Boolean)
          : [typeof c?.topic === "string" ? c.topic : ""].filter(Boolean);
      for (const raw of topics) {
        if (typeof raw !== "string") continue;
        const label = raw.trim();
        if (!label) continue;
        const key = label.toLowerCase();
        const prev = counts.get(key);
        if (prev) prev.count += 1;
        else counts.set(key, { label, count: 1 });
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 5);
  }, [clips, followingClips, activeFeedTab, showSaved, savedClips]);

  const activeFeedClipCount = filtered.length;

  const showToast = (message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 2000);
  };

  const copyTextToClipboard = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      showToast("Link copied");
    }
  };
  const previewId = extractVideoId(url);

  const finishOnboarding = () => {
    try {
      window.localStorage.setItem("onboardingComplete", "1");
      window.localStorage.setItem("selectedTopics", JSON.stringify(selectedTopics));
    } catch {}
    setOnboardingStep(null);
  };

  const toggleSelectedTopic = (topic: string) => {
    setSelectedTopics((prev) => {
      const has = prev.includes(topic);
      const next = has ? prev.filter((t) => t !== topic) : [...prev, topic];
      try {
        window.localStorage.setItem("selectedTopics", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const toggleCuratorTopic = (topic: string, maxSelections?: number) => {
    setCuratorTopicsDraft((prev) => {
      const has = prev.includes(topic);
      if (has) return prev.filter((t) => t !== topic);
      if (maxSelections != null && prev.length >= maxSelections) return prev;
      return [...prev, topic];
    });
  };

  const promptSignIn = (title: string, subtitle: string) => {
    setShowAuthModal(true);
    setAuthModalCopy({ title, subtitle });
  };

  const applyTopicFilter = (nextTopic: string) => {
    const normalized = normalizeTopicName(nextTopic);
    setTopicSearch(normalized);
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (normalized) params.set("topic", normalized);
    else params.delete("topic");
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/");
  };

  const clearTopicFilter = () => applyTopicFilter("");

  const loadTopTopicDropdownOptions = async () => {
    try {
      const snap = await getDocs(query(collection(db, "topics"), orderBy("count", "desc"), limit(20)));
      if (!snap.empty) {
        const topTopics = snap.docs.map((d) => {
          const data = d.data() as { name?: unknown; count?: unknown };
          return {
            id: d.id,
            name: typeof data.name === "string" ? data.name : d.id,
            count: typeof data.count === "number" ? data.count : 0,
          };
        });
        setTopicDropdownOptions(topTopics);
        return;
      }
    } catch {}

    const fallbackSource =
      topicOptions.length > 0
        ? topicOptions
        : CURATD_TOPICS.map((name) => ({ id: topicDocId(name), name, count: 0 }));
    setTopicDropdownOptions(fallbackSource.slice(0, 20));
  };

  const filteredTopicOptions = useMemo(() => {
    const q = normalizeTopicName(topicInput).toLowerCase();
    const source =
      topicDropdownOptions.length > 0
        ? topicDropdownOptions
        : topicOptions.length > 0
          ? topicOptions
          : CURATD_TOPICS.map((name) => ({ id: topicDocId(name), name, count: 0 }));
    if (!q) return source.slice(0, 20);
    return source.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 20);
  }, [topicInput, topicDropdownOptions, topicOptions]);

  const selectTopicOption = async (name: string) => {
    const normalized = normalizeTopicName(name);
    if (
      normalized &&
      user?.uid &&
      !topicOptions.some((opt) => opt.name.toLowerCase() === normalized.toLowerCase())
    ) {
      try {
        await setDoc(
          doc(db, "topics", topicDocId(normalized)),
          {
            name: normalized,
            count: 0,
            createdAt: serverTimestamp(),
            createdBy: user.uid,
          },
          { merge: true },
        );
      } catch {}
    }
    setTopic(normalized);
    setTopicInput("");
    setTopicDropdownOpen(false);
  };

  const toggleFollowUser = async (targetUid: string) => {
    if (!targetUid || targetUid === user?.uid) return;
    if (!user) {
      promptSignIn("Sign in to follow curators", "Follow curators to keep track of their clips.");
      return;
    }
    const currentlyFollowing = followingUserIds.includes(targetUid);
    setFollowBusyByUid((prev) => ({ ...prev, [targetUid]: true }));
    setFollowingUserIds((prev) =>
      currentlyFollowing ? prev.filter((id) => id !== targetUid) : [...prev, targetUid],
    );
    try {
      if (currentlyFollowing) await unfollowUser(user.uid, targetUid);
      else await followUser(user.uid, targetUid);
    } catch (err) {
      console.error("Follow toggle failed:", err);
      setFollowingUserIds((prev) =>
        currentlyFollowing ? [...prev, targetUid] : prev.filter((id) => id !== targetUid),
      );
    } finally {
      setFollowBusyByUid((prev) => ({ ...prev, [targetUid]: false }));
    }
  };

  const goToCuratorProfile = (curatorUsername: string) => {
    const clean = String(curatorUsername || "").trim().toLowerCase();
    if (!clean) return;
    if (!user) {
      promptSignIn("Sign in to view profiles", "Sign in to view curator profiles and follow people.");
      return;
    }
    router.push(`/${clean}`);
  };

  return (
    <div className="h-screen bg-black text-white font-sans flex flex-col">
      <UsernameSetup />
      {user ? (
        <EditUsernameModal
          open={editUsernameOpen}
          onOpenChange={setEditUsernameOpen}
          currentUsername={username ?? ""}
        />
      ) : null}
      {onboardingStep != null ? (
        <div className="fixed inset-0 z-[220] bg-black text-white">
          {onboardingStep === 1 ? (
            <div className="h-full max-w-3xl mx-auto px-6 py-10 flex flex-col">
              <h1 className="text-3xl font-bold">What are you into?</h1>
              <p className="text-zinc-400 mt-2">We&apos;ll show you clips you&apos;ll actually care about.</p>
              <div className="mt-8 flex flex-wrap gap-2">
                {(topicOptions.length > 0 ? topicOptions.slice(0, 20).map((t) => t.name) : CURATD_TOPICS).map((topic) => {
                  const active = selectedTopics.includes(topic);
                  return (
                    <button
                      key={topic}
                      type="button"
                      onClick={() => toggleSelectedTopic(topic)}
                      className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                        active
                          ? "bg-white text-black border-white font-semibold"
                          : "bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                      }`}
                    >
                      {topic}
                    </button>
                  );
                })}
              </div>
              <div className="mt-auto">
                <button
                  type="button"
                  disabled={selectedTopics.length === 0}
                  onClick={() => setOnboardingStep(2)}
                  className={`w-full rounded-xl py-3.5 text-sm font-bold ${
                    selectedTopics.length > 0
                      ? "bg-white text-black hover:bg-zinc-200"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                  }`}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full max-w-4xl mx-auto px-6 py-10 flex flex-col">
              <h1 className="text-3xl font-bold">Curators you might like</h1>
              <p className="text-zinc-400 mt-2">Follow a few to personalize your feed.</p>
              <div className="mt-8 grid gap-3">
                {suggestedCurators.map((c) => {
                  const following = followingUserIds.includes(c.uid);
                  const busy = Boolean(followBusyByUid[c.uid]);
                  return (
                    <div key={c.uid} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 flex items-center gap-3">
                      {c.photoURL ? (
                        <img src={c.photoURL} alt="" className="h-11 w-11 rounded-full object-cover border border-zinc-700" />
                      ) : (
                        <div className="h-11 w-11 rounded-full bg-emerald-500 text-black font-bold flex items-center justify-center">
                          {(c.username || "U").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">@{c.username}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.profileTopics.slice(0, 4).map((t) => (
                            <span key={t} className="text-[11px] rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-300">{t}</span>
                          ))}
                        </div>
                        <div className="text-xs text-zinc-500 mt-1">{c.followerCount} followers</div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleFollowUser(c.uid)}
                        className={`rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${
                          following ? "border-emerald-500 bg-emerald-500 text-black" : "border-zinc-400 text-white hover:border-white"
                        }`}
                      >
                        {following ? "Following" : "Follow"}
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={finishOnboarding}
                className="mt-auto text-left text-sm font-semibold text-zinc-300 hover:text-white"
              >
                Skip, take me to the feed →
              </button>
            </div>
          )}
        </div>
      ) : null}
      {postFirstClipTopicsOpen ? (
        <div className="fixed inset-0 z-[209] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold">What else are you into?</h2>
              <p className="text-zinc-500 text-sm mt-0.5">Pick at least 3 topics. They&apos;ll show on your profile.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(topicOptions.length > 0 ? topicOptions.map((t) => t.name) : CURATD_TOPICS).map((topicName) => {
                const selected = curatorTopicsDraft.includes(topicName);
                return (
                  <button
                    key={topicName}
                    type="button"
                    onClick={() => toggleCuratorTopic(topicName)}
                    className={`text-sm px-3.5 py-1.5 rounded-full border transition-colors ${
                      selected
                        ? "bg-white text-black border-white font-semibold"
                        : "bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700"
                    }`}
                  >
                    {topicName}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={curatorTopicsSaving || curatorTopicsDraft.length < 3}
              onClick={async () => {
                if (!user || curatorTopicsDraft.length < 3) return;
                setCuratorTopicsSaving(true);
                try {
                  await updateDoc(doc(db, "users", user.uid), {
                    profileTopics: curatorTopicsDraft,
                    hasSeenTopicPrompt: true,
                  });
                  setPostFirstClipTopicsOpen(false);
                } catch (err) {
                  console.error("Could not save profile topics:", err);
                } finally {
                  setCuratorTopicsSaving(false);
                }
              }}
              className={`w-full mt-8 font-bold py-4 rounded-xl transition-all text-sm ${
                curatorTopicsDraft.length >= 3 && !curatorTopicsSaving
                  ? "bg-white text-black hover:bg-zinc-200"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              }`}
            >
              {curatorTopicsSaving ? "Saving..." : "Save to my profile"}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!user) return;
                try {
                  await updateDoc(doc(db, "users", user.uid), { hasSeenTopicPrompt: true });
                } catch {}
                setPostFirstClipTopicsOpen(false);
              }}
              className="mt-4 text-sm text-zinc-400 hover:text-white"
            >
              Skip for now
            </button>
          </div>
        </div>
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
                title={username ? `@${username}` : "Setting up..."}
              >
                {navPhotoUrl ? (
                  <img
                    src={navPhotoUrl}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover border border-zinc-700 shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-black text-xs font-bold shrink-0">
                    {(username || "U").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="text-sm font-medium text-zinc-100 truncate max-w-[160px] sm:max-w-[220px]">
                  {username ? `@${username}` : "Setting up..."}
                </span>
              </button>

              {navMenuOpen ? (
                <div className="absolute right-4 top-14 z-[80] w-56 rounded-lg border border-zinc-700 bg-zinc-900 shadow-lg p-1">
                  <Link
                    href={username ? `/${username}` : "/"}
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

      <div className="flex flex-1 min-h-0">
      {/* Left icon sidebar */}
      <aside className="w-14 border-r border-zinc-800 flex flex-col items-center py-4 gap-3 shrink-0">
        <button
          type="button"
          onClick={() => {
            window.location.reload();
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
              if (user == null) {
                pendingAddClipAfterAuth.current = true;
                setShowAuthModal(true);
                return;
              }
              void openNewClipForm();
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
          {activeFeedTab === "following" && user ? (
            <section className="border-b border-zinc-800/80 pb-4">
              <div className="text-xs text-zinc-400 font-semibold">People you follow</div>

              {followingUserIds.length === 0 ? (
                <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/20 p-4">
                  <div className="text-sm text-zinc-300">You&apos;re not following anyone yet</div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFeedTab("explore");
                      setTopicSearch("");
                      setShowSaved(false);
                    }}
                    className="mt-3 text-sm font-semibold text-emerald-500 hover:text-emerald-400 transition-colors"
                  >
                    Explore curators
                  </button>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {followingProfiles.map((p) => (
                    <Link
                      key={p.uid}
                      href={p.username ? `/${p.username}` : "/"}
                      className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/20 px-3 py-2 hover:bg-zinc-900/40 transition-colors"
                    >
                      {p.photoURL ? (
                        <img
                          src={p.photoURL}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover border border-zinc-700 shrink-0"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-emerald-500 flex items-center justify-center text-black text-xs font-bold shrink-0">
                          {(p.username || "U").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-white truncate">
                          {p.username ? `@${p.username}` : "Anonymous"}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ) : (
            /* Topic search (filters main feed) */
            <section className="border-b border-zinc-800/80 pb-4">
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={clearTopicFilter}
                  className={`w-full shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    !topicSearch.trim()
                      ? "border-white bg-white font-semibold text-black"
                      : "border-zinc-700 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  All
                </button>
                <div className="relative min-w-0">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="opacity-80">
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
                    onChange={(e) => applyTopicFilter(e.target.value)}
                    placeholder="Search topics..."
                    autoComplete="off"
                    className="w-full rounded-full border border-zinc-700 bg-zinc-900 py-2 pl-8 pr-3 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
                  />
                </div>
                {topicSearch.trim() ? (
                  <button
                    type="button"
                    onClick={clearTopicFilter}
                    className="self-start text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
                  >
                    ✕ Clear filter
                  </button>
                ) : null}

                {topTopics.length > 0 ? (
                  <div className="mt-2">
                    <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2">
                      Top topics
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {topTopics.map((t) => {
                        const active = topicSearch.trim().toLowerCase() === t.label.toLowerCase();
                        return (
                          <button
                            key={t.label.toLowerCase()}
                            type="button"
                            onClick={() => applyTopicFilter(t.label)}
                            className={`text-[11px] px-3 py-1 rounded-full transition-colors ${
                              active
                                ? "bg-white text-black font-semibold"
                                : "bg-zinc-900 text-zinc-400 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-600"
                            }`}
                            title={`${t.count} clips`}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          )}

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
                onClick={() => {
                  setShowSaved(false);
                  setTopicSearch("");
                }}
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
          <div className="flex items-center gap-6 border-b border-zinc-800 pb-3 mb-6">
            <button
              type="button"
              onClick={() => {
                setActiveFeedTab("explore");
                setShowSaved(false);
                setPlayingMoment(null);
              }}
              className={`pb-2 text-sm font-semibold transition-colors border-b-2 ${
                activeFeedTab === "explore"
                  ? "border-white text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-200"
              }`}
            >
              Explore
            </button>
            <button
              type="button"
              onClick={() => {
                if (!user) {
                  setShowAuthModal(true);
                  return;
                }
                setActiveFeedTab("following");
                setShowSaved(false);
                setPlayingMoment(null);
              }}
              className={`pb-2 text-sm font-semibold transition-colors border-b-2 ${
                activeFeedTab === "following"
                  ? "border-white text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-200"
              }`}
            >
              Following
            </button>
          </div>

          {/* Feed */}
          <div className="space-y-4 pb-20">
            {activeFeedTab === "following" && user && followingUserIds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center border border-zinc-800 rounded-2xl bg-zinc-900/20 px-6">
                <p className="text-zinc-400 text-sm">Follow curators to see their clips here</p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveFeedTab("explore");
                    setShowSaved(false);
                    setTopicSearch("");
                  }}
                  className="mt-5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 transition-colors"
                >
                  Discover curators
                </button>
              </div>
            ) : activeFeedClipCount === 0 ? (
              <div className="text-center py-20">
                <div className="text-5xl mb-4 opacity-20">▶</div>
                <p className="text-zinc-500 text-lg font-medium">No clips yet</p>
                <p className="text-zinc-600 text-sm mt-1">Hit the + Add icon to start curating</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-zinc-500">
                  {topicSearch.trim()
                    ? `No clips match "${topicSearch.trim()}"`
                    : showSaved
                      ? "No saved clips yet"
                      : "No clips match your filters"}
                </p>
              </div>
            ) : (
              filtered.map((clip, idx) => {
                const moments = getMoments(clip);
                const primaryMoment = moments[0];
                const vid = clip.videoId || extractVideoId(clip.videoUrl || clip.url);
                const isPlaying = playingMoment?.clipId === clip.id;
                const isAudioOnly = Boolean(clip?.audioOnly);
                const isSaved = savedClips.includes(clip.id);
                const currentUid = user?.uid ?? null;
                const isDiscoveryCandidate =
                  Boolean(currentUid) &&
                  activeFeedTab === "following" &&
                  followingUserIds.length > 0 &&
                  typeof clip?.userId === "string" &&
                  clip.userId !== currentUid &&
                  !followingUserIds.includes(clip.userId);
                const previous = idx > 0 ? filtered[idx - 1] : null;
                const shouldShowDiscoverDivider =
                  isDiscoveryCandidate &&
                  (!previous ||
                    typeof previous?.userId !== "string" ||
                    previous.userId === currentUid ||
                    followingUserIds.includes(previous.userId));

                return (
                  <React.Fragment key={clip.id}>
                    {shouldShowDiscoverDivider ? (
                      <div className="pt-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-2">Discover</div>
                        <div className="border-t border-zinc-800/80" />
                      </div>
                    ) : null}
                  <div
                    className={`group relative rounded-2xl border transition-colors overflow-hidden ${
                      isAudioOnly ? "bg-zinc-950/80" : "bg-zinc-900/30"
                    } ${
                      idx === 0
                        ? 'border-blue-500/40 hover:border-blue-500/60'
                        : 'border-zinc-800/70 hover:border-zinc-700'
                    }`}
                  >
                    {/* Video / Thumbnail (stacked, full width) */}
                    {isAudioOnly ? (
                      <div className="relative aspect-video w-full border-b border-zinc-800 rounded-t-2xl overflow-hidden bg-zinc-950">
                        {vid ? (
                          <img
                            src={`https://img.youtube.com/vi/${vid}/maxresdefault.jpg`}
                            alt={clip.title || "Audio cover"}
                            className="absolute inset-0 w-full h-full object-cover scale-110 blur-lg opacity-45"
                          />
                        ) : null}
                        <div className="absolute inset-0 bg-black/65" />
                        {vid ? (
                          <AudioOnlyYouTubePlayer
                            videoId={vid}
                            startSeconds={(() => {
                              const selected = moments.find((m: any) => String(m?.id) === String(playingMoment?.momentId));
                              return selected?.startTime ?? primaryMoment?.startTime ?? 0;
                            })()}
                            endSeconds={(() => {
                              const selected = moments.find((m: any) => String(m?.id) === String(playingMoment?.momentId));
                              return selected?.endTime ?? primaryMoment?.endTime ?? undefined;
                            })()}
                            shouldPlay={isPlaying}
                          />
                        ) : null}
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                          <div className="text-6xl leading-none select-none">🎧</div>
                          <button
                            type="button"
                            onClick={() => {
                              if (!vid) return;
                              setPlayingMoment((prev) => {
                                if (prev?.clipId === clip.id) return null;
                                return { clipId: clip.id, momentId: String(primaryMoment?.id || "primary") };
                              });
                            }}
                            className="rounded-full border border-white/30 bg-white/15 px-5 py-2 text-sm font-semibold text-white backdrop-blur-sm hover:bg-white/25 transition-colors"
                            aria-label={isPlaying ? "Pause audio clip" : "Play audio clip"}
                          >
                            {isPlaying ? "Pause" : "Play"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (!vid) return;
                          setPlayingMoment((prev) => {
                            if (prev?.clipId === clip.id) return null;
                            return { clipId: clip.id, momentId: String(primaryMoment?.id || "primary") };
                          });
                        }}
                        className="block w-full text-left"
                        aria-label={isPlaying ? "Stop clip" : "Play clip"}
                      >
                        <div className="relative aspect-video w-full bg-zinc-950 border-b border-zinc-800 rounded-t-2xl overflow-hidden">
                          {isPlaying && vid ? (
                            <ClipYouTubePlayer
                              videoId={vid}
                              startTime={(() => {
                                const selected = moments.find((m: any) => String(m?.id) === String(playingMoment?.momentId));
                                return selected?.startTime ?? primaryMoment?.startTime ?? 0;
                              })()}
                              endTime={(() => {
                                const selected = moments.find((m: any) => String(m?.id) === String(playingMoment?.momentId));
                                return selected?.endTime ?? primaryMoment?.endTime ?? undefined;
                              })()}
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
                    )}

                    {/* Text content */}
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-lg font-semibold text-white leading-snug line-clamp-2">
                            {clip.title || 'Untitled clip'}
                          </div>
                          <div className="text-sm text-zinc-500 mt-1 truncate">
                            {clip.channelName || clip.channel || 'Unknown channel'}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            {primaryMoment?.topic ? (
                              <button
                                type="button"
                                onClick={() => applyTopicFilter(primaryMoment.topic)}
                                className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                              >
                                {primaryMoment.topic}
                              </button>
                            ) : null}
                            <span className="text-xs text-zinc-500">
                              Curated by{" "}
                            {(() => {
                              const handleFromClip =
                                typeof clip.username === "string" && clip.username.trim()
                                  ? clip.username.trim().toLowerCase()
                                  : null;
                              const handleFromLookup =
                                !handleFromClip && typeof clip.userId === "string"
                                  ? usernamesByUid[clip.userId] ?? null
                                  : null;
                              const handle = handleFromClip || handleFromLookup;
                              if (handle) {
                                const canFollow =
                                  typeof clip.userId === "string" &&
                                  clip.userId.length > 0 &&
                                  clip.userId !== user?.uid;
                                const following = Boolean(user?.uid) && followingUserIds.includes(String(clip.userId));
                                return (
                                  <span className="inline-flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => goToCuratorProfile(handle)}
                                      className="font-medium text-zinc-300 hover:text-emerald-400 hover:underline"
                                    >
                                      @{handle}
                                    </button>
                                    {canFollow ? (
                                      <button
                                        type="button"
                                        disabled={Boolean(followBusyByUid[String(clip.userId)])}
                                        onClick={() => void toggleFollowUser(String(clip.userId))}
                                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                                          following
                                            ? "border-emerald-500 bg-emerald-500 text-black hover:bg-red-500 hover:border-red-500 hover:text-black"
                                            : "border-zinc-600 text-zinc-200 hover:border-white"
                                        }`}
                                      >
                                        {following ? "Following" : "Follow"}
                                      </button>
                                    ) : null}
                                  </span>
                                );
                              }
                              return (
                                <span className="text-zinc-300 font-medium">Unknown curator</span>
                              );
                            })()}
                            </span>
                            {clip.createdAt ? (
                              <span className="text-xs text-zinc-500">
                                {formatRelativeTime(clip.createdAt)}
                              </span>
                            ) : null}
                          </div>
                          {(() => {
                            const handle =
                              typeof clip.username === "string" && clip.username.trim()
                                ? clip.username.trim().toLowerCase()
                                : typeof clip.userId === "string"
                                  ? usernamesByUid[clip.userId] ?? null
                                  : null;
                            if (!handle) return null;
                            if (clip.photoURL) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => goToCuratorProfile(handle)}
                                  className="mt-3 inline-flex h-8 w-8 rounded-full overflow-hidden border border-zinc-700"
                                  title={`@${handle}`}
                                >
                                  <img src={clip.photoURL} alt="" className="h-full w-full object-cover" />
                                </button>
                              );
                            }
                            return (
                              <button
                                type="button"
                                onClick={() => goToCuratorProfile(handle)}
                                className="mt-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-bold text-zinc-200"
                                title={`@${handle}`}
                              >
                                {handle.slice(0, 1).toUpperCase()}
                              </button>
                            );
                          })()}
                          {!isAudioOnly && primaryMoment?.note ? (
                            <div className="text-base text-zinc-100 font-medium italic border-l-2 border-emerald-500 pl-3 mt-2 line-clamp-3">
                              &ldquo;{primaryMoment.note}&rdquo;
                            </div>
                          ) : null}

                          {isAudioOnly ? (
                            <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-purple-300/80">Audio only</div>
                          ) : null}

                          {/* Likes + reactions */}
                          <div className="mt-4 flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => void toggleLike(String(clip.id))}
                              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
                                likesByClipId[String(clip.id)]?.liked
                                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                                  : "border-zinc-800 bg-black/20 text-zinc-400 hover:text-white hover:bg-zinc-900/40"
                              }`}
                              aria-label="Like"
                              title="Like"
                            >
                              <span aria-hidden>
                                {likesByClipId[String(clip.id)]?.liked ? "♥" : "♡"}
                              </span>
                              <span>{likesByClipId[String(clip.id)]?.count ?? 0}</span>
                            </button>

                            {(["🔥", "🧠", "💎"] as const).map((r) => {
                              const data = reactionsByClipId[String(clip.id)];
                              const mine = data?.mine ?? null;
                              const count = data?.counts?.[r] ?? 0;
                              const active = mine === r;
                              return (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => void setReaction(String(clip.id), r)}
                                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
                                    active
                                      ? "border-white/30 bg-white text-black"
                                      : "border-zinc-800 bg-black/20 text-zinc-400 hover:text-white hover:bg-zinc-900/40"
                                  }`}
                                  aria-label={`React ${r}`}
                                  title="React"
                                >
                                  <span aria-hidden>{r}</span>
                                  <span>{count}</span>
                                </button>
                              );
                            })}

                            <button
                              type="button"
                              onClick={() => toggleComments(String(clip.id))}
                              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
                                openCommentsByClipId[String(clip.id)]
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                                  : "border-zinc-800 bg-black/20 text-zinc-400 hover:text-white hover:bg-zinc-900/40"
                              }`}
                              aria-label="Toggle comments"
                              title="Comments"
                            >
                              <span aria-hidden>💬</span>
                              <span>{commentCountsByClipId[String(clip.id)] ?? 0}</span>
                            </button>
                          </div>
                          {isAudioOnly && primaryMoment?.note ? (
                            <div className="mt-4 text-base text-zinc-100 font-medium italic border-l-2 border-purple-500 pl-3 line-clamp-3">
                              &ldquo;{primaryMoment.note}&rdquo;
                            </div>
                          ) : null}

                          {openCommentsByClipId[String(clip.id)] ? (
                            <div className="mt-3 rounded-xl border border-zinc-800 bg-black/20 p-3">
                              <div className="space-y-3">
                                {(commentsByClipId[String(clip.id)] ?? []).length === 0 ? (
                                  <div className="text-sm text-zinc-500">No comments yet.</div>
                                ) : (
                                  <div className="space-y-3">
                                    {(commentsByClipId[String(clip.id)] ?? []).map((c: any) => {
                                      const canDelete =
                                        !!user?.uid && (user.uid === clip.userId || user.uid === c?.userId);
                                      const handle =
                                        typeof c?.username === "string" && c.username.trim()
                                          ? c.username.trim().toLowerCase()
                                          : null;
                                      return (
                                        <div key={String(c?.id || "")} className="flex items-start gap-3">
                                          {c?.photoURL ? (
                                            <img
                                              src={c.photoURL}
                                              alt=""
                                              className="h-8 w-8 rounded-full object-cover border border-zinc-800"
                                            />
                                          ) : (
                                            <div className="h-8 w-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[11px] font-bold text-zinc-200">
                                              {String(c?.username || "U").slice(0, 1).toUpperCase()}
                                            </div>
                                          )}

                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                              {handle ? (
                                                <Link
                                                  href={`/${handle}`}
                                                  className="text-xs font-semibold text-zinc-200 hover:text-emerald-400 hover:underline"
                                                >
                                                  @{handle}
                                                </Link>
                                              ) : (
                                                <span className="text-xs font-semibold text-zinc-200">User</span>
                                              )}
                                              <span className="text-[11px] text-zinc-500">
                                                {c?.createdAt ? formatRelativeTime(c.createdAt) : "just now"}
                                              </span>
                                              {canDelete ? (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void deleteComment(clip, String(c?.id || ""), c?.userId ?? null)
                                                  }
                                                  className="ml-auto text-[11px] text-zinc-500 hover:text-red-300 hover:underline"
                                                >
                                                  Delete
                                                </button>
                                              ) : null}
                                            </div>
                                            <div className="mt-1 text-sm text-zinc-100 whitespace-pre-wrap break-words">
                                              {String(c?.text || "")}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                <div className="pt-2 border-t border-zinc-800">
                                  <div className="flex items-center gap-2">
                                    <input
                                      value={commentDraftByClipId[String(clip.id)] ?? ""}
                                      onChange={(e) =>
                                        setCommentDraftByClipId((prev) => ({
                                          ...prev,
                                          [String(clip.id)]: e.target.value,
                                        }))
                                      }
                                      onFocus={(e) => {
                                        if (!user) {
                                          e.currentTarget.blur();
                                          setShowAuthModal(true);
                                        }
                                      }}
                                      placeholder="Add a comment..."
                                      className="flex-1 rounded-lg border border-zinc-800 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => void sendComment(clip)}
                                      disabled={!(commentDraftByClipId[String(clip.id)] ?? "").trim()}
                                      className="shrink-0 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500"
                                    >
                                      Send
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>

                      {/* Clip actions */}
                      <div className="flex gap-1">
                          <div
                            className="relative"
                            ref={openShareMenuClipId === String(clip.id) ? shareMenuRef : undefined}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setOpenShareMenuClipId((id) => (id === String(clip.id) ? null : String(clip.id)))
                              }
                              className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-zinc-800 transition-colors"
                              aria-label="Share options"
                              aria-expanded={openShareMenuClipId === String(clip.id)}
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
                                Share
                              </span>
                            </button>
                            {openShareMenuClipId === String(clip.id) ? (
                              <div
                                className="absolute right-0 top-full z-[90] mt-1 min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
                                role="menu"
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="block w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                                  onClick={() => {
                                    void copyTextToClipboard(
                                      `https://curatd.vercel.app/clip/${clip.id}`,
                                    );
                                    setOpenShareMenuClipId(null);
                                  }}
                                >
                                  Share clip
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="block w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                                  disabled={!vid}
                                  onClick={() => {
                                    if (!vid) return;
                                    void copyTextToClipboard(`https://youtube.com/watch?v=${vid}`);
                                    setOpenShareMenuClipId(null);
                                  }}
                                >
                                  Share full video
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="block w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                                  onClick={() => {
                                    void copyTextToClipboard(
                                      `https://curatd.vercel.app/clip/${clip.id}?audio=1`,
                                    );
                                    setOpenShareMenuClipId(null);
                                  }}
                                >
                                  Share audio only
                                </button>
                              </div>
                            ) : null}
                          </div>

                          {user && clip.userId && user.uid === clip.userId ? (
                            <button
                              type="button"
                              onClick={() => void handleDelete(clip.id)}
                              className="text-[11px] text-zinc-400 hover:text-red-300 px-2.5 py-1 rounded-md hover:bg-zinc-800 transition-colors"
                            >
                              Delete video
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {/* Moments list */}
                      <div className="mt-4 space-y-2">
                        {moments.map((m: any) => {
                          const mid = String(m?.id || "");
                          const active = playingMoment?.clipId === clip.id && playingMoment?.momentId === mid;
                          return (
                            <div
                              key={mid}
                              className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2 transition-colors ${
                                active
                                  ? "border-emerald-500/50 bg-emerald-500/10"
                                  : "border-zinc-800 bg-black/20 hover:bg-zinc-900/40"
                              }`}
                            >
                              <div
                                role="button"
                                tabIndex={vid ? 0 : -1}
                                onClick={() => {
                                  if (!vid) return;
                                  setPlayingMoment({ clipId: clip.id, momentId: mid });
                                }}
                                onKeyDown={(e) => {
                                  if (!vid) return;
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setPlayingMoment({ clipId: clip.id, momentId: mid });
                                  }
                                }}
                                className="min-w-0 flex-1 text-left cursor-pointer"
                                aria-label="Play moment"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  {m?.topic ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        applyTopicFilter(m.topic);
                                      }}
                                      className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                                    >
                                      {m.topic}
                                    </button>
                                  ) : null}
                                  <span className="text-[11px] font-mono font-semibold bg-emerald-500 text-white px-2.5 py-0.5 rounded-md">
                                    {formatTime(m?.startTime || 0)} – {formatTime(m?.endTime || 0)}
                                  </span>
                                </div>
                                {m?.note ? (
                                  <div className="mt-1 text-sm text-zinc-200 line-clamp-2">
                                    {m.note}
                                  </div>
                                ) : (
                                  <div className="mt-1 text-sm text-zinc-500">No note</div>
                                )}
                              </div>

                              {user && clip.userId && user.uid === clip.userId ? (
                                <div className="shrink-0 flex items-center gap-1 pt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => openInlineEdit(clip, m)}
                                    className="h-7 w-7 rounded-md border border-zinc-800 bg-black/20 text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors"
                                    aria-label="Edit moment"
                                    title="Edit"
                                  >
                                    ✎
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteMoment(clip, mid)}
                                    className="h-7 w-7 rounded-md border border-zinc-800 bg-black/20 text-zinc-400 hover:text-red-300 hover:bg-zinc-800/60 transition-colors"
                                    aria-label="Delete moment"
                                    title="Delete"
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}

                        {user && clip.userId && user.uid === clip.userId ? (
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => openInlineAdd(clip)}
                              className="text-xs font-semibold text-emerald-500 hover:text-emerald-400 transition-colors"
                            >
                              + Add clip
                            </button>
                          </div>
                        ) : null}

                        {inlineAddForClipId === clip.id ? (
                          <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/20 p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div className="text-sm font-semibold text-white">
                                {inlineEdit?.clipId === clip.id ? "Edit moment" : "Add a moment"}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setInlineAddForClipId(null);
                                  setInlineEdit(null);
                                }}
                                className="text-zinc-500 hover:text-white transition-colors"
                              >
                                Close
                              </button>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1">Start</div>
                                <div className="flex gap-2">
                                  <input
                                    type="number"
                                    value={inlineStartMin}
                                    placeholder="Min"
                                    className="w-full bg-black border border-zinc-700 p-2.5 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm"
                                    onChange={(e) => setInlineStartMin(e.target.value)}
                                  />
                                  <input
                                    type="number"
                                    value={inlineStartSec}
                                    placeholder="Sec"
                                    className="w-full bg-black border border-zinc-700 p-2.5 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm"
                                    onChange={(e) => setInlineStartSec(e.target.value)}
                                  />
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1">End</div>
                                <div className="flex gap-2">
                                  <input
                                    type="number"
                                    value={inlineEndMin}
                                    placeholder="Min"
                                    className="w-full bg-black border border-zinc-700 p-2.5 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm"
                                    onChange={(e) => setInlineEndMin(e.target.value)}
                                  />
                                  <input
                                    type="number"
                                    value={inlineEndSec}
                                    placeholder="Sec"
                                    className="w-full bg-black border border-zinc-700 p-2.5 rounded-xl outline-none focus:border-zinc-500 transition-colors text-sm"
                                    onChange={(e) => setInlineEndSec(e.target.value)}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="mt-3">
                              <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1">Note</div>
                              <textarea
                                value={inlineNote}
                                onChange={(e) => setInlineNote(e.target.value)}
                                placeholder="Why should someone watch this?"
                                className="w-full bg-black border border-zinc-700 p-3 rounded-xl h-20 outline-none resize-none focus:border-zinc-500 transition-colors text-sm"
                              />
                            </div>

                            <div className="mt-3">
                              <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2">Topic</div>
                              <div className="flex flex-wrap gap-2">
                                {CURATD_TOPICS.map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    onClick={() => setInlineTopic(t)}
                                    className={`text-xs px-3.5 py-1.5 rounded-full transition-all ${
                                      inlineTopic === t
                                        ? "bg-white text-black font-semibold"
                                        : "bg-zinc-800 text-zinc-500 hover:text-white border border-zinc-700/50"
                                    }`}
                                  >
                                    {t}
                                  </button>
                                ))}
                                {inlineTopic && !CURATD_TOPICS.includes(inlineTopic as any) ? (
                                  <button
                                    type="button"
                                    onClick={() => setInlineTopic(inlineTopic)}
                                    className="text-xs px-3.5 py-1.5 rounded-full bg-white font-semibold text-black"
                                  >
                                    {inlineTopic}
                                  </button>
                                ) : null}
                              </div>
                              <div className="mt-3 flex gap-2">
                                <input
                                  type="text"
                                  value={inlineCustomTopicDraft}
                                  onChange={(e) => setInlineCustomTopicDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      applyInlineCustomTopic();
                                    }
                                  }}
                                  placeholder="Add new topic"
                                  className="min-w-0 flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
                                  autoComplete="off"
                                />
                                <button
                                  type="button"
                                  onClick={() => applyInlineCustomTopic()}
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-lg font-semibold text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-700 hover:text-white"
                                  aria-label="Add new topic"
                                  title="Add topic"
                                >
                                  +
                                </button>
                              </div>
                            </div>

                            <div className="mt-4 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setInlineAddForClipId(null);
                                  setInlineEdit(null);
                                }}
                                className="text-sm font-semibold text-zinc-400 hover:text-white transition-colors px-3 py-2"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={inlineSubmitting}
                                onClick={() => void submitInlineMoment(clip)}
                                className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
                                  inlineSubmitting
                                    ? "bg-zinc-800 text-zinc-400 cursor-not-allowed"
                                    : "bg-white text-black hover:bg-zinc-200"
                                }`}
                              >
                                {inlineSubmitting ? "Saving..." : inlineEdit?.clipId === clip.id ? "Save" : "Add"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-zinc-800/70">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-[11px] font-mono font-semibold bg-emerald-500 text-white px-2.5 py-1 rounded-md">
                            {primaryMoment?.endTime
                              ? `${Math.floor((primaryMoment.startTime || 0) / 60)}:${String((primaryMoment.startTime || 0) % 60).padStart(2, "0")} — ${Math.floor((primaryMoment.endTime || 0) / 60)}:${String((primaryMoment.endTime || 0) % 60).padStart(2, "0")}`
                              : 'Full video'}
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
                                const savedRef = doc(db, "savedClips", `${user.uid}_${clip.id}`);
                                if (isSaved) {
                                  await deleteDoc(savedRef);
                                } else {
                                  await setDoc(savedRef, { userId: user.uid, clipId: clip.id, savedAt: serverTimestamp() });
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
                  </React.Fragment>
                );
              })
            )}
          </div>
        </div>
      </main>

      <SignInCuratorModal
        open={showAuthModal}
        onClose={closeAuthModal}
        title={authModalCopy.title}
        subtitle={authModalCopy.subtitle}
      />
      <CuratorRequiredModal open={showCuratorRequiredModal} onClose={() => setShowCuratorRequiredModal(false)} />

      {toastMessage ? (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-xl">
          {toastMessage}
        </div>
      ) : null}

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

              <div>
                <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2 block">Clip Type</label>
                <div className="inline-flex w-full rounded-xl border border-zinc-700 bg-black p-1">
                  <button
                    type="button"
                    onClick={() => setAudioOnly(false)}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      !audioOnly ? "bg-white text-black" : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    🎬 Video
                  </button>
                  <button
                    type="button"
                    onClick={() => setAudioOnly(true)}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      audioOnly ? "bg-white text-black" : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    🎧 Audio only
                  </button>
                </div>
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
                {topic ? (
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={() => setTopic("")}
                      className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-sm font-semibold text-emerald-300"
                    >
                      {topic}
                      <span aria-hidden>×</span>
                    </button>
                  </div>
                ) : null}
                <div className="relative" ref={topicPickerRef}>
                  <input
                    type="text"
                    value={topicInput}
                    onFocus={() => {
                      setTopicDropdownOpen(true);
                      void loadTopTopicDropdownOptions();
                    }}
                    onChange={(e) => {
                      setTopicInput(e.target.value);
                      setTopicDropdownOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const value = normalizeTopicName(topicInput);
                        if (filteredTopicOptions.length > 0) void selectTopicOption(filteredTopicOptions[0].name);
                        else if (value) void selectTopicOption(value);
                      }
                    }}
                    placeholder="Type a topic"
                    className="w-full rounded-full border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
                    autoComplete="off"
                  />
                  {topicDropdownOpen && !topic ? (
                    <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-2 shadow-xl">
                      {filteredTopicOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => void selectTopicOption(opt.name)}
                          className="block w-full rounded-xl px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900"
                        >
                          {opt.name}
                        </button>
                      ))}
                      {normalizeTopicName(topicInput) &&
                      !filteredTopicOptions.some((opt) => opt.name.toLowerCase() === normalizeTopicName(topicInput).toLowerCase()) ? (
                        <button
                          type="button"
                          onClick={() => void selectTopicOption(normalizeTopicName(topicInput))}
                          className="block w-full rounded-xl px-3 py-2 text-left text-sm text-emerald-300 hover:bg-zinc-900"
                        >
                          Create topic: {normalizeTopicName(topicInput)}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
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