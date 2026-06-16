"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../auth-context";
import { SignInCuratorModal } from "../sign-in-curator-modal";
import { CuratorRequiredModal } from "../curator-required-modal";
import { getConversationId, markConversationRead, sendMessage, type ConversationDoc } from "./messaging";
import { sendMessage as sendMessageViaFirestoreUtil, subscribeToMessages } from "../lib/firestore";
import { NewMessageModal } from "../components/NewMessageModal";
import { Navbar } from "../components/Navbar";

const YOUTUBE_URL_RE = /(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function parseYouTubeTimestampSeconds(url: string): number | null {
  try {
    const u = url.startsWith("http") ? new URL(url) : new URL(`https://${url}`);
    const tParam = u.searchParams.get("t");
    const raw = (tParam && tParam.trim()) ? tParam : (u.searchParams.get("start") || null);
    if (!raw) return null;
    const v = raw.trim().toLowerCase();
    if (!v) return null;
    if (/^\d+$/.test(v)) return Math.max(0, Number(v));
    // Supports: 8m5s, 1h8m5s, 90s, 3m, 1h
    const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m) return null;
    const hasAnyUnit = Boolean(m[1] || m[2] || m[3]);
    if (!hasAnyUnit) return null;
    const h = m[1] ? Number(m[1]) : 0;
    const mm = m[2] ? Number(m[2]) : 0;
    const s = m[3] ? Number(m[3]) : 0;
    const total = h * 3600 + mm * 60 + s;
    return Number.isFinite(total) ? Math.max(0, total) : null;
  } catch {
    // If URL parsing fails, try a simple &t=... extraction
    const simple = url.match(/(?:\?|&)t=([^&]+)/i) || url.match(/(?:\?|&)start=([^&]+)/i);
    if (!simple?.[1]) return null;
    const v = String(simple[1]).trim().toLowerCase();
    if (/^\d+$/.test(v)) return Math.max(0, Number(v));
    const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m) return null;
    const hasAnyUnit = Boolean(m[1] || m[2] || m[3]);
    if (!hasAnyUnit) return null;
    const h = m[1] ? Number(m[1]) : 0;
    const mm = m[2] ? Number(m[2]) : 0;
    const s = m[3] ? Number(m[3]) : 0;
    const total = h * 3600 + mm * 60 + s;
    return Number.isFinite(total) ? Math.max(0, total) : null;
  }
}

function hmsFromSeconds(totalSeconds: number) {
  const t = Math.max(0, Math.floor(totalSeconds || 0));
  const hr = Math.floor(t / 3600);
  const min = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return { hr: String(hr), min: String(min), sec: String(sec) };
}

async function fetchYouTubeOembed(videoId: string): Promise<{ title: string; author_name: string } | null> {
  if (!videoId) return null;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const title = data && typeof data?.title === "string" ? String(data.title) : "";
    const author_name = data && typeof data?.author_name === "string" ? String(data.author_name) : "";
    if (!title.trim() && !author_name.trim()) return null;
    return { title, author_name };
  } catch {
    return null;
  }
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

  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfToday - ((now.getDay() + 6) % 7) * 24 * 60 * 60 * 1000; // Monday
  const inThisWeek = ms >= startOfWeek;

  if (sameDay) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
  }
  if (inThisWeek) {
    return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
}

async function hasAtLeastOneClip(uid: string) {
  const snap = await getDocs(query(collection(db, "clips"), where("userId", "==", uid), limit(1)));
  return !snap.empty;
}

type UserMini = {
  uid: string;
  username?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  profilePhoto?: string | null;
};

