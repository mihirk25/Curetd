"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { extractVideoId } from "../lib/clip-playback";
import { normalizeTopicName, recordTopicUsage } from "../lib/topic-directory";

function newMomentId() {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export type CollectionDocLite = { id: string; clipIds: string[] };

export function CollectionAddClipsModal({
  open,
  onClose,
  targetCollection,
  curatorUsername,
  currentUser,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  targetCollection: CollectionDocLite | null;
  curatorUsername: string;
  currentUser: { uid: string; username: string | null; photoURL: string | null } | null;
  onUpdated: () => void;
}) {
  const [tab, setTab] = useState<"yours" | "new">("yours");
  const [myClips, setMyClips] = useState<Array<{ id: string } & Record<string, unknown>>>([]);
  const [loadingClips, setLoadingClips] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [clipTitle, setClipTitle] = useState("");
  const [channel, setChannel] = useState("");
  const [topicInput, setTopicInput] = useState("");
  const [startMin, setStartMin] = useState("");
  const [startSec, setStartSec] = useState("");
  const [endMin, setEndMin] = useState("");
  const [endSec, setEndSec] = useState("");
  const [creatingClip, setCreatingClip] = useState(false);

  const resetNewClipForm = useCallback(() => {
    setUrl("");
    setClipTitle("");
    setChannel("");
    setTopicInput("");
    setStartMin("");
    setStartSec("");
    setEndMin("");
    setEndSec("");
  }, []);

  useEffect(() => {
    if (!open || !targetCollection || !currentUser) return;
    setTab("yours");
    setSaveError(null);
    setSelected(new Set(Array.isArray(targetCollection.clipIds) ? targetCollection.clipIds : []));
    resetNewClipForm();
    let cancelled = false;
    setLoadingClips(true);
    void (async () => {
      try {
        const q = query(
          collection(db, "clips"),
          where("userId", "==", currentUser.uid),
          limit(200),
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a: any, b: any) => {
          const ta = a?.createdAt?.toMillis?.() ?? a?.createdAt?.seconds ?? 0;
          const tb = b?.createdAt?.toMillis?.() ?? b?.createdAt?.seconds ?? 0;
          return tb - ta;
        });
        setMyClips(rows);
      } catch {
        if (!cancelled) setMyClips([]);
      } finally {
        if (!cancelled) setLoadingClips(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, targetCollection?.id, currentUser?.uid, resetNewClipForm]);

  const toggleId = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveSelection = async () => {
    if (!targetCollection || !currentUser) return;
    setSaving(true);
    setSaveError(null);
    try {
      const existing = Array.isArray(targetCollection.clipIds) ? [...targetCollection.clipIds] : [];
      const keptInOrder = existing.filter((id) => selected.has(id));
      const added: string[] = [];
      for (const c of myClips) {
        if (selected.has(c.id) && !existing.includes(c.id)) added.push(c.id);
      }
      const nextIds = [...keptInOrder, ...added];
      await updateDoc(doc(db, "collections", targetCollection.id), {
        clipIds: nextIds,
        updatedAt: serverTimestamp(),
      });
      onUpdated();
      onClose();
    } catch (e) {
      console.error(e);
      setSaveError("Could not save clips.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNewClip = async () => {
    if (!currentUser || !targetCollection) return;
    const normalizedTopic = normalizeTopicName(topicInput);
    if (!normalizedTopic) {
      setSaveError("Please enter a topic for the new clip.");
      return;
    }
    if (!url.trim()) {
      setSaveError("Please paste a YouTube URL.");
      return;
    }
    if (!clipTitle.trim()) {
      setSaveError("Please enter a clip title.");
      return;
    }
    const videoId = extractVideoId(url.trim());
    if (!videoId) {
      setSaveError("Could not read a YouTube video ID from that URL.");
      return;
    }
    const totalStart = (parseInt(startMin, 10) || 0) * 60 + (parseInt(startSec, 10) || 0);
    const totalEnd = (parseInt(endMin, 10) || 0) * 60 + (parseInt(endSec, 10) || 0);
    setCreatingClip(true);
    setSaveError(null);
    try {
      const moment = {
        id: newMomentId(),
        startTime: totalStart,
        endTime: totalEnd,
        note: "",
        topic: normalizedTopic,
        addedAt: Timestamp.now(),
      };
      const existingQ = query(
        collection(db, "clips"),
        where("videoId", "==", videoId),
        where("audioOnly", "==", false),
        where("userId", "==", currentUser.uid),
        limit(1),
      );
      const existingSnap = await getDocs(existingQ);
      let clipId: string;
      if (!existingSnap.empty) {
        const existingId = existingSnap.docs[0].id;
        await updateDoc(doc(db, "clips", existingId), {
          title: clipTitle.trim(),
          channelName: channel.trim() || "Unknown channel",
          videoId,
          audioOnly: false,
          username: currentUser.username ?? null,
          displayName: currentUser.username || "Anonymous",
          moments: arrayUnion(moment),
        });
        clipId = existingId;
      } else {
        const ref = await addDoc(collection(db, "clips"), {
          videoUrl: url.trim(),
          videoId,
          audioOnly: false,
          title: clipTitle.trim(),
          channelName: channel.trim() || "Unknown channel",
          userId: currentUser.uid,
          username: currentUser.username ?? null,
          displayName: currentUser.username || "Anonymous",
          createdAt: serverTimestamp(),
          moments: [moment],
        });
        clipId = ref.id;
      }
      await recordTopicUsage(normalizedTopic, currentUser.uid);
      const colSnap = await getDoc(doc(db, "collections", targetCollection.id));
      const freshIds = colSnap.exists() && Array.isArray((colSnap.data() as any)?.clipIds)
        ? [...(colSnap.data() as any).clipIds]
        : [...(targetCollection.clipIds || [])];
      const next = freshIds.includes(clipId) ? freshIds : [...freshIds, clipId];
      await updateDoc(doc(db, "collections", targetCollection.id), {
        clipIds: next,
        updatedAt: serverTimestamp(),
      });
      onUpdated();
      resetNewClipForm();
      onClose();
    } catch (e) {
      console.error(e);
      setSaveError("Could not create clip.");
    } finally {
      setCreatingClip(false);
    }
  };

  if (!open || !targetCollection || !currentUser) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-3 py-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Add clips to collection"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">Add clips</h2>
        <p className="mt-1 text-xs text-zinc-500">@{curatorUsername}</p>

        <div className="mt-4 flex gap-1 rounded-lg border border-zinc-800 bg-black/30 p-1">
          <button
            type="button"
            onClick={() => setTab("yours")}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === "yours" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Your clips
          </button>
          <button
            type="button"
            onClick={() => setTab("new")}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === "new" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            New clip
          </button>
        </div>

        {saveError ? <div className="mt-3 text-sm text-red-400">{saveError}</div> : null}

        {tab === "yours" ? (
          <div className="mt-4 space-y-2">
            {loadingClips ? (
              <div className="py-8 text-center text-sm text-zinc-500">Loading your clips…</div>
            ) : myClips.length === 0 ? (
              <div className="py-8 text-center text-sm text-zinc-500">No clips yet. Use the New clip tab.</div>
            ) : (
              <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                {myClips.map((c) => {
                  const vid = (c as any).videoId || extractVideoId(String((c as any).videoUrl || (c as any).url || ""));
                  const thumb = vid ? `https://img.youtube.com/vi/${vid}/mqdefault.jpg` : "";
                  return (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-black/20 px-2 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleId(c.id)}
                        className="h-4 w-4 shrink-0 rounded border-zinc-600"
                      />
                      {thumb ? (
                        <img src={thumb} alt="" className="h-12 w-20 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="h-12 w-20 shrink-0 rounded bg-zinc-800" />
                      )}
                      <span className="min-w-0 flex-1 text-sm font-medium text-zinc-200 line-clamp-2">
                        {String((c as any).title || "Untitled")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex justify-end gap-2 border-t border-zinc-800 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || loadingClips}
                onClick={() => void saveSelection()}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-xs text-zinc-400">
              YouTube URL
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-zinc-100"
                placeholder="https://www.youtube.com/watch?v=…"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Title
              <input
                value={clipTitle}
                onChange={(e) => setClipTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-zinc-100"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Channel
              <input
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-zinc-100"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Topic *
              <input
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-zinc-100"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-zinc-400">Start (m:s)</div>
                <div className="mt-1 flex gap-1">
                  <input
                    value={startMin}
                    onChange={(e) => setStartMin(e.target.value)}
                    placeholder="m"
                    className="w-full rounded border border-zinc-800 bg-black/40 px-2 py-1.5 text-sm"
                  />
                  <input
                    value={startSec}
                    onChange={(e) => setStartSec(e.target.value)}
                    placeholder="s"
                    className="w-full rounded border border-zinc-800 bg-black/40 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-400">End (m:s)</div>
                <div className="mt-1 flex gap-1">
                  <input
                    value={endMin}
                    onChange={(e) => setEndMin(e.target.value)}
                    placeholder="m"
                    className="w-full rounded border border-zinc-800 bg-black/40 px-2 py-1.5 text-sm"
                  />
                  <input
                    value={endSec}
                    onChange={(e) => setEndSec(e.target.value)}
                    placeholder="s"
                    className="w-full rounded border border-zinc-800 bg-black/40 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-800 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={creatingClip}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creatingClip}
                onClick={() => void handleCreateNewClip()}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
              >
                {creatingClip ? "Saving…" : "Save clip"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
