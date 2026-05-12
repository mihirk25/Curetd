"use client";

import React, { useEffect, useState } from "react";

export function NewCollectionModal({
  open,
  onClose,
  onCreate,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: { title: string; description: string; topic: string }) => void | Promise<void>;
  busy: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [topic, setTopic] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setTopic("");
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="New collection"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">New collection</h2>
        <p className="mt-1 text-sm text-zinc-500">Group clips into a playlist or course unit.</p>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-zinc-400">Title *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/50"
              placeholder="e.g. Intro to philosophy"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-400">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-none rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/50"
              placeholder="Optional"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-400">Topic</span>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/50"
              placeholder="Optional"
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !title.trim()}
            onClick={() => void onCreate({ title: title.trim(), description: description.trim(), topic: topic.trim() })}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-emerald-400 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
