import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "demo-curatd-rules",
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
  },
});

const conversationPath = ["conversations", "secret-thread"];
const messagePath = [...conversationPath, "messages", "m1"];

try {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, ...conversationPath), {
      participants: ["alice", "bob"],
      isGroup: false,
      lastMessage: "private",
      lastMessageAt: new Date("2026-05-10T00:00:00.000Z"),
      unreadBy: { alice: 0, bob: 1 },
    });
    await setDoc(doc(adminDb, ...messagePath), {
      senderId: "alice",
      text: "private",
      type: "text",
      read: false,
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
    });
  });

  const aliceDb = testEnv.authenticatedContext("alice").firestore();
  const bobDb = testEnv.authenticatedContext("bob").firestore();
  const malloryDb = testEnv.authenticatedContext("mallory").firestore();

  await assertSucceeds(getDoc(doc(aliceDb, ...conversationPath)));
  await assertSucceeds(getDoc(doc(bobDb, ...messagePath)));

  await assertFails(getDoc(doc(malloryDb, ...conversationPath)));
  await assertFails(getDoc(doc(malloryDb, ...messagePath)));
  await assertFails(updateDoc(doc(malloryDb, ...conversationPath), { lastMessage: "owned" }));
  await assertFails(deleteDoc(doc(malloryDb, ...conversationPath)));
  await assertFails(
    addDoc(collection(malloryDb, ...conversationPath, "messages"), {
      senderId: "mallory",
      text: "intrusion",
      type: "text",
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
    }),
  );

  await assertSucceeds(
    setDoc(doc(aliceDb, "conversations", "alice-started-thread"), {
      participants: ["alice", "bob"],
      isGroup: false,
      lastMessage: "",
      lastMessageAt: new Date("2026-05-10T00:00:00.000Z"),
      unreadBy: { alice: 0, bob: 0 },
    }),
  );
  await assertFails(
    setDoc(doc(malloryDb, "conversations", "forged-thread"), {
      participants: ["alice", "bob"],
      isGroup: false,
      lastMessage: "",
      lastMessageAt: new Date("2026-05-10T00:00:00.000Z"),
      unreadBy: { alice: 0, bob: 0 },
    }),
  );

  await assertSucceeds(
    addDoc(collection(aliceDb, ...conversationPath, "messages"), {
      senderId: "alice",
      text: "hello",
      type: "text",
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
    }),
  );
  await assertFails(
    addDoc(collection(aliceDb, ...conversationPath, "messages"), {
      senderId: "bob",
      text: "spoofed",
      type: "text",
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
    }),
  );

  await assertSucceeds(updateDoc(doc(bobDb, ...conversationPath), { "unreadBy.bob": 0 }));
  await assertFails(updateDoc(doc(aliceDb, ...conversationPath), { participants: ["alice", "mallory"] }));
  await assertFails(deleteDoc(doc(aliceDb, ...conversationPath)));

  console.log("Firestore conversation rules tests passed");
} finally {
  await testEnv.cleanup();
}

assert.ok(true);
