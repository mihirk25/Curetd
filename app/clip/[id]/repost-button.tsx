"use client";

import React, { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, increment, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../auth-context";

export function RepostButton({
  clipId,
  originalCuratorId,
}: {
  clipId: string;
  originalCuratorId: string;
}) {
  const { user } = useAuth();
  const username = (user as any)?.username ?? null;
  const [state, setState] = useState<{ count: number; reposted: boolean }>({ count: 0, reposted: false });

  useEffect(() => {
    if (!clipId) return;
    const qy = query(collection(db, "reposts"), where("originalClipId", "==", clipId));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        let mine = false;
        for (const d of snap.docs) {
          const data = d.data() as any;
          if (user?.uid && String(data?.repostedByUid || "") === user.uid) mine = true;
        }
        setState({ count: snap.size, reposted: mine });
      },
      () => setState({ count: 0, reposted: false }),
    );
    return () => unsub();
  }, [clipId, user?.uid]);

  const repostId = useMemo(() => (user?.uid ? `${clipId}_${user.uid}` : ""), [clipId, user?.uid]);

  const toggle = async () => {
    if (!user?.uid) {
      alert("Please sign in to repost.");
      return;
    }
    try {
      const ref = doc(db, "reposts", repostId);
      if (state.reposted) {
        await deleteDoc(ref);
        try {
          await updateDoc(doc(db, "clips", clipId), { repostCount: increment(-1) });
        } catch {}
      } else {
        await setDoc(ref, {
          originalClipId: clipId,
          originalCuratorId: String(originalCuratorId || ""),
          repostedByUid: user.uid,
          repostedByUsername: username ?? null,
          repostedBy: { uid: user.uid, username: username ?? null },
          repostedAt: serverTimestamp(),
        });
        try {
          await updateDoc(doc(db, "clips", clipId), { repostCount: increment(1) });
        } catch {}
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
        state.reposted
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : "border-zinc-800 bg-black/20 text-zinc-400 hover:text-white hover:bg-zinc-900/40"
      }`}
      aria-label="Repost"
      title="Repost"
    >
      <span aria-hidden>🔁</span>
      <span>Repost</span>
      <span>{state.count}</span>
    </button>
  );
}

