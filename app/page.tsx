"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db, storage } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs, serverTimestamp, query, orderBy, onSnapshot, setDoc, where, limit, arrayUnion, Timestamp } from "firebase/firestore";
import { useAuth } from "./auth-context";
import { UsernameSetup, useUsername } from "./username-setup";
import { CuratorSearchBar } from "./curator-search-bar";
import { SignInCuratorModal } from "./sign-in-curator-modal";
import { CuratorRequiredModal } from "./curator-required-modal";
import { updateProfile } from "firebase/auth";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useUnreadMessageCount } from "./messages/use-unread-count";

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
    { uid: string; username: string | null; displayName: string | null; photoURL: string | null }[]
  >([]);
  const [shareClip, setShareClip] = useState<any | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const navPhotoInputRef = useRef<HTMLInputElement | null>(null);
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
    const savedQ = query(collection(db, "savedClips"), where("userId", "==", user.uid));
    const unsubscribeSaved = onSnapshot(savedQ, (snapshot) => {
      setSavedClips(
        snapshot.docs
          .map((d) => {
            const data = d.data() as any;
            return typeof data?.clipId === "string" ? data.clipId : null;
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

    const followsQ = query(collection(db, "follows"), where("followerUid", "==", user.uid));
    const unsubscribeFollows = onSnapshot(
      followsQ,
      (snapshot) => {
        const ids = snapshot.docs
          .map((d) => {
            const data = d.data() as any;
            return typeof data?.followingUid === "string" ? data.followingUid : null;
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
            const displayNameVal = typeof data?.displayName === "string" ? data.displayName : null;
            const photoURLVal = typeof data?.photoURL === "string" ? data.photoURL : null;
            return {
              uid,
              username: usernameVal,
              displayName: displayNameVal,
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
        username: string | null;
        displayName: string | null;
        photoURL: string | null;
      }[];

      cleaned.sort((a, b) => {
        const an = (a.displayName || a.username || "").toLowerCase();
        const bn = (b.displayName || b.username || "").toLowerCase();
        return an.localeCompare(bn);
      });

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
        displayName: user.displayName ?? null,
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
    if (!navMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = navMenuRef.current;
      if (el && !el.contains(e.target as Node)) setNavMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [navMenuOpen]);

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
    const totalStart = (parseInt(startMin) || 0) * 60 + (parseInt(startSec) || 0);
    const totalEnd = (parseInt(endMin) || 0) * 60 + (parseInt(endSec) || 0);
    const videoId = extractVideoId(url);

    setLoading(true);
    try {
      const moment = {
        id: newMomentId(),
        startTime: totalStart,
        endTime: totalEnd,
        note,
        topic,
        addedAt: Timestamp.now(),
      };

      // If editing, update the first moment (legacy UI behavior).
      if (editingClipId) {
        const snap = await getDoc(doc(db, "clips", editingClipId));
        const data = snap.exists() ? (snap.data() as any) : null;
        const moments = Array.isArray(data?.moments) ? [...data.moments] : [];
        if (moments.length === 0) moments.push(moment);
        else moments[0] = { ...moments[0], startTime: totalStart, endTime: totalEnd, note, topic };
        await updateDoc(doc(db, "clips", editingClipId), {
          videoUrl: url,
          videoId,
          title,
          channelName: channel,
          userId: user.uid,
          username: username ?? null,
          displayName: user.displayName || "Anonymous",
          createdAt: data?.createdAt ?? serverTimestamp(),
          moments,
        });
      } else {
        // Multi-clip structure: group by videoUrl + userId
        const existingQ = query(
          collection(db, "clips"),
          where("videoUrl", "==", url),
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
            username: username ?? null,
            displayName: user.displayName || "Anonymous",
            moments: arrayUnion(moment),
          });
        } else {
          await addDoc(collection(db, "clips"), {
            videoUrl: url,
            videoId,
            title,
            channelName: channel,
            userId: user.uid,
            username: username ?? null,
            displayName: user.displayName || "Anonymous",
            createdAt: serverTimestamp(),
            moments: [moment],
          });
        }
      }
      resetForm();
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
    setTopic(m?.topic || "Other");
    setCustomTopicDraft("");
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
    const feedClips = activeFeedTab === "following" ? followingClips : clips;
    const bySaved = showSaved ? feedClips.filter((c) => savedClips.includes(c.id)) : feedClips;
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
  }, [clips, followingClips, activeFeedTab, showSaved, savedClips, topicSearch]);

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

  const activeFeedClipCount = activeFeedTab === "following" ? followingClips.length : clips.length;

  const getClipHandle = (clip: any) => {
    const handleFromClip =
      typeof clip?.username === "string" && clip.username.trim()
        ? clip.username.trim().toLowerCase()
        : null;
    const handleFromLookup =
      !handleFromClip && typeof clip?.userId === "string"
        ? usernamesByUid[clip.userId] ?? null
        : null;
    return handleFromClip || handleFromLookup;
  };

  const getShareUrl = (clip: any) => `https://curetd.vercel.app/clip/${clip.id}`;

  const showToast = (message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 1800);
  };

  const copyShareLink = async (clip: any) => {
    const url = getShareUrl(clip);
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied!");
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      showToast("Link copied!");
    }
  };

  const openXShare = (clip: any) => {
    const url = getShareUrl(clip);
    const title = clip?.title || "Untitled clip";
    const handle = getClipHandle(clip) || "curator";
    const text = `${title} — curated by @${handle} on Curatd ${url}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  };

  const openWhatsAppShare = (clip: any) => {
    const url = getShareUrl(clip);
    const title = clip?.title || "Untitled clip";
    const text = `Check out this clip: ${title} ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };
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
                title={user.displayName || "Account"}
              >
                {navPhotoUrl ? (
                  <img
                    src={navPhotoUrl}
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
                          {(p.displayName || p.username || "U").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-white truncate">
                          {p.displayName || "Anonymous"}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate">
                          {p.username ? `@${p.username}` : ""}
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
                  onClick={() => setTopicSearch("")}
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
                    onChange={(e) => setTopicSearch(e.target.value)}
                    placeholder="Search topics..."
                    autoComplete="off"
                    className="w-full rounded-full border border-zinc-700 bg-zinc-900 py-2 pl-8 pr-3 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
                  />
                </div>

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
                            onClick={() => setTopicSearch(t.label)}
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
                              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-200 border border-zinc-700/80">
                                {primaryMoment.topic}
                              </span>
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
                                return (
                                  <Link
                                    href={`/${handle}`}
                                    className="font-medium text-zinc-300 hover:text-emerald-400 hover:underline"
                                  >
                                    @{handle}
                                  </Link>
                                );
                              }
                              return (
                                <span className="text-zinc-300 font-medium">
                                  {clip.userDisplayName || "Unknown curator"}
                                </span>
                              );
                            })()}
                            </span>
                            {clip.createdAt ? (
                              <span className="text-xs text-zinc-500">
                                {formatRelativeTime(clip.createdAt)}
                              </span>
                            ) : null}
                          </div>
                          {primaryMoment?.note ? (
                            <div className="text-base text-zinc-100 font-medium italic border-l-2 border-emerald-500 pl-3 mt-2 line-clamp-3">
                              &ldquo;{primaryMoment.note}&rdquo;
                            </div>
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
                                              {String(c?.displayName || "U").slice(0, 1).toUpperCase()}
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
                                                <span className="text-xs font-semibold text-zinc-200">
                                                  {c?.displayName || "User"}
                                                </span>
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
                          <button
                            type="button"
                            onClick={() => setShareClip(clip)}
                            className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-zinc-800 transition-colors"
                            aria-label="Share clip"
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
                              <button
                                type="button"
                                onClick={() => {
                                  if (!vid) return;
                                  setPlayingMoment({ clipId: clip.id, momentId: mid });
                                }}
                                className="min-w-0 flex-1 text-left"
                                aria-label="Play moment"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  {m?.topic ? (
                                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-200 border border-zinc-700/80">
                                      {m.topic}
                                    </span>
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
                              </button>

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
                                {TOPICS.map((t) => (
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
                                {inlineTopic && !TOPICS.includes(inlineTopic) ? (
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
                );
              })
            )}
          </div>
        </div>
      </main>

      <SignInCuratorModal open={showAuthModal} onClose={closeAuthModal} />
      <CuratorRequiredModal open={showCuratorRequiredModal} onClose={() => setShowCuratorRequiredModal(false)} />

      {toastMessage ? (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-xl">
          {toastMessage}
        </div>
      ) : null}

      {shareClip ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setShareClip(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white">Share clip</h2>
                <p className="mt-1 line-clamp-1 text-sm text-zinc-500">
                  {shareClip.title || "Untitled clip"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShareClip(null)}
                className="shrink-0 text-2xl leading-none text-zinc-500 transition-colors hover:text-white"
                aria-label="Close share modal"
              >
                ×
              </button>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void copyShareLink(shareClip)}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-black/30 px-4 py-3 text-left text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800/70"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-zinc-200">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M9 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                Copy Link
              </button>

              <button
                type="button"
                onClick={() => openXShare(shareClip)}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-black/30 px-4 py-3 text-left text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800/70"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-zinc-200">
                  <span className="text-sm font-black">X</span>
                </span>
                Share to X/Twitter
              </button>

              <button
                type="button"
                onClick={() => openWhatsAppShare(shareClip)}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-black/30 px-4 py-3 text-left text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800/70"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-zinc-200">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M5.5 19.5 6.7 16A7.5 7.5 0 1 1 9 18.2l-3.5 1.3Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M9.5 8.8c.2 2.7 2 4.6 4.7 5l1-1.1 1.5.8c.2.1.3.4.2.6-.4 1-1.1 1.6-2.2 1.5-3.6-.2-6.3-2.8-6.7-6.5-.1-1 .5-1.8 1.5-2.1.2-.1.5 0 .6.2l.8 1.5-1.4 1.1Z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                Share to WhatsApp
              </button>
            </div>
          </div>
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