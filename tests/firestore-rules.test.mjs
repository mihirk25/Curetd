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

const testEnv = await initializeTestEnvironment({
  projectId: "demo-curatd-rules",
  firestore: {
    rules: await readFile("firestore.rules", "utf8"),
  },
});

try {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, "users", "public-user"), {
      username: "public",
      hasLegalName: true,
    });
    await setDoc(doc(adminDb, "users", "user-a"), {
      username: "leaked",
      firstName: "Private",
      lastName: "Person",
    });
    await setDoc(doc(adminDb, "clips", "leaky-clip"), {
      userId: "user-a",
      curatorId: "user-a",
      curatorEmail: "private@example.com",
      title: "Leaky",
    });
    await setDoc(doc(adminDb, "conversations", "conv-ab"), {
      participants: ["user-a", "user-b"],
      lastMessage: "",
      unreadBy: { "user-a": 0, "user-b": 0 },
    });
  });

  const anonDb = testEnv.unauthenticatedContext().firestore();
  const userADb = testEnv.authenticatedContext("user-a").firestore();
  const userBDb = testEnv.authenticatedContext("user-b").firestore();
  const userCDb = testEnv.authenticatedContext("user-c").firestore();

  await assertSucceeds(getDoc(doc(anonDb, "users", "public-user")));
  await assertFails(getDoc(doc(anonDb, "users", "user-a")));
  await assertSucceeds(getDoc(doc(userADb, "users", "user-a")));

  await assertSucceeds(
    setDoc(doc(userADb, "privateUsers", "user-a"), {
      firstName: "Alice",
      lastName: "Owner",
    }),
  );
  await assertFails(getDoc(doc(userBDb, "privateUsers", "user-a")));

  await assertFails(
    setDoc(doc(userADb, "users", "user-a"), {
      username: "alice",
      firstName: "Alice",
      lastName: "Owner",
    }),
  );
  await assertSucceeds(
    setDoc(doc(userADb, "users", "user-a"), {
      username: "alice",
      hasLegalName: true,
    }),
  );

  await assertFails(
    setDoc(doc(userADb, "clips", "forged-clip"), {
      userId: "user-b",
      curatorId: "user-a",
      title: "Forged",
    }),
  );
  await assertFails(
    setDoc(doc(userADb, "clips", "email-clip"), {
      userId: "user-a",
      curatorId: "user-a",
      curatorEmail: "private@example.com",
      title: "Email leak",
    }),
  );
  await assertSucceeds(
    setDoc(doc(userADb, "clips", "owned-clip"), {
      userId: "user-a",
      curatorId: "user-a",
      title: "Owned",
    }),
  );
  await assertFails(getDoc(doc(anonDb, "clips", "leaky-clip")));
  await assertSucceeds(getDoc(doc(userADb, "clips", "leaky-clip")));

  await assertSucceeds(
    setDoc(doc(userADb, "savedClips", "user-a_clip-1"), {
      userId: "user-a",
      clipId: "clip-1",
    }),
  );
  await assertFails(getDoc(doc(userBDb, "savedClips", "user-a_clip-1")));
  await assertFails(deleteDoc(doc(userBDb, "savedClips", "user-a_clip-1")));

  await assertSucceeds(getDoc(doc(userADb, "conversations", "conv-ab")));
  await assertFails(getDoc(doc(userCDb, "conversations", "conv-ab")));
  await assertSucceeds(
    setDoc(doc(userADb, "conversations", "conv-ab", "messages", "m1"), {
      senderId: "user-a",
      text: "hello",
      createdAt: 1,
      read: false,
    }),
  );
  await assertFails(
    setDoc(doc(userCDb, "conversations", "conv-ab", "messages", "m2"), {
      senderId: "user-c",
      text: "intrude",
      createdAt: 1,
      read: false,
    }),
  );
  await assertFails(
    setDoc(doc(userADb, "conversations", "conv-ab", "messages", "m3"), {
      senderId: "user-b",
      text: "spoof",
      createdAt: 1,
      read: false,
    }),
  );
  await assertSucceeds(updateDoc(doc(userADb, "conversations", "conv-ab"), { "unreadBy.user-a": 0 }));

  assert.ok(true);
} finally {
  await testEnv.cleanup();
}
