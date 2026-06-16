"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  documentId,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  limit,
} from "firebase/firestore";
import { db } from "../../firebase";
import { createGroupConversation } from "../lib/firestore";

type UsernameHit = { uid: string; username: string };

export function NewMessageModal(props: {
  open: boolean;
  onClose: () => void;
  currentUserId: string | null;
  conversations: Array<{ id: string; data: any }>;
  onOpenConversation: (conversationId: string) => void;
}) {
  const { open, onClose, currentUserId, conversations, onOpenConversation } = props;
  const [tab, setTab] = useState<"dm" | "group">("dm");
  const [qText, setQText] = useState("");
  const [results, setResults] = useState<UsernameHit[]>([]);
  const [loading, setLoading] = useState(false);

  const [groupSelected, setGroupSelected] = useState<UsernameHit[]>([]);
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQText("");
    setResults([]);
    setTab("dm");
    setGroupSelected([]);
    setGroupName("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!currentUserId) return;
    const raw = qText.trim().replace(/^@+/, "");
    const q = raw.trim().toLowerCase();
    if (!q) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const byUsernameQ = query(
            collection(db, "usernames"),
            where(documentId(), ">=", q),
            where(documentId(), "<=", q + "\uf8ff"),
            limit(10),
          );
          const byUsersQ = query(
            collection(db, "publicProfiles"),
            where("username", ">=", q),
            where("username", "<=", q + "\uf8ff"),
            orderBy("username"),
            limit(10),
          );

          const [usernamesSnap, usersSnap] = await Promise.all([getDocs(byUsernameQ), getDocs(byUsersQ)]);
          if (cancelled) return;

          const merged = new Map<string, UsernameHit>();

          for (const d of usernamesSnap.docs) {
            const data: any = d.data() as any;
            const uid = String(data?.uid || data?.userId || "");
            const username = d.id;
            if (!uid || uid === currentUserId) continue;
            if (username) merged.set(uid, { uid, username });
          }

          for (const d of usersSnap.docs) {
            const data: any = d.data() as any;
            const uid = d.id;
            const username = typeof data?.username === "string" ? String(data.username) : "";
            if (!uid || uid === currentUserId) continue;
            if (!username) continue;
            if (!merged.has(uid)) merged.set(uid, { uid, username });
          }

          setResults([...merged.values()]);
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, qText, currentUserId]);

  const dmExistingConversationId = (otherUid: string) => {
    for (const c of conversations || []) {
      const data: any = c.data as any;
      if (Boolean(data?.isGroup)) continue;
      const parts = Array.isArray(data?.participants) ? data.participants : [];
      if (parts.includes(currentUserId) && parts.includes(otherUid)) return c.id;
    }
    return null;
  };

  const canCreateGroup = useMemo(() => {
    return Boolean(currentUserId) && groupSelected.length >= 1 && groupName.trim().length > 0 && !creating;
  }, [currentUserId, groupSelected.length, groupName, creating]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-bold text-white">New message</div>
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

        <div className="mt-4 inline-flex rounded-2xl border border-zinc-800 bg-black p-1">
          <button
            type="button"
            onClick={() => setTab("dm")}
            className={`px-3 py-2 text-sm font-semibold rounded-xl transition-colors ${
              tab === "dm" ? "bg-white text-black" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Direct Message
          </button>
          <button
            type="button"
            onClick={() => setTab("group")}
            className={`px-3 py-2 text-sm font-semibold rounded-xl transition-colors ${
              tab === "group" ? "bg-white text-black" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Group
          </button>
        </div>

        <div className="mt-4">
          <input
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            placeholder="Search by name or username"
            className="w-full h-11 rounded-2xl border border-zinc-800 bg-black px-4 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
          />
          <div className="mt-2 text-[11px] text-zinc-500">Prefix search by username or display name.</div>
        </div>

        {tab === "group" ? (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              {groupSelected.map((u) => (
                <button
                  key={u.uid}
                  type="button"
                  onClick={() => setGroupSelected((prev) => prev.filter((x) => x.uid !== u.uid))}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 transition-colors"
                  title="Remove"
                >
                  <span className="h-6 w-6 rounded-full bg-emerald-500 text-black inline-flex items-center justify-center text-[11px] font-bold">
                    {u.username.slice(0, 1).toUpperCase()}
                  </span>
                  @{u.username}
                  <span className="text-zinc-400">×</span>
                </button>
              ))}
            </div>

            <div className="mt-4">
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Group name</label>
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Clip squad"
                className="w-full h-11 rounded-2xl border border-zinc-800 bg-black px-4 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
              />
            </div>
          </div>
        ) : null}

        <div className="mt-4 max-h-[40vh] overflow-y-auto space-y-1">
          {!currentUserId ? (
            <div className="py-10 text-center text-sm text-zinc-500">Sign in to start a conversation.</div>
          ) : loading ? (
            <div className="py-10 text-center text-sm text-zinc-500">Searching…</div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-500">
              {qText.trim().replace(/^@+/, "") ? "No users found." : "Start typing to search."}
            </div>
          ) : (
            results.map((u) => {
              const already = tab === "group" ? groupSelected.some((x) => x.uid === u.uid) : false;
              return (
                <button
                  key={u.uid}
                  type="button"
                  disabled={already}
                  onClick={async () => {
                    if (!currentUserId) return;
                    if (tab === "group") {
                      setGroupSelected((prev) => (prev.some((x) => x.uid === u.uid) ? prev : [...prev, u]));
                      return;
                    }

                    const existingId = dmExistingConversationId(u.uid);
                    if (existingId) {
                      onOpenConversation(existingId);
                      onClose();
                      return;
                    }

                    try {
                      const ref = await addDoc(collection(db, "conversations"), {
                        participants: [currentUserId, u.uid],
                        isGroup: false,
                        lastMessage: "",
                        lastMessageAt: serverTimestamp(),
                        unreadBy: { [currentUserId]: 0, [u.uid]: 0 },
                      });
                      onOpenConversation(ref.id);
                      onClose();
                    } catch {
                      // ignore for now
                    }
                  }}
                  className={`w-full text-left rounded-2xl px-3 py-3 border transition-colors ${
                    already ? "border-zinc-900 bg-zinc-950 opacity-50" : "border-zinc-800 hover:bg-zinc-900/40"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-emerald-500 text-black inline-flex items-center justify-center text-sm font-bold border border-zinc-800">
                      {u.username.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-white truncate">@{u.username}</div>
                      <div className="text-xs text-zinc-500 truncate">
                        {tab === "group" ? (already ? "Added" : "Add to group") : "Start chat"}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {tab === "group" ? (
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-semibold text-zinc-400 hover:text-white transition-colors px-3 py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canCreateGroup}
              onClick={async () => {
                if (!currentUserId) return;
                const ids = groupSelected.map((u) => u.uid);
                if (ids.length === 0) return;
                const name = groupName.trim();
                if (!name) return;
                setCreating(true);
                try {
                  const id = await createGroupConversation(currentUserId, ids, name);
                  onOpenConversation(id);
                  onClose();
                } catch {
                  // ignore
                } finally {
                  setCreating(false);
                }
              }}
              className="rounded-2xl px-5 py-3 text-sm font-semibold bg-white text-black hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? "Creating…" : "Create Group"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

