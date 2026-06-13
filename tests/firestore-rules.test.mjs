import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const projectId = `curatd-rules-${Date.now()}`;
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules },
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "public-user"), {
      username: "public",
      hasLegalName: true,
    });
    await setDoc(doc(db, "users", "leaked-user"), {
      username: "leaked",
      firstName: "Lea",
      lastName: "Ked",
    });
    await setDoc(doc(db, "savedClips", "user-a_clip-1"), {
      userId: "user-a",
      clipId: "clip-1",
    });
    await setDoc(doc(db, "conversations", "dm-1"), {
      participants: ["user-a", "user-b"],
      lastMessage: "",
    });
    await setDoc(doc(db, "conversations", "dm-1", "messages", "msg-1"), {
      senderId: "user-a",
      text: "private",
      read: false,
    });
  });

  const anon = testEnv.unauthenticatedContext().firestore();
  const userA = testEnv.authenticatedContext("user-a").firestore();
  const userB = testEnv.authenticatedContext("user-b").firestore();
  const outsider = testEnv.authenticatedContext("outsider").firestore();

  await assertSucceeds(getDoc(doc(anon, "users", "public-user")));
  await assertFails(getDoc(doc(anon, "users", "leaked-user")));
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext("leaked-user").firestore(), "users", "leaked-user")));

  await assertSucceeds(
    setDoc(doc(userA, "privateUsers", "user-a"), {
      firstName: "Alice",
      lastName: "Example",
      updatedAt: new Date(),
    }),
  );
  await assertFails(
    setDoc(doc(userA, "users", "user-a"), {
      username: "alice",
      firstName: "Alice",
      lastName: "Example",
    }),
  );

  await assertSucceeds(
    setDoc(doc(userA, "clips", "clip-owned"), {
      userId: "user-a",
      title: "Owned",
    }),
  );
  await assertFails(
    setDoc(doc(userA, "clips", "clip-impersonated"), {
      userId: "user-b",
      title: "Impersonated",
    }),
  );
  await assertFails(
    setDoc(doc(userA, "clips", "clip-email"), {
      userId: "user-a",
      title: "Email leak",
      curatorEmail: "user-a@example.com",
    }),
  );

  await assertSucceeds(getDoc(doc(userA, "savedClips", "user-a_clip-1")));
  await assertFails(getDoc(doc(userB, "savedClips", "user-a_clip-1")));
  await assertFails(deleteDoc(doc(userB, "savedClips", "user-a_clip-1")));
  await assertSucceeds(
    setDoc(doc(userB, "savedClips", "user-b_clip-1"), {
      userId: "user-b",
      clipId: "clip-1",
    }),
  );

  await assertSucceeds(getDoc(doc(userA, "conversations", "dm-1")));
  await assertSucceeds(getDoc(doc(userB, "conversations", "dm-1")));
  await assertFails(getDoc(doc(outsider, "conversations", "dm-1")));
  await assertSucceeds(
    setDoc(doc(userA, "conversations", "dm-1", "messages", "msg-2"), {
      senderId: "user-a",
      text: "hello",
      read: false,
    }),
  );
  await assertFails(
    setDoc(doc(outsider, "conversations", "dm-1", "messages", "msg-3"), {
      senderId: "outsider",
      text: "intrusion",
      read: false,
    }),
  );
  await assertFails(deleteDoc(doc(userB, "conversations", "dm-1", "messages", "msg-1")));
  await assertSucceeds(updateDoc(doc(userB, "conversations", "dm-1", "messages", "msg-1"), { read: true }));

  assert.equal(true, true);
} finally {
  await testEnv.cleanup();
}
