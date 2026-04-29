import {
  collection,
  doc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../firebase";
import { CURATD_TOPICS } from "./topics";

export type TopicRecord = {
  id: string;
  name: string;
  count: number;
};

export function normalizeTopicName(raw: string) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
}

export function topicDocId(raw: string) {
  return normalizeTopicName(raw).toLowerCase();
}

export async function ensureSeedTopics(uid?: string | null) {
  const existing = await getDocs(query(collection(db, "topics")));
  if (!existing.empty) return;
  await Promise.all(
    CURATD_TOPICS.map((topic) =>
      setDoc(doc(db, "topics", topicDocId(topic)), {
        name: topic,
        count: 0,
        createdAt: serverTimestamp(),
        createdBy: uid ?? "system",
      }),
    ),
  );
}

export async function recordTopicUsage(topicName: string, uid: string) {
  const name = normalizeTopicName(topicName);
  const id = topicDocId(name);
  await setDoc(
    doc(db, "topics", id),
    {
      name,
      count: increment(1),
      createdAt: serverTimestamp(),
      createdBy: uid,
    },
    { merge: true },
  );
  return { id, name };
}

export async function adjustTopicUsage(topicName: string, delta: number, uid: string) {
  const name = normalizeTopicName(topicName);
  if (!name || delta === 0) return;
  await setDoc(
    doc(db, "topics", topicDocId(name)),
    {
      name,
      count: increment(delta),
      createdAt: serverTimestamp(),
      createdBy: uid,
    },
    { merge: true },
  );
}

export function subscribeToTopics(
  cb: (topics: TopicRecord[]) => void,
  onError?: () => void,
) {
  return onSnapshot(
    query(collection(db, "topics"), orderBy("count", "desc"), orderBy("name", "asc")),
    (snap) => {
      cb(
        snap.docs.map((d) => {
          const data = d.data() as { name?: unknown; count?: unknown };
          return {
            id: d.id,
            name: typeof data.name === "string" ? data.name : d.id,
            count: typeof data.count === "number" ? data.count : 0,
          };
        }),
      );
    },
    () => onError?.(),
  );
}
