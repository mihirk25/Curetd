import { updateProfile, type User } from "firebase/auth";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { doc, updateDoc } from "firebase/firestore";
import { auth, db, storage } from "../../firebase";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

export async function uploadProfilePhoto(uid: string, file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("INVALID_TYPE");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("TOO_LARGE");
  }

  const storageRef = ref(storage, `profilePhotos/${uid}`);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  await updateDoc(doc(db, "users", uid), { photoURL: url });
  const currentUser: User | null = auth.currentUser;
  if (currentUser) {
    await updateProfile(currentUser, { photoURL: url });
  }
  return url;
}
