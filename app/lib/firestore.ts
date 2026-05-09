import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  serverTimestamp,
  setDoc,
  where,
  query,
} from "firebase/firestore";
import { db } from "../../firebase";

export async function followUser(currentUid: string, targetUid: string) {
  if (!currentUid || !targetUid || currentUid === targetUid) return;
  const followId = `${currentUid}_${targetUid}`;
  await setDoc(doc(db, "follows", followId), {
    followerId: currentUid,
    followingId: targetUid,
    createdAt: serverTimestamp(),
  });
}

export async function unfollowUser(currentUid: string, targetUid: string) {
  if (!currentUid || !targetUid || currentUid === targetUid) return;
  const followId = `${currentUid}_${targetUid}`;
  await deleteDoc(doc(db, "follows", followId));
}

export async function isFollowing(currentUid: string, targetUid: string): Promise<boolean> {
  if (!currentUid || !targetUid || currentUid === targetUid) return false;
  const followId = `${currentUid}_${targetUid}`;
  const snap = await getDoc(doc(db, "follows", followId));
  return snap.exists();
}

export async function getFollowerCount(uid: string): Promise<number> {
  if (!uid) return 0;
  const q = query(collection(db, "follows"), where("followingId", "==", uid));
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

export async function getFollowingCount(uid: string): Promise<number> {
  if (!uid) return 0;
  const q = query(collection(db, "follows"), where("followerId", "==", uid));
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  messageData: {
    text?: string;
    type: "text" | "clip" | "youtube";
    clip?: { title?: string; videoId?: string; startTime?: number; endTime?: number; topic?: string; channel?: string };
    youtubeUrl?: string;
  },
) {
  if (!conversationId || !senderId) return;

  const {
    addDoc,
    collection: fsCollection,
    doc: fsDoc,
    getDoc: fsGetDoc,
    increment: fsIncrement,
    serverTimestamp: fsServerTimestamp,
    updateDoc: fsUpdateDoc,
  } = await import("firebase/firestore");

  const text = typeof messageData?.text === "string" ? messageData.text : "";
  const type = messageData?.type;
  const clip = messageData?.clip;
  const youtubeUrl = typeof messageData?.youtubeUrl === "string" ? messageData.youtubeUrl : undefined;

  const convRef = fsDoc(db, "conversations", conversationId);
  const msgCol = fsCollection(db, "conversations", conversationId, "messages");

  await addDoc(msgCol, {
    senderId: String(senderId),
    text: String(text ?? ""),
    type,
    ...(clip ? { clip } : {}),
    ...(youtubeUrl ? { youtubeUrl } : {}),
    createdAt: fsServerTimestamp(),
  });

  const convSnap = await fsGetDoc(convRef);
  const participants: string[] = convSnap.exists()
    ? Array.isArray((convSnap.data() as any)?.participants)
      ? (convSnap.data() as any).participants
      : []
    : [];

  const lastMessage =
    type === "clip" ? "[Clip]" : type === "youtube" ? "[YouTube]" : String(text ?? "");

  const updates: Record<string, any> = {
    lastMessage,
    lastMessageAt: fsServerTimestamp(),
  };

  for (const uid of participants) {
    if (!uid || uid === senderId) continue;
    updates[`unreadBy.${uid}`] = fsIncrement(1);
  }

  await fsUpdateDoc(convRef, updates);
}

export function subscribeToMessages(
  conversationId: string,
  callback: (messages: Array<{ id: string } & Record<string, any>>) => void,
) {
  let unsub: (() => void) | null = null;

  void (async () => {
    const { collection: fsCollection, onSnapshot, orderBy, query } = await import("firebase/firestore");
    const q = query(
      fsCollection(db, "conversations", conversationId, "messages"),
      orderBy("createdAt", "asc"),
    );
    unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      callback(msgs);
    });
  })();

  return () => {
    try {
      unsub?.();
    } catch {
      // ignore
    }
  };
}

export async function createGroupConversation(creatorId: string, participantIds: string[], groupName: string) {
  if (!creatorId) throw new Error("Missing creatorId");

  const { addDoc, collection: fsCollection, serverTimestamp: fsServerTimestamp } = await import("firebase/firestore");

  const participants = Array.from(
    new Set([creatorId, ...(Array.isArray(participantIds) ? participantIds : [])].filter(Boolean)),
  );

  const unreadBy: Record<string, number> = {};
  for (const uid of participants) unreadBy[uid] = 0;

  const ref = await addDoc(fsCollection(db, "conversations"), {
    participants,
    isGroup: true,
    groupName: String(groupName ?? ""),
    createdBy: creatorId,
    lastMessage: "",
    lastMessageAt: fsServerTimestamp(),
    unreadBy,
  });

  return ref.id;
}
