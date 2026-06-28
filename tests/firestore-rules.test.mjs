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
  projectId: `curetd-rules-${Date.now()}`,
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
  },
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "alice"), {
      username: "alice",
      firstName: "Alice",
      lastName: "Private",
    });
    await setDoc(doc(db, "users", "bob"), { username: "bob" });
    await setDoc(doc(db, "clips", "aliceClip"), {
      userId: "alice",
      title: "Owned by Alice",
      videoId: "abc12345678",
    });
    await setDoc(doc(db, "savedClips", "alice_aliceClip"), {
      userId: "alice",
      clipId: "aliceClip",
    });
    await setDoc(doc(db, "conversations", "alice_bob"), {
      participants: ["alice", "bob"],
      lastMessage: "hi",
    });
    await setDoc(doc(db, "conversations", "alice_bob", "messages", "aliceMsg"), {
      senderId: "alice",
      text: "private",
    });
  });

  const anon = testEnv.unauthenticatedContext().firestore();
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();
  const mallory = testEnv.authenticatedContext("mallory").firestore();

  await assertFails(getDoc(doc(anon, "users", "alice")));
  await assertSucceeds(getDoc(doc(alice, "users", "alice")));
  await assertFails(
    setDoc(doc(alice, "users", "alice"), {
      username: "alice",
      firstName: "Alice",
    }),
  );
  await assertSucceeds(
    setDoc(doc(alice, "privateUsers", "alice"), {
      firstName: "Alice",
      lastName: "Private",
    }),
  );
  await assertFails(getDoc(doc(bob, "privateUsers", "alice")));

  await assertFails(
    setDoc(doc(bob, "savedClips", "alice_aliceClip"), {
      userId: "alice",
      clipId: "aliceClip",
    }),
  );
  await assertFails(getDoc(doc(bob, "savedClips", "alice_aliceClip")));
  await assertFails(deleteDoc(doc(bob, "savedClips", "alice_aliceClip")));
  await assertSucceeds(
    setDoc(doc(bob, "savedClips", "bob_aliceClip"), {
      userId: "bob",
      clipId: "aliceClip",
    }),
  );

  await assertFails(
    addDoc(collection(bob, "clips"), {
      userId: "alice",
      title: "spoof",
    }),
  );
  await assertFails(
    addDoc(collection(bob, "clips"), {
      userId: "bob",
      title: "email leak",
      curatorEmail: "bob@example.com",
    }),
  );
  await assertSucceeds(
    addDoc(collection(bob, "clips"), {
      userId: "bob",
      title: "valid",
    }),
  );
  await assertFails(updateDoc(doc(bob, "clips", "aliceClip"), { title: "stolen" }));

  await assertSucceeds(getDoc(doc(bob, "conversations", "alice_bob")));
  await assertFails(getDoc(doc(mallory, "conversations", "alice_bob")));
  await assertFails(
    addDoc(collection(mallory, "conversations", "alice_bob", "messages"), {
      senderId: "mallory",
      text: "intrusion",
    }),
  );
  await assertFails(
    addDoc(collection(bob, "conversations", "alice_bob", "messages"), {
      senderId: "alice",
      text: "forged",
    }),
  );
  await assertSucceeds(
    addDoc(collection(bob, "conversations", "alice_bob", "messages"), {
      senderId: "bob",
      text: "hello",
    }),
  );
  await assertFails(deleteDoc(doc(bob, "conversations", "alice_bob", "messages", "aliceMsg")));
  await assertFails(deleteDoc(doc(alice, "conversations", "alice_bob")));

  assert.ok(true);
} finally {
  await testEnv.cleanup();
}
