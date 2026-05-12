import {
  collection,
  deleteField,
  doc,
  increment,
  serverTimestamp,
  writeBatch,
  type Firestore,
  type FieldValue,
} from "firebase/firestore";

export type ConversationDoc = {
  participants: [string, string] | string[];
  lastMessage?: string;
  lastMessageAt?: any;
  unreadBy?: Record<string, number | FieldValue>;
  deletedBy?: Record<string, FieldValue>;
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
    deletedBy: {
      [args.senderId]: deleteField(),
      [otherId]: deleteField(),
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

