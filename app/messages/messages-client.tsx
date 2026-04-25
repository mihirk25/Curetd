"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../auth-context";
import { CuratorSearchBar } from "../curator-search-bar";
import { SignInCuratorModal } from "../sign-in-curator-modal";
import { CuratorRequiredModal } from "../curator-required-modal";
import { getConversationId, markConversationRead, sendMessage, type ConversationDoc } from "./messaging";

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
  if (diff < 60_000) return "now";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h`;
  return `${Math.floor(diff / (24 * 60 * 60_000))}d`;
}

async function hasAtLeastOneClip(uid: string) {
  const snap = await getDocs(query(collection(db, "clips"), where("userId", "==", uid), limit(1)));
  return !snap.empty;
}

type UserMini = { uid: string; username?: string | null; displayName?: string | null; photoURL?: string | null };

export function MessagesClient() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showCuratorRequiredModal, setShowCuratorRequiredModal] = useState(false);

  const [isCurator, setIsCurator] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<Array<{ id: string; data: ConversationDoc }>>([]);
  const [profilesByUid, setProfilesByUid] = useState<Record<string, UserMini>>({});

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ id: string; senderId: string; text: string; createdAt: any; read: boolean }>>(
    [],
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveConversationId(searchParams?.get("c") || null);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setIsCurator(null);
    if (!user) return;
    hasAtLeastOneClip(user.uid)
      .then((ok) => {
        if (!cancelled) setIsCurator(ok);
      })
      .catch(() => {
        if (!cancelled) setIsCurator(false);
      });
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
    let cancelled = false;
    async function hydrateProfiles(uids: string[]) {
      const next: Record<string, UserMini> = {};
      await Promise.all(
        uids.map(async (uid) => {
          if (profilesByUid[uid]) return;
          try {
            const snap = await getDoc(doc(db, "users", uid));
            const d = snap.exists() ? (snap.data() as any) : null;
            next[uid] = { uid, username: d?.username ?? null, displayName: d?.displayName ?? null, photoURL: d?.photoURL ?? null };
          } catch {
            next[uid] = { uid, username: null, displayName: null, photoURL: null };
          }
        }),
      );
      if (cancelled) return;
      if (Object.keys(next).length > 0) setProfilesByUid((prev) => ({ ...prev, ...next }));
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

    const q = query(collection(db, "conversations", activeConversationId, "messages"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setMessages(next as any);

        const toMark = snap.docs
          .filter((d) => {
            const m = d.data() as any;
            return m?.read === false && m?.senderId && m.senderId !== user.uid;
          })
          .slice(0, 50)
          .map((d) => d.id);
        if (toMark.length > 0) {
          void markConversationRead({ db, conversationId: activeConversationId, viewerId: user.uid, messageIdsToMarkRead: toMark });
        } else {
          // If there are no unread message docs, still clear badge state for this conversation.
          // We do this when opening a conversation that might have had unreadBy set.
          void markConversationRead({ db, conversationId: activeConversationId, viewerId: user.uid, messageIdsToMarkRead: [] }).catch(() => {});
        }
      },
      () => setMessages([]),
    );
    return () => unsub();
  }, [user?.uid, activeConversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeConversationId]);

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
      setShowCuratorRequiredModal(true);
      return;
    }
    if (!activeConversationId || !activeConversation) return;

    const parts = (activeConversation.data.participants as any) as [string, string] | undefined;
    if (!Array.isArray(parts) || parts.length < 2) return;

    setSending(true);
    try {
      await sendMessage({
        db,
        conversationId: activeConversationId,
        participants: [String(parts[0]), String(parts[1])] as [string, string],
        senderId: user.uid,
        text: draft,
      });
      setDraft("");
    } finally {
      setSending(false);
    }
  }, [user, isCurator, activeConversationId, activeConversation, draft]);

  const headerMail = (
    <Link
      href="/messages"
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
        <path d="m4.8 9 6.2 5.1a2 2 0 0 0 2.6 0L19.8 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
      {user && totalUnread > 0 ? (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center border border-black">
          {totalUnread > 99 ? "99+" : totalUnread}
        </span>
      ) : null}
    </Link>
  );

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col">
      <header className="shrink-0 h-14 border-b border-zinc-800 grid grid-cols-[minmax(0,auto)_1fr_minmax(0,auto)] items-center gap-4 px-4 bg-black">
        <Link href="/" className="text-sm font-bold tracking-tight text-white hover:text-zinc-200 transition-colors shrink-0">
          CURATD
        </Link>
        <div className="flex min-w-0 justify-center px-2">
          <CuratorSearchBar />
        </div>
        <div className="flex items-center gap-2 min-w-0 justify-self-end">
          {headerMail}
          {!user ? (
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              className="text-sm font-semibold px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors"
            >
              Sign In
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[320px_1fr]">
        <aside className="border-b md:border-b-0 md:border-r border-zinc-800 min-h-0">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div className="text-sm font-semibold">Messages</div>
            {user ? (
              <div className="text-xs text-zinc-500">{totalUnread > 0 ? `${totalUnread} unread` : "All caught up"}</div>
            ) : (
              <div className="text-xs text-zinc-500">Sign in to chat</div>
            )}
          </div>

          <div className="overflow-y-auto max-h-[calc(100vh-56px-49px)]">
            {!user ? (
              <div className="p-6 text-sm text-zinc-500">Sign in to view your conversations.</div>
            ) : conversations.length === 0 ? (
              <div className="p-6 text-sm text-zinc-500">No conversations yet.</div>
            ) : (
              <div className="p-2">
                {conversations.map((c) => {
                  const parts = Array.isArray(c.data.participants) ? c.data.participants : [];
                  const otherUid = parts.find((p) => p && p !== user.uid) || null;
                  const other = otherUid ? profilesByUid[otherUid] : null;
                  const unread = Math.max(0, Number((c.data as any)?.unreadBy?.[user.uid] ?? 0));
                  const active = c.id === activeConversationId;

                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectConversation(c.id)}
                      className={`w-full text-left rounded-xl px-3 py-3 border transition-colors ${
                        active
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-transparent hover:border-zinc-800 hover:bg-zinc-900/40"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {other?.photoURL ? (
                          <img src={other.photoURL} alt="" className="w-10 h-10 rounded-full object-cover border border-zinc-800" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-black text-xs font-bold border border-zinc-800">
                            {String(other?.displayName || other?.username || "U").slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold truncate">
                              {other?.displayName || (other?.username ? `@${other.username}` : "Unknown")}
                            </div>
                            <div className="text-[11px] text-zinc-500 shrink-0">{formatRelativeTime((c.data as any)?.lastMessageAt)}</div>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <div className={`text-xs truncate ${unread > 0 ? "text-zinc-200" : "text-zinc-500"}`}>
                              {(c.data as any)?.lastMessage || "—"}
                            </div>
                            {unread > 0 ? (
                              <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                                {unread > 99 ? "99+" : unread}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-0">
          {!user ? (
            <div className="h-full flex items-center justify-center p-10">
              <div className="max-w-md w-full rounded-3xl border border-zinc-800 bg-zinc-900/20 p-8 text-center">
                <div className="text-lg font-semibold">Sign in to message curators</div>
                <div className="text-sm text-zinc-500 mt-2">Messages are private between two curators.</div>
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
            <div className="h-full flex items-center justify-center p-10">
              <div className="text-sm text-zinc-500">Select a conversation.</div>
            </div>
          ) : (
            <div className="h-full min-h-0 flex flex-col">
              <div className="shrink-0 border-b border-zinc-800 px-5 py-4 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-3">
                  {otherParticipant?.photoURL ? (
                    <img
                      src={otherParticipant.photoURL}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover border border-zinc-800"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-black text-xs font-bold border border-zinc-800">
                      {String(otherParticipant?.displayName || otherParticipant?.username || "U").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{otherParticipant?.displayName || "Conversation"}</div>
                    <div className="text-xs text-zinc-500 truncate">
                      {otherParticipant?.username ? (
                        <Link href={`/${otherParticipant.username}`} className="hover:text-zinc-300 transition-colors">
                          @{otherParticipant.username}
                        </Link>
                      ) : (
                        " "
                      )}
                    </div>
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

              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-2">
                {messages.length === 0 ? (
                  <div className="text-sm text-zinc-500">Say hi.</div>
                ) : (
                  messages.map((m) => {
                    const mine = m.senderId === user.uid;
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm border ${
                            mine
                              ? "bg-emerald-500/15 border-emerald-500/30 text-zinc-100"
                              : "bg-zinc-900/40 border-zinc-800 text-zinc-100"
                          }`}
                        >
                          <div className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</div>
                          <div className={`mt-1 text-[11px] ${mine ? "text-emerald-200/70" : "text-zinc-500"}`}>
                            {formatRelativeTime(m.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              <div className="shrink-0 border-t border-zinc-800 px-4 py-4">
                <div className="flex items-end gap-3">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={isCurator === false ? "Post your first clip to start messaging…" : "Write a message…"}
                    disabled={sending || isCurator === false}
                    rows={1}
                    className="flex-1 resize-none rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-60"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={sending || isCurator === false || !draft.trim()}
                    onClick={() => void handleSend()}
                    className="shrink-0 rounded-2xl px-5 py-3 text-sm font-semibold bg-white text-black hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Send
                  </button>
                </div>
                {isCurator === false ? (
                  <button
                    type="button"
                    onClick={() => setShowCuratorRequiredModal(true)}
                    className="mt-2 text-xs font-semibold text-emerald-500 hover:text-emerald-400 transition-colors"
                  >
                    Post your first clip to start messaging other curators.
                  </button>
                ) : null}
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
    </div>
  );
}

