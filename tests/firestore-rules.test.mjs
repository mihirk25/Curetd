import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: `curatd-rules-${Date.now()}`,
  firestore: {
    rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  },
});

const alice = testEnv.authenticatedContext("alice").firestore();
const bob = testEnv.authenticatedContext("bob").firestore();
const charlie = testEnv.authenticatedContext("charlie").firestore();
const anon = testEnv.unauthenticatedContext().firestore();

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "alice"), {
      username: "alice",
      firstName: "Alice",
      lastName: "Liddell",
    });
    await setDoc(doc(db, "users", "bob"), {
      username: "bob",
      hasLegalName: true,
    });
    await setDoc(doc(db, "privateUsers", "alice"), {
      firstName: "Alice",
      lastName: "Liddell",
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, "clips", "leakedClip"), {
      userId: "alice",
      videoId: "abc123def45",
      curatorEmail: "alice@example.com",
    });
    await setDoc(doc(db, "clips", "publicClip"), {
      userId: "alice",
      videoId: "abc123def45",
    });
    await setDoc(doc(db, "savedClips", "alice_publicClip"), {
      userId: "alice",
      clipId: "publicClip",
      savedAt: serverTimestamp(),
    });
    await setDoc(doc(db, "conversations", "alice_bob"), {
      participants: ["alice", "bob"],
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      unreadBy: { alice: 0, bob: 0 },
    });
  });

  await assertFails(getDoc(doc(anon, "users", "alice")));
  await assertSucceeds(getDoc(doc(alice, "users", "alice")));
  await assertSucceeds(getDoc(doc(anon, "users", "bob")));
  await assertFails(setDoc(doc(bob, "users", "bob"), { firstName: "Bob" }, { merge: true }));

  await assertSucceeds(getDoc(doc(alice, "privateUsers", "alice")));
  await assertFails(getDoc(doc(bob, "privateUsers", "alice")));
  await assertSucceeds(
    setDoc(
      doc(alice, "privateUsers", "alice"),
      { firstName: "Alice", lastName: "Liddell", updatedAt: serverTimestamp() },
      { merge: true },
    ),
  );
  await assertFails(
    setDoc(
      doc(bob, "privateUsers", "alice"),
      { firstName: "Mallory", lastName: "Wrong", updatedAt: serverTimestamp() },
      { merge: true },
    ),
  );

  await assertFails(getDoc(doc(anon, "clips", "leakedClip")));
  await assertSucceeds(getDoc(doc(alice, "clips", "leakedClip")));
  await assertFails(setDoc(doc(bob, "clips", "badClip"), { userId: "alice", videoId: "x" }));
  await assertFails(setDoc(doc(alice, "clips", "emailClip"), { userId: "alice", curatorEmail: "alice@example.com" }));
  await assertSucceeds(setDoc(doc(alice, "clips", "ownedClip"), { userId: "alice", videoId: "x" }));
  await assertFails(updateDoc(doc(bob, "clips", "publicClip"), { title: "stolen" }));

  await assertSucceeds(getDoc(doc(alice, "savedClips", "alice_publicClip")));
  await assertFails(getDoc(doc(bob, "savedClips", "alice_publicClip")));
  await assertFails(setDoc(doc(bob, "savedClips", "bad"), { userId: "alice", clipId: "publicClip" }));
  await assertSucceeds(setDoc(doc(bob, "savedClips", "bob_publicClip"), { userId: "bob", clipId: "publicClip" }));

  await assertSucceeds(getDoc(doc(alice, "conversations", "alice_bob")));
  await assertSucceeds(getDoc(doc(bob, "conversations", "alice_bob")));
  await assertFails(getDoc(doc(charlie, "conversations", "alice_bob")));
  await assertSucceeds(
    addDoc(collection(alice, "conversations", "alice_bob", "messages"), {
      senderId: "alice",
      text: "hi",
      createdAt: serverTimestamp(),
    }),
  );
  await assertFails(
    addDoc(collection(charlie, "conversations", "alice_bob", "messages"), {
      senderId: "charlie",
      text: "spy",
      createdAt: serverTimestamp(),
    }),
  );

  await assertSucceeds(deleteDoc(doc(alice, "savedClips", "alice_publicClip")));

  assert.ok(true);
} finally {
  await testEnv.cleanup();
}

console.log("Firestore rules regressions passed");
