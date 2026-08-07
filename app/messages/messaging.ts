import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore,
  type FieldValue,
} from "firebase/firestore";

export type ConversationDoc = {
  participants: [string, string] | string[];
  lastMessage?: string;
  lastMessageAt?: any;
  unreadBy?: Record<string, number | FieldValue>;
  isGroup?: boolean;
};

export type MessageDoc = {
  senderId: string;
  text: string;
  createdAt: any;
  read: boolean;
};

export function getConversationId(a: string, b: string) {
  const [x, y] = [a, b].sort();
  return `${x}_${y}`;
}

/** True when participants is exactly the two DM uids (order-independent). */
export function isExactDmPair(participants: unknown, a: string, b: string): boolean {
  if (!Array.isArray(participants) || participants.length !== 2) return false;
  if (!a || !b || a === b) return false;
  const set = new Set(
    participants.filter((p): p is string => typeof p === "string" && p.length > 0),
  );
  return set.size === 2 && set.has(a) && set.has(b);
}

/**
 * Open or create the deterministic 1:1 DM for (currentUid, peerUid).
 * If the sorted-id slot was pre-created with the wrong participant set
 * (silent third-party squat), delete the compromised doc when allowed and recreate.
 */
export async function ensureTwoPartyDm(args: {
  db: Firestore;
  currentUid: string;
  peerUid: string;
}): Promise<{ conversationId: string }> {
  const { db: firestore, currentUid, peerUid } = args;
  if (!currentUid || !peerUid || currentUid === peerUid) {
    throw new Error("INVALID_DM_PAIR");
  }

  const conversationId = getConversationId(currentUid, peerUid);
  const convRef = doc(firestore, "conversations", conversationId);
  const existing = await getDoc(convRef);

  if (existing.exists()) {
    const data = existing.data() as ConversationDoc;
    if (data?.isGroup === true) {
      throw new Error("DM_SLOT_IS_GROUP");
    }
    if (isExactDmPair(data?.participants, currentUid, peerUid)) {
      return { conversationId };
    }
    const parts = Array.isArray(data?.participants) ? data.participants : [];
    // Only a listed participant can delete under hardened rules.
    if (!parts.includes(currentUid)) {
      throw new Error("DM_SLOT_COMPROMISED");
    }
    await deleteDoc(convRef);
  }

  await setDoc(convRef, {
    participants: [currentUid, peerUid],
    isGroup: false,
    lastMessage: "",
    lastMessageAt: serverTimestamp(),
    unreadBy: { [currentUid]: 0, [peerUid]: 0 },
  } satisfies ConversationDoc);

  return { conversationId };
}

export async function sendMessage(args: {
  db: Firestore;
  conversationId: string;
  participants: [string, string];
  senderId: string;
  text: string;
}) {
  const text = args.text.trim();
  if (!text) return;

  const convRef = doc(args.db, "conversations", args.conversationId);
  const msgRef = doc(collection(args.db, "conversations", args.conversationId, "messages"));

  const otherId = args.participants[0] === args.senderId ? args.participants[1] : args.participants[0];

  const batch = writeBatch(args.db);
  batch.set(convRef, {
    participants: args.participants,
    lastMessage: text,
    lastMessageAt: serverTimestamp(),
    unreadBy: {
      [otherId]: increment(1),
    },
  } satisfies ConversationDoc, { merge: true });

  batch.set(msgRef, {
    senderId: args.senderId,
    text,
    createdAt: serverTimestamp(),
    read: false,
  } satisfies MessageDoc);

  await batch.commit();
}

export async function markConversationRead(args: {
  db: Firestore;
  conversationId: string;
  viewerId: string;
  messageIdsToMarkRead: string[];
}) {
  const batch = writeBatch(args.db);
  for (const id of args.messageIdsToMarkRead) {
    batch.update(doc(args.db, "conversations", args.conversationId, "messages", id), { read: true });
  }
  batch.set(
    doc(args.db, "conversations", args.conversationId),
    { unreadBy: { [args.viewerId]: 0 } } satisfies Partial<ConversationDoc>,
    { merge: true },
  );
  await batch.commit();
}

