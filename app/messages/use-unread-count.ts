"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";

export function useUnreadMessageCount(uid: string | null | undefined) {
  const [count, setCount] = useState(0);

  const key = useMemo(() => (uid ? String(uid) : null), [uid]);

  useEffect(() => {
    setCount(0);
    if (!key) return;

    const q = query(collection(db, "conversations"), where("participants", "array-contains", key));
    const unsub = onSnapshot(
      q,
      (snap) => {
        let n = 0;
        for (const d of snap.docs) {
          const unreadBy = (d.data() as any)?.unreadBy;
          n += Math.max(0, Number(unreadBy?.[key] ?? 0));
        }
        setCount(n);
      },
      () => setCount(0),
    );
    return () => unsub();
  }, [key]);

  return count;
}

