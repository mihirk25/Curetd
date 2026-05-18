"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { sendMessage } from "../lib/firestore";

type ClipPayload = {
  title?: string;
  videoId?: string;
  startTime?: number;
  endTime?: number;
  topic?: string;
  channel?: string;
};

type ConversationRow = {
  id: string;
  data: any;
};

export function SendClipModal(props: {
  open: boolean;
  onClose: () => void;
  currentUserId: string | null;
  clip: ClipPayload | null;
}) {
  const { open, onClose, currentUserId, clip } = props;
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);
  const profileCacheRef = useRef<Record<string, { username?: string | null }>>({});
  const [namesByConversationId, setNamesByConversationId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (!currentUserId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const q = query(
          collection(db, "conversations"),
          where("participants", "array-contains", currentUserId),
          orderBy("lastMessageAt", "desc"),
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        setConversations(snap.docs.map((d) => ({ id: d.id, data: d.data() as any })));
      } catch {
        if (!cancelled) setConversations([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, currentUserId]);

  useEffect(() => {
    if (!open) return;
    if (!currentUserId) return;

    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        conversations.map(async (c) => {
          const data: any = c.data as any;
          const isGroup = Boolean(data?.isGroup);
          if (isGroup) {
            next[c.id] = typeof data?.groupName === "string" && data.groupName.trim() ? data.groupName.trim() : "Group";
            return;
          }

          const parts = Array.isArray(data?.participants) ? data.participants : [];
          const otherUid = parts.find((p: string) => p && p !== currentUserId) || null;
          if (!otherUid) {
            next[c.id] = "Unknown";
            return;
          }
          if (profileCacheRef.current[otherUid]?.username) {
            next[c.id] = `@${String(profileCacheRef.current[otherUid].username)}`;
            return;
          }

          try {
            const snap = await getDoc(doc(db, "publicProfiles", otherUid));
            const u = snap.exists() ? (snap.data() as any)?.username : null;
            profileCacheRef.current[otherUid] = { username: u ?? null };
            next[c.id] = u ? `@${String(u)}` : "Unknown";
          } catch {
            profileCacheRef.current[otherUid] = { username: null };
            next[c.id] = "Unknown";
          }
        }),
      );

      if (cancelled) return;
      setNamesByConversationId((prev) => ({ ...prev, ...next }));
    })();

    return () => {
      cancelled = true;
    };
  }, [open, currentUserId, conversations]);

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => (namesByConversationId[c.id] || "").toLowerCase().includes(q));
  }, [conversations, namesByConversationId, queryText]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-white truncate">Send clip</div>
            <div className="text-xs text-zinc-500 truncate">
              {clip?.title ? clip.title : "Choose a conversation"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900/60 hover:text-white transition-colors"
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="mt-4">
          <input
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Search conversations…"
            className="w-full h-11 rounded-2xl border border-zinc-800 bg-black px-4 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
          />
        </div>

        <div className="mt-4 max-h-[50vh] overflow-y-auto space-y-1">
          {loading ? (
            <div className="py-10 text-center text-sm text-zinc-500">Loading…</div>
          ) : !currentUserId ? (
            <div className="py-10 text-center text-sm text-zinc-500">Sign in to send clips.</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-500">No conversations yet.</div>
          ) : (
            filtered.map((c) => {
              const name = namesByConversationId[c.id] || "Conversation";
              const sent = sentId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={sent}
                  onClick={async () => {
                    if (!currentUserId) return;
                    if (!clip) return;
                    try {
                      await sendMessage(c.id, currentUserId, { type: "clip", clip });
                      setSentId(c.id);
                      window.setTimeout(() => {
                        onClose();
                        setSentId(null);
                      }, 1500);
                    } catch {
                      // ignore for now
                    }
                  }}
                  className={`w-full text-left rounded-2xl px-3 py-3 border transition-colors ${
                    sent
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-zinc-800 hover:bg-zinc-900/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">{name}</div>
                      <div className="text-xs text-zinc-500 truncate">{sent ? "Sent!" : "Tap to send"}</div>
                    </div>
                    {sent ? (
                      <span className="text-xs font-semibold px-2 py-1 rounded-full bg-emerald-500 text-black">
                        Sent
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