function profileImageUrl(p: UserMini | null | undefined): string | null {
  const url = p?.photoURL || p?.profilePhoto;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function toSeconds(hr: string, min: string, sec: string) {
  const h = Math.max(0, Number.parseInt(String(hr || "0"), 10) || 0);
  const m = Math.max(0, Number.parseInt(String(min || "0"), 10) || 0);
  const s = Math.max(0, Number.parseInt(String(sec || "0"), 10) || 0);
  return h * 3600 + m * 60 + s;
}

function formatMmSs(totalSeconds: number | null | undefined) {
  const t = typeof totalSeconds === "number" && Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : null;
  if (t == null) return "";
  const mm = Math.floor(t / 60);
  const ss = t % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function ClipFromLinkModal(props: {
  open: boolean;
  videoId: string | null;
  youtubeUrl: string | null;
  initialStartHr?: string;
  initialStartMin?: string;
  initialStartSec?: string;
  sending?: boolean;
  onCancel: () => void;
  onSend: (args: { audioOnly: boolean; startSeconds: number; endSeconds: number }) => void;
}) {
  const { open, videoId, youtubeUrl, onCancel, onSend, initialStartHr, initialStartMin, initialStartSec, sending } = props;
  const [audioOnly, setAudioOnly] = useState(false);
  const [startHr, setStartHr] = useState("");
  const [startMin, setStartMin] = useState("");
  const [startSec, setStartSec] = useState("");
  const [endHr, setEndHr] = useState("");
  const [endMin, setEndMin] = useState("");
  const [endSec, setEndSec] = useState("");
  const [timeError, setTimeError] = useState("");

  useEffect(() => {
    if (!open) return;
    setAudioOnly(false);
    setStartHr("");
    setStartMin("");
    setStartSec("");
    setEndHr("");
    setEndMin("");
    setEndSec("");
    setTimeError("");

    if (typeof initialStartHr === "string" && initialStartHr.trim() !== "") setStartHr(initialStartHr);
    if (typeof initialStartMin === "string" && initialStartMin.trim() !== "") setStartMin(initialStartMin);
    if (typeof initialStartSec === "string" && initialStartSec.trim() !== "") setStartSec(initialStartSec);
  }, [open]);

  if (!open) return null;

  const thumb = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {thumb ? (
          <img src={thumb} alt="" className="w-full aspect-video object-cover border-b border-zinc-800" />
        ) : (
          <div className="w-full aspect-video bg-zinc-900 border-b border-zinc-800" />
        )}

        <div className="p-5">
          <div className="text-sm font-bold text-white">Create clip from link</div>
          <div className="mt-1 text-xs text-zinc-500 truncate">{youtubeUrl || " "}</div>

          <div className="mt-4">
            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2">Clip type</div>
            <div className="inline-flex w-full rounded-xl border border-zinc-800 bg-black p-1">
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

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2">Start time</div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  min={0}
                  value={startHr}
                  onChange={(e) => setStartHr(e.target.value)}
                  className="h-11 rounded-xl border border-zinc-800 bg-black px-3 text-sm text-white outline-none focus:border-zinc-600"
                  placeholder="Hr"
                />
                <input
                  type="number"
                  min={0}
                  value={startMin}
                  onChange={(e) => setStartMin(e.target.value)}
                  className="h-11 rounded-xl border border-zinc-800 bg-black px-3 text-sm text-white outline-none focus:border-zinc-600"
                  placeholder="Min"
                />
                <input
                  type="number"
                  min={0}
                  value={startSec}
                  onChange={(e) => setStartSec(e.target.value)}
                  className="h-11 rounded-xl border border-zinc-800 bg-black px-3 text-sm text-white outline-none focus:border-zinc-600"
                  placeholder="Sec"
                />
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2">End time</div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  min={0}
                  value={endHr}
                  onChange={(e) => setEndHr(e.target.value)}
                  className="h-11 rounded-xl border border-zinc-800 bg-black px-3 text-sm text-white outline-none focus:border-zinc-600"
                  placeholder="Hr"
                />
                <input
                  type="number"
                  min={0}
                  value={endMin}
                  onChange={(e) => setEndMin(e.target.value)}
                  className="h-11 rounded-xl border border-zinc-800 bg-black px-3 text-sm text-white outline-none focus:border-zinc-600"
                  placeholder="Min"
                />
                <input
                  type="number"
                  min={0}
                  value={endSec}
                  onChange={(e) => setEndSec(e.target.value)}
                  className="h-11 rounded-xl border border-zinc-800 bg-black px-3 text-sm text-white outline-none focus:border-zinc-600"
                  placeholder="Sec"
                />
              </div>
            </div>
          </div>
          {timeError ? (
            <div className="mt-2 text-xs font-semibold text-red-400">
              {timeError}
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="text-sm font-semibold text-zinc-400 hover:text-white transition-colors px-3 py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const startSeconds = toSeconds(startHr, startMin, startSec);
                const endSeconds = toSeconds(endHr, endMin, endSec);
                if (endSeconds <= startSeconds) {
                  setTimeError("End time must be after start time.");
                  return;
                }
                setTimeError("");
                onSend({ audioOnly, startSeconds, endSeconds });
              }}
              disabled={Boolean(sending)}
              className="rounded-2xl px-5 py-3 text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {sending ? "Sending..." : "Send Clip"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MessagesClient() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showCuratorRequiredModal, setShowCuratorRequiredModal] = useState(false);
  const [newMessageOpen, setNewMessageOpen] = useState(false);

  const [isCurator, setIsCurator] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<Array<{ id: string; data: ConversationDoc }>>([]);
  const [profilesByUid, setProfilesByUid] = useState<Record<string, UserMini>>({});
  const usernameCacheRef = useRef<Record<string, UserMini>>({});
  const missingConversationFetchRef = useRef<Record<string, boolean>>({});
  const [openConversationMenuId, setOpenConversationMenuId] = useState<string | null>(null);
  const [confirmDeleteConversationId, setConfirmDeleteConversationId] = useState<string | null>(null);

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      senderId: string;
      text: string;
      createdAt: any;
      read?: boolean;
      type?: "text" | "clip" | "youtube";
      clip?: { title?: string; videoId?: string; startTime?: number; endTime?: number; topic?: string; channel?: string };
      youtubeUrl?: string;
    }>
  >([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [clipFromLinkOpen, setClipFromLinkOpen] = useState(false);
  const [pendingYoutubeUrl, setPendingYoutubeUrl] = useState<string | null>(null);
  const [pendingVideoId, setPendingVideoId] = useState<string | null>(null);
  const [pendingStartHr, setPendingStartHr] = useState<string>("");
  const [pendingStartMin, setPendingStartMin] = useState<string>("");
  const [pendingStartSec, setPendingStartSec] = useState<string>("");
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const [clipFromLinkSending, setClipFromLinkSending] = useState(false);
  const [dismissedClipOverlayById, setDismissedClipOverlayById] = useState<Record<string, boolean>>({});
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(() => new Set());
  const [confirmDeleteMessageId, setConfirmDeleteMessageId] = useState<string | null>(null);
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [clipSavedToastByMessageId, setClipSavedToastByMessageId] = useState<Record<string, boolean>>({});
  const [clipCuratedToastByMessageId, setClipCuratedToastByMessageId] = useState<Record<string, boolean>>({});
  const savedClipKeyRef = useRef<Set<string>>(new Set());
  const oembedCacheRef = useRef<Record<string, { title: string; author_name: string } | null>>({});
  const [oembedByVideoId, setOembedByVideoId] = useState<
    Record<string, { status: "loading" } | { status: "ready"; title: string; authorName: string } | { status: "error" }>
  >({});

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveConversationId(searchParams?.get("c") || null);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setIsCurator(null);
    if (!user) return;
    // Messaging is available to any signed-in user (no curator gate).
    // Keep the original curator-check function in codebase, but do not use it to gate messaging.
    if (!cancelled) setIsCurator(true);
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      return;
    }
    const q = query(
      collection(db, "conversations"),
      where("participants", "array-contains", user.uid),
      orderBy("lastMessageAt", "desc"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setConversations(snap.docs.map((d) => ({ id: d.id, data: d.data() as any })));
      },
      () => {
        setConversations([]);
      },
    );
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user || !activeConversationId) return;
    if (conversations.some((c) => c.id === activeConversationId)) return;
    if (missingConversationFetchRef.current[activeConversationId]) return;
    missingConversationFetchRef.current[activeConversationId] = true;

    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, "conversations", activeConversationId));
        if (cancelled) return;
        if (!snap.exists()) return;
        setConversations((prev) => {
          if (prev.some((c) => c.id === activeConversationId)) return prev;
          return [{ id: activeConversationId, data: snap.data() as any }, ...prev];
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid, activeConversationId, conversations]);

  useEffect(() => {
    let cancelled = false;
    async function hydrateProfiles(uids: string[]) {
      const next: Record<string, UserMini> = {};
      await Promise.all(
        uids.map(async (uid) => {
          if (profilesByUid[uid]) return;
          if (usernameCacheRef.current[uid]) {
            next[uid] = usernameCacheRef.current[uid];
            return;
          }
          try {
            const snap = await getDoc(doc(db, "publicProfiles", uid));
            const d = snap.exists() ? (snap.data() as any) : null;
            const pic = d?.photoURL ?? d?.profilePhoto ?? null;
            next[uid] = {
              uid,
              username: d?.username ?? null,
              displayName: d?.displayName ?? null,
              photoURL: typeof pic === "string" ? pic : null,
              profilePhoto: typeof d?.profilePhoto === "string" ? d.profilePhoto : null,
            };
          } catch {
            next[uid] = { uid, username: null, displayName: null, photoURL: null, profilePhoto: null };
          }
        }),
      );
      if (cancelled) return;
      if (Object.keys(next).length > 0) {
        for (const [uid, v] of Object.entries(next)) {
          usernameCacheRef.current[uid] = v;
        }
        setProfilesByUid((prev) => ({ ...prev, ...next }));
      }
    }

    const others = new Set<string>();
    if (user) {
      for (const c of conversations) {
        const parts = Array.isArray(c.data.participants) ? c.data.participants : [];
        const other = parts.find((p) => p && p !== user.uid);
        if (other) others.add(other);
      }
    }
    void hydrateProfiles([...others]);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, user?.uid]);

  const activeConversation = useMemo(() => {
    if (!activeConversationId) return null;
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [conversations, activeConversationId]);

  const otherParticipant = useMemo(() => {
    if (!user || !activeConversation) return null;
    const parts = Array.isArray(activeConversation.data.participants) ? activeConversation.data.participants : [];
    const otherUid = parts.find((p) => p && p !== user.uid) || null;
    return otherUid ? profilesByUid[otherUid] ?? { uid: otherUid } : null;
  }, [activeConversation, profilesByUid, user]);

  useEffect(() => {
    if (!user || !activeConversationId) {
      setMessages([]);
      return;
    }

    const unsub = subscribeToMessages(activeConversationId, (next) => {
      setMessages(next as any);

      // Keep existing behavior: mark message docs as read (best-effort)
      const toMark = (next || [])
        .filter((m: any) => m?.read === false && m?.senderId && m.senderId !== user.uid)
        .slice(0, 50)
        .map((m: any) => m.id);
      if (toMark.length > 0) {
        void markConversationRead({ db, conversationId: activeConversationId, viewerId: user.uid, messageIdsToMarkRead: toMark });
      } else {
        void markConversationRead({ db, conversationId: activeConversationId, viewerId: user.uid, messageIdsToMarkRead: [] }).catch(
          () => {},
        );
      }
    });

    return () => unsub();
  }, [user?.uid, activeConversationId]);

  useEffect(() => {
    if (!user || !activeConversationId) return;
    // Explicitly clear unreadBy badge for this conversation on open
    void updateDoc(doc(db, "conversations", activeConversationId), { [`unreadBy.${user.uid}`]: 0 }).catch(() => {});
  }, [user?.uid, activeConversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeConversationId]);

  const visibleMessages = useMemo(() => {
    if (!hiddenMessageIds || hiddenMessageIds.size === 0) return messages;
    return messages.filter((m) => !hiddenMessageIds.has(m.id));
  }, [messages, hiddenMessageIds]);

  useEffect(() => {
    const ids = new Set<string>();
    for (const m of messages as any[]) {
      if (m?.type !== "clip") continue;
      const vid = typeof m?.clip?.videoId === "string" ? m.clip.videoId : "";
      if (!vid) continue;
      ids.add(vid);
    }
    for (const videoId of ids) {
      if (oembedCacheRef.current[videoId] !== undefined) continue;
      if (oembedByVideoId[videoId]?.status === "loading") continue;

      oembedCacheRef.current[videoId] = null; // reserved to prevent duplicate fetches
      setOembedByVideoId((prev) => ({ ...prev, [videoId]: { status: "loading" } }));

      void fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("oembed failed"))))
        .then((data) => {
          const title = typeof data?.title === "string" ? data.title : "";
          const author = typeof data?.author_name === "string" ? data.author_name : "";
          const ok = title.trim() !== "" || author.trim() !== "";
          oembedCacheRef.current[videoId] = ok ? { title, author_name: author } : null;
          setOembedByVideoId((prev) => ({
            ...prev,
            [videoId]: ok ? { status: "ready", title, authorName: author } : { status: "error" },
          }));
        })
        .catch(() => {
          oembedCacheRef.current[videoId] = null;
          setOembedByVideoId((prev) => ({ ...prev, [videoId]: { status: "error" } }));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const totalUnread = useMemo(() => {
    if (!user) return 0;
    let n = 0;
    for (const c of conversations) n += Math.max(0, Number((c.data as any)?.unreadBy?.[user.uid] ?? 0));
    return n;
  }, [conversations, user]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      router.push(`/messages?c=${encodeURIComponent(id)}`);
    },
    [router],
  );

  const handleSend = useCallback(async () => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    if (isCurator === false) {
      // Gate removed: allow any signed-in user to message.
    }
    if (!activeConversationId || !activeConversation) return;

    const parts = (activeConversation.data.participants as any) as [string, string] | undefined;
    if (!Array.isArray(parts) || parts.length < 2) return;

    setSending(true);
    try {
      const raw = String(draft || "").trim();
      const ytMatch = raw.match(YOUTUBE_URL_RE);
      const extractedVideoId = ytMatch?.[4] ? String(ytMatch[4]) : null;
      const normalizedYoutubeUrl =
        ytMatch && raw && !raw.startsWith("http") ? `https://${raw}` : raw;

      try {
        if (ytMatch && extractedVideoId) {
          const ts = parseYouTubeTimestampSeconds(normalizedYoutubeUrl);
          if (typeof ts === "number" && Number.isFinite(ts)) {
            const hms = hmsFromSeconds(ts);
            setPendingStartHr(hms.hr);
            setPendingStartMin(hms.min);
            setPendingStartSec(hms.sec);
          } else {
            setPendingStartHr("");
            setPendingStartMin("");
            setPendingStartSec("");
          }
          setPendingYoutubeUrl(normalizedYoutubeUrl);
          setPendingVideoId(extractedVideoId);
          setClipFromLinkOpen(true);
          return;
        }
        await sendMessageViaFirestoreUtil(activeConversationId, user.uid, { type: "text", text: draft });
      } catch (e) {
        // Fallback to legacy helper (kept for safety)
        await sendMessage({
          db,
          conversationId: activeConversationId,
          participants: [String(parts[0]), String(parts[1])] as [string, string],
          senderId: user.uid,
          text: draft,
        });
      }
      setDraft("");
    } finally {
      setSending(false);
    }
  }, [user, isCurator, activeConversationId, activeConversation, draft]);

  return (
    <div className="h-screen overflow-hidden bg-black text-white font-sans flex flex-col">
      <Navbar user={user} unreadCount={totalUnread} onSignIn={() => setShowAuthModal(true)} hideAddClip={true} />

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-[300px] shrink-0 bg-zinc-950 border-r border-zinc-800 min-h-0 flex flex-col">
          <div className="shrink-0 h-14 px-4 flex items-center justify-between border-b border-zinc-800">
            <div className="text-sm font-bold text-white">Messages</div>
            <button
              type="button"
              onClick={() => {
                setNewMessageOpen(true);
              }}
              className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900/60 hover:text-white transition-colors"
              aria-label="Compose"
              title="Compose"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 20h9"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {!user ? (
              <div className="h-full flex items-center justify-center p-6">
                <div className="text-sm text-zinc-500">Sign in to view your conversations.</div>
              </div>
            ) : conversations.length === 0 ? (
              <div className="h-full flex items-center justify-center p-6">
                <div className="text-sm text-zinc-500">No conversations yet.</div>
              </div>
            ) : (
              <div className="p-3 space-y-1">
                {conversations.map((c) => {
                  const data: any = c.data as any;
                  const isGroup = Boolean(data?.isGroup);
                  const groupName = typeof data?.groupName === "string" ? data.groupName : "";
                  const parts = Array.isArray(data?.participants) ? data.participants : [];
                  const otherUid = user ? (parts.find((p: string) => p && p !== user.uid) || null) : null;
                  const other = otherUid ? profilesByUid[otherUid] : null;

                  const displayName = isGroup
                    ? (groupName || "Group")
                    : other?.username
                      ? `@${other.username}`
                      : "Unknown";
                  const initial = isGroup ? "G" : String(other?.username || "U").slice(0, 1).toUpperCase();
                  const rowPhoto = !isGroup ? profileImageUrl(other ?? undefined) : null;

                  const unread = user ? Math.max(0, Number(data?.unreadBy?.[user.uid] ?? 0)) : 0;
                  const active = c.id === activeConversationId;
                  const preview = typeof data?.lastMessage === "string" && data.lastMessage.trim() ? data.lastMessage : "—";
                  const ts = formatRelativeTime(data?.lastMessageAt);

                  return (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectConversation(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelectConversation(c.id);
                        }
                      }}
                      className={`group w-full text-left rounded-2xl px-4 py-4 border transition-colors cursor-pointer ${
                        active
                          ? "border-emerald-500/60 bg-emerald-500/15 shadow-[0_0_0_1px_rgba(74,222,128,0.15)]"
                          : "border-transparent hover:bg-zinc-900/70 hover:border-zinc-800/80"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {rowPhoto ? (
                          <img
                            src={rowPhoto}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-full border border-zinc-700 object-cover"
                          />
                        ) : (
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-xs font-bold ${
                              isGroup ? "bg-indigo-500 text-black" : "bg-emerald-500 text-black"
                            }`}
                          >
                            {initial}
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-sm font-bold text-white truncate">{displayName}</div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-[11px] text-zinc-500 tabular-nums group-hover:hidden">{ts}</div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setConfirmDeleteConversationId(null);
                                  setOpenConversationMenuId((prev) => (prev === c.id ? null : c.id));
                                }}
                                className="hidden group-hover:inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:bg-zinc-900"
                                aria-label="Conversation options"
                                title="Options"
                              >
                                …
                              </button>
                            </div>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <div className="text-xs text-zinc-500 truncate">{preview}</div>
                            {unread > 0 ? (
                              <span className="shrink-0 h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(74,222,128,0.55)]" />
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {openConversationMenuId === c.id ? (
                        <div
                          className="relative"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <div className="absolute right-0 top-0 z-20 mt-2 w-44 rounded-2xl border border-zinc-800 bg-zinc-950 p-2 shadow-xl">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setConfirmDeleteConversationId(c.id);
                              }}
                              className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-900/70"
                            >
                              <span className="text-zinc-400" aria-hidden>🗑</span>
                              Delete conversation
                            </button>

                            {confirmDeleteConversationId === c.id ? (
                              <div className="mt-2 rounded-xl border border-zinc-800 bg-black/30 p-2">
                                <div className="text-[11px] font-semibold text-zinc-200">Delete?</div>
                                <div className="mt-2 flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setConfirmDeleteConversationId(null);
                                    }}
                                    className="text-[11px] font-semibold text-zinc-400 hover:text-white"
                                  >
                                    No
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async (e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setConfirmDeleteConversationId(null);
                                      setOpenConversationMenuId(null);

                                      // Optimistically remove from UI
                                      setConversations((prev) => prev.filter((x) => x.id !== c.id));
                                      if (activeConversationId === c.id) {
                                        setActiveConversationId(null);
                                        router.push("/messages");
                                      }

                                      try {
                                        const snap = await getDocs(collection(db, "conversations", c.id, "messages"));
                                        await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, "conversations", c.id, "messages", d.id))));
                                      } catch {
                                        // ignore
                                      }

                                      try {
                                        await deleteDoc(doc(db, "conversations", c.id));
                                      } catch {
                                        // ignore
                                      }
                                    }}
                                    className="text-[11px] font-semibold text-red-300 hover:text-red-200"
                                  >
                                    Yes
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {!user ? (
            <div className="flex-1 flex items-center justify-center p-10">
              <div className="max-w-md w-full rounded-3xl border border-zinc-800 bg-zinc-900/20 p-8 text-center">
                <div className="text-lg font-semibold">Sign in to message curators</div>
                <div className="text-sm text-zinc-500 mt-2">Messages are private between curators.</div>
                <button
                  type="button"
                  onClick={() => setShowAuthModal(true)}
                  className="mt-6 w-full font-bold py-4 rounded-xl transition-all text-sm bg-white text-black hover:bg-zinc-200"
                >
                  Sign in with Google
                </button>
              </div>
            </div>
          ) : !activeConversationId || !activeConversation ? (
            <div className="flex-1 flex items-center justify-center p-10">
              <div className="text-sm text-zinc-500">Select a conversation.</div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {(() => {
                const data: any = activeConversation?.data as any;
                const isGroup = Boolean(data?.isGroup);
                const groupName = typeof data?.groupName === "string" ? data.groupName : "";
                const title = isGroup
                  ? (groupName || "Group")
                  : otherParticipant?.username
                    ? `@${otherParticipant.username}`
                    : "Conversation";

                const avatarLetter = isGroup ? "G" : String(otherParticipant?.username || "U").slice(0, 1).toUpperCase();
                const headerPhoto = !isGroup ? profileImageUrl(otherParticipant as UserMini | undefined) : null;

                return (
                  <div className="shrink-0 border-b border-zinc-800 px-5 py-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-3">
                      {headerPhoto ? (
                        <img
                          src={headerPhoto}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-full border border-zinc-700 object-cover"
                        />
                      ) : (
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-xs font-bold ${
                            isGroup ? "bg-indigo-500 text-black" : "bg-emerald-500 text-black"
                          }`}
                        >
                          {avatarLetter}
                        </div>
                      )}
                      <div className="min-w-0 flex items-center gap-2">
                        <div className="text-sm font-bold text-white truncate">{title}</div>
                        {isGroup ? (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300">
                            Group
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {isCurator === false ? (
                      <button
                        type="button"
                        onClick={() => setShowCuratorRequiredModal(true)}
                        className="text-xs font-semibold px-3 py-2 rounded-full border border-zinc-700 text-zinc-300 hover:bg-zinc-900/60 transition-colors"
                      >
                        Curator required
                      </button>
                    ) : null}
                  </div>
                );
              })()}

              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-sm text-zinc-500">Say hi.</div>
                  </div>
                ) : (
                  visibleMessages.map((m, idx) => {
                    const mine = user && m.senderId === user.uid;
                    const prev = idx > 0 ? visibleMessages[idx - 1] : null;
                    const sameSenderAsPrev = Boolean(prev && prev.senderId === m.senderId);
                    const anyM: any = m as any;
                    const type: "text" | "clip" | "youtube" | undefined = anyM?.type;
                    const clip = anyM?.clip;
                    const youtubeUrl = typeof anyM?.youtubeUrl === "string" ? anyM.youtubeUrl : null;

                    const bubbleBase =
                      "max-w-xs sm:max-w-sm rounded-2xl px-4 py-2 text-sm shadow-sm";
                    const bubbleMine = "bg-emerald-500 text-white border border-emerald-400/30";
                    const bubbleTheirs = "bg-[#1a1a1a] text-white border border-zinc-800";

                    const clipVideoId = typeof clip?.videoId === "string" ? clip.videoId : "";
                    const thumb = clipVideoId ? `https://img.youtube.com/vi/${clipVideoId}/mqdefault.jpg` : "";
                    const isAudioOnly = typeof clip?.topic === "string" && clip.topic === "audio-only";
                    const meta = clipVideoId ? oembedByVideoId[clipVideoId] : undefined;
                    const savedKey =
                      user && type === "clip" && clipVideoId && typeof clip?.startTime === "number"
                        ? `${user.uid}|${clipVideoId}|${Math.floor(clip.startTime)}`
                        : null;
                    const isSaved = savedKey ? savedClipKeyRef.current.has(savedKey) : false;

                    return (
                      <div
                        key={m.id}
                        className={`flex ${mine ? "justify-end" : "justify-start"} ${sameSenderAsPrev ? "mt-1.5" : idx === 0 ? "" : "mt-4"}`}
                      >
                        <div className={`group flex max-w-[85%] flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}>
                          <div className={`${bubbleBase} ${mine ? bubbleMine : bubbleTheirs}`}>
                            {type === "clip" && clip ? (
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  setPlayingClipId((prevId) => (prevId === m.id ? null : m.id));
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setPlayingClipId((prevId) => (prevId === m.id ? null : m.id));
                                  }
                                }}
                                className="block w-full text-left cursor-pointer"
                                title={playingClipId === m.id ? "Close" : "Play"}
                              >
                                <div className="space-y-2">
                                  {thumb ? (
                                    <div className="overflow-hidden rounded-xl border border-white/10">
                                      <div className="relative overflow-hidden rounded-2xl">
                                        {playingClipId === m.id ? (
                                          <>
                                            <iframe
                                              src={`https://www.youtube.com/embed/${clipVideoId}?start=${Math.max(0, Math.floor(Number(clip?.startTime || 0)))}&end=${Math.max(0, Math.floor(Number(clip?.endTime || 0)))}&autoplay=1&controls=0&modestbranding=1&rel=0&fs=0&iv_load_policy=3&disablekb=1&playsinline=1`}
                                              className="aspect-video w-full max-w-[280px] sm:max-w-sm border-0"
                                              allow="autoplay; encrypted-media; picture-in-picture"
                                              title="YouTube player"
                                            />
                                            {!dismissedClipOverlayById[m.id] ? (
                                              <div
                                                className="absolute inset-0 flex items-center justify-center bg-black/20"
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  setDismissedClipOverlayById((prevMap) => ({ ...prevMap, [m.id]: true }));
                                                }}
                                              >
                                                <div className="h-14 w-14 rounded-full bg-black/70 flex items-center justify-center text-white text-lg font-bold">
                                                  ▶
                                                </div>
                                              </div>
                                            ) : null}
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setPlayingClipId(null);
                                              }}
                                              className="absolute right-2 top-2 inline-flex items-center justify-center rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-black/80"
                                              aria-label="Close player"
                                              title="Close"
                                            >
                                              ✕ Close
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            <img
                                              src={thumb}
                                              alt=""
                                              className="aspect-video w-full max-w-[280px] object-cover sm:max-w-sm"
                                            />
                                            <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold text-white">
                                              ▶ Play
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : null}

                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      {meta?.status === "ready" ? (
                                        <>
                                          <div className="font-semibold leading-snug text-white truncate">
                                            {meta.title || "[YouTube]"}
                                          </div>
                                          <div
                                            className={`mt-0.5 text-[11px] truncate ${mine ? "text-black/60" : "text-zinc-400"}`}
                                          >
                                            {meta.authorName || " "}
                                          </div>
                                        </>
                                      ) : meta?.status === "loading" ? (
                                        <div className="text-xs text-zinc-500">Loading...</div>
                                      ) : (
                                        <div className="font-semibold leading-snug text-white line-clamp-2">
                                          {typeof clip?.title === "string" && clip.title.trim() ? clip.title : "[Clip]"}
                                        </div>
                                      )}
                                    </div>
                                    {isAudioOnly ? (
                                      <span className="shrink-0 rounded-full bg-zinc-900/70 border border-zinc-700 px-2 py-0.5 text-[10px] font-semibold text-zinc-200">
                                        Audio only
                                      </span>
                                    ) : null}
                                  </div>

                                  <div className={`${mine ? "text-white/85" : "text-zinc-300"} text-xs`}>
                                    <div className="truncate">
                                      {typeof clip?.channel === "string" ? clip.channel : ""}
                                    </div>
                                    <div className="mt-0.5">
                                      {typeof clip?.startTime === "number" && typeof clip?.endTime === "number"
                                        ? `${formatMmSs(clip.startTime)} → ${formatMmSs(clip.endTime)}`
                                        : " "}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : type === "youtube" && youtubeUrl ? (
                              (() => {
                                const match = youtubeUrl.match(YOUTUBE_URL_RE);
                                const videoId = match?.[4] ? String(match[4]) : "";
                                const thumbUrl = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : "";
                                return (
                                  <button
                                    type="button"
                                    onClick={() => window.open(youtubeUrl, "_blank")}
                                    className="block w-full max-w-xs overflow-hidden rounded-2xl border border-zinc-800 bg-[#111] text-left transition-colors hover:border-zinc-700 hover:bg-[#141414]"
                                    title="Open YouTube"
                                  >
                                    {thumbUrl ? (
                                      <div className="relative">
                                        <img src={thumbUrl} alt="" className="aspect-video w-full object-cover" />
                                        <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold text-white">
                                          <span className="inline-flex h-3 w-3 items-center justify-center rounded-sm bg-red-600 text-[8px] leading-none">
                                            ▶
                                          </span>
                                          YouTube
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="px-4 pt-3 text-[10px] font-semibold text-zinc-300">YouTube</div>
                                    )}
                                    <div className="px-4 py-3">
                                      <div className="truncate text-xs font-semibold text-emerald-400">{youtubeUrl}</div>
                                    </div>
                                  </button>
                                );
                              })()
                            ) : (
                              <div className="whitespace-pre-wrap break-words leading-relaxed text-white">{m.text}</div>
                            )}
                          </div>
                          <div className={`mt-1 flex items-center gap-1 ${mine ? "justify-end" : "justify-start"} opacity-0 group-hover:opacity-100 transition-opacity`}>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setOpenMessageMenuId((prevId) => (prevId === m.id ? null : m.id));
                                }}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:bg-zinc-900"
                                aria-label="Message options"
                                title="Options"
                              >
                                …
                              </button>
                              {openMessageMenuId === m.id ? (
                                <div
                                  className={`absolute z-10 mt-1 ${mine ? "right-0" : "left-0"} w-44 rounded-2xl border border-zinc-800 bg-zinc-950 p-2 shadow-xl`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                >
                                  {type === "clip" && clip ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          if (!user) return;
                                          const vid = typeof clip?.videoId === "string" ? clip.videoId : "";
                                          const st = typeof clip?.startTime === "number" ? clip.startTime : null;
                                          if (!vid || st == null) return;
                                          const key = `${user.uid}|${vid}|${Math.floor(st)}`;
                                          if (savedClipKeyRef.current.has(key)) return;

                                          try {
                                            // Check existing saved clip
                                            const qSaved = query(
                                              collection(db, "savedClips"),
                                              where("userId", "==", user.uid),
                                              where("videoId", "==", vid),
                                              where("startTime", "==", Math.floor(st)),
                                              limit(1),
                                            );
                                            const existing = await getDocs(qSaved);
                                            if (!existing.empty) {
                                              savedClipKeyRef.current.add(key);
                                              setClipSavedToastByMessageId((prev) => ({ ...prev, [m.id]: true }));
                                              window.setTimeout(
                                                () => setClipSavedToastByMessageId((prev) => ({ ...prev, [m.id]: false })),
                                                1500,
                                              );
                                              return;
                                            }

                                            let resolvedTitle = typeof clip?.title === "string" ? clip.title : "";
                                            let resolvedChannel = typeof clip?.channel === "string" ? clip.channel : "";
                                            if (resolvedTitle.trim().toLowerCase().startsWith("http") || !resolvedTitle.trim() || !resolvedChannel.trim()) {
                                              const o = await fetchYouTubeOembed(vid);
                                              if (o) {
                                                if (o.title && o.title.trim()) resolvedTitle = o.title;
                                                if (o.author_name && o.author_name.trim()) resolvedChannel = o.author_name;
                                              }
                                            }

                                            await addDoc(collection(db, "savedClips"), {
                                              userId: user.uid,
                                              videoId: vid,
                                              startTime: Math.floor(Number(clip?.startTime || 0)),
                                              endTime: Math.floor(Number(clip?.endTime || 0)),
                                              topic: typeof clip?.topic === "string" ? clip.topic : "",
                                              channel: resolvedChannel,
                                              title: resolvedTitle,
                                              savedAt: serverTimestamp(),
                                            });
                                            savedClipKeyRef.current.add(key);
                                            setClipSavedToastByMessageId((prev) => ({ ...prev, [m.id]: true }));
                                            window.setTimeout(
                                              () => setClipSavedToastByMessageId((prev) => ({ ...prev, [m.id]: false })),
                                              1500,
                                            );
                                          } catch {
                                            // ignore
                                          }
                                        }}
                                        className="w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-900/70"
                                      >
                                        <span className="inline-flex items-center gap-2">
                                          <span className="text-zinc-400" aria-hidden>🔖</span>
                                          Save clip
                                        </span>
                                        {isSaved ? (
                                          <span className="text-emerald-400">Saved ✓</span>
                                        ) : clipSavedToastByMessageId[m.id] ? (
                                          <span className="text-emerald-400">Saved!</span>
                                        ) : null}
                                      </button>

                                      <button
                                        type="button"
                                        onClick={async () => {
                                          if (!user) return;
                                          const vid = typeof clip?.videoId === "string" ? clip.videoId : "";
                                          if (!vid) return;
                                          try {
                                            let resolvedTitle = typeof clip?.title === "string" ? clip.title : "";
                                            let resolvedChannel = typeof clip?.channel === "string" ? clip.channel : "";
                                            if (resolvedTitle.trim().toLowerCase().startsWith("http") || !resolvedTitle.trim() || !resolvedChannel.trim()) {
                                              const o = await fetchYouTubeOembed(vid);
                                              if (o) {
                                                if (o.title && o.title.trim()) resolvedTitle = o.title;
                                                if (o.author_name && o.author_name.trim()) resolvedChannel = o.author_name;
                                              }
                                            }
                                            await addDoc(collection(db, "clips"), {
                                              userId: user.uid,
                                              videoId: vid,
                                              startTime: Math.floor(Number(clip?.startTime || 0)),
                                              endTime: Math.floor(Number(clip?.endTime || 0)),
                                              topic: typeof clip?.topic === "string" ? clip.topic : "",
                                              channel: resolvedChannel,
                                              title: resolvedTitle,
                                              createdAt: serverTimestamp(),
                                              note: "",
                                            });
                                            setClipCuratedToastByMessageId((prev) => ({ ...prev, [m.id]: true }));
                                            window.setTimeout(
                                              () => setClipCuratedToastByMessageId((prev) => ({ ...prev, [m.id]: false })),
                                              1500,
                                            );
                                          } catch {
                                            // ignore
                                          }
                                        }}
                                        className="w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-900/70"
                                      >
                                        <span className="inline-flex items-center gap-2">
                                          <span className="text-zinc-400" aria-hidden>✨</span>
                                          Curate
                                        </span>
                                        {clipCuratedToastByMessageId[m.id] ? (
                                          <span className="text-emerald-400">Added!</span>
                                        ) : null}
                                      </button>
                                      <div className="my-1 h-px bg-zinc-800" />
                                    </>
                                  ) : null}

                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteMessageId(m.id)}
                                    className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-900/70"
                                  >
                                    <span className="text-zinc-400" aria-hidden>🗑</span>
                                    Delete
                                  </button>

                                  {confirmDeleteMessageId === m.id ? (
                                    <div className="mt-2 rounded-xl border border-zinc-800 bg-black/30 p-2">
                                      <div className="text-[11px] font-semibold text-zinc-200">Delete?</div>
                                      <div className="mt-2 flex items-center justify-between gap-2">
                                        <button
                                          type="button"
                                          onClick={() => setConfirmDeleteMessageId(null)}
                                          className="text-[11px] font-semibold text-zinc-400 hover:text-white"
                                        >
                                          No
                                        </button>
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            setConfirmDeleteMessageId(null);
                                            setOpenMessageMenuId(null);

                                            if (!user || !activeConversationId) return;
                                            if (mine) {
                                              try {
                                                await deleteDoc(doc(db, "conversations", activeConversationId, "messages", m.id));
                                                const lastVisible = visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1] : null;
                                                if (lastVisible?.id === m.id) {
                                                  await updateDoc(doc(db, "conversations", activeConversationId), { lastMessage: "" });
                                                }
                                              } catch {
                                                // ignore
                                              }
                                            } else {
                                              setHiddenMessageIds((prevSet) => {
                                                const next = new Set(prevSet);
                                                next.add(m.id);
                                                return next;
                                              });
                                            }
                                          }}
                                          className="text-[11px] font-semibold text-red-300 hover:text-red-200"
                                        >
                                          Yes
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div className={`text-[10px] leading-tight text-zinc-500 ${mine ? "text-right pr-0.5" : "pl-0.5"}`}>
                            {formatRelativeTime(m.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              <div className="shrink-0 border-t border-zinc-800 bg-black px-4 py-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => console.log("share clip attachment")}
                    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-900 hover:text-white"
                    aria-label="Attach clip"
                    title="Share a clip"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => console.log("share youtube link")}
                    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-900 hover:text-white"
                    aria-label="Share YouTube link"
                    title="Share YouTube link"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M23.5 6.2s-.2-1.7-1-2.4c-.9-1-2-1-2.4-1.1C17 2.5 12 2.5 12 2.5h-.1s-5 0-8.1.2c-.4 0-1.5.1-2.4 1.1-.8.7-1 2.4-1 2.4S0 8.1 0 10v1.9c0 1.9.2 3.8.2 3.8s.2 1.7 1 2.4c.9 1 2.1.9 2.6 1 1.9.2 7.2.2 7.2.2s5 0 8.1-.3c.4 0 1.5-.1 2.4-1.1.8-.7 1-2.4 1-2.4s.2-1.9.2-3.8V10c0-1.9-.2-3.8-.2-3.8zM9.5 14.9V8.6l5.8 3.15-5.8 3.15z" />
                    </svg>
                  </button>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Write a message…"
                    disabled={sending}
                    className="h-12 flex-1 rounded-full border border-zinc-800 bg-zinc-950 px-5 text-sm text-white outline-none placeholder:text-zinc-400 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/25 disabled:opacity-60"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={sending || !draft.trim()}
                    onClick={() => void handleSend()}
                    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_0_20px_rgba(74,222,128,0.25)] transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                    aria-label="Send message"
                    title="Send"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M22 2 11 13"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <path
                        d="M22 2 15 22l-4-9-9-4 20-7Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
                {isCurator === false ? null : null}
              </div>
            </div>
          )}
        </main>
      </div>

      <SignInCuratorModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        title="Sign in to message curators"
        subtitle="Messaging is private between two curators."
      />
      <CuratorRequiredModal open={showCuratorRequiredModal} onClose={() => setShowCuratorRequiredModal(false)} />
      <NewMessageModal
        open={newMessageOpen}
        onClose={() => setNewMessageOpen(false)}
        currentUserId={user?.uid || null}
        conversations={conversations as any}
        onOpenConversation={(id) => {
          handleSelectConversation(id);
          setNewMessageOpen(false);
        }}
      />
      <ClipFromLinkModal
        open={clipFromLinkOpen}
        videoId={pendingVideoId}
        youtubeUrl={pendingYoutubeUrl}
        initialStartHr={pendingStartHr}
        initialStartMin={pendingStartMin}
        initialStartSec={pendingStartSec}
        sending={clipFromLinkSending}
        onCancel={() => {
          setClipFromLinkOpen(false);
          setPendingYoutubeUrl(null);
          setPendingVideoId(null);
          setPendingStartHr("");
          setPendingStartMin("");
          setPendingStartSec("");
        }}
        onSend={async ({ audioOnly, startSeconds, endSeconds }) => {
          if (!user || !activeConversationId || !pendingVideoId || !pendingYoutubeUrl) return;
          try {
            setClipFromLinkSending(true);
            const o = await fetchYouTubeOembed(pendingVideoId);
            const resolvedTitle = o?.title && o.title.trim() ? o.title : pendingYoutubeUrl;
            const resolvedChannel = o?.author_name && o.author_name.trim() ? o.author_name : "";
            await sendMessageViaFirestoreUtil(activeConversationId, user.uid, {
              type: "clip",
              clip: {
                videoId: pendingVideoId,
                title: resolvedTitle,
                startTime: startSeconds,
                endTime: endSeconds,
                topic: audioOnly ? "audio-only" : "video",
                channel: resolvedChannel,
              },
            });
            setDraft("");
          } finally {
            setClipFromLinkSending(false);
            setClipFromLinkOpen(false);
            setPendingYoutubeUrl(null);
            setPendingVideoId(null);
            setPendingStartHr("");
            setPendingStartMin("");
            setPendingStartSec("");
          }
        }}
      />
    </div>
  );
}

