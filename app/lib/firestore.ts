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
