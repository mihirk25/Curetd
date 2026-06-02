import assert from "node:assert/strict";
import fs from "node:fs";
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
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: `curatd-rules-${Date.now()}`,
  firestore: {
    rules: fs.readFileSync("firestore.rules", "utf8"),
  },
});

try {
  const anonDb = testEnv.unauthenticatedContext().firestore();
  const aliceDb = testEnv.authenticatedContext("alice").firestore();
  const bobDb = testEnv.authenticatedContext("bob").firestore();
  const charlieDb = testEnv.authenticatedContext("charlie").firestore();
  const legacyAliceDb = testEnv.authenticatedContext("legacyAlice").firestore();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", "publicUser"), { username: "public_user" });
    await setDoc(doc(db, "users", "legacyAlice"), {
      username: "legacy_alice",
      firstName: "Alice",
      lastName: "Private",
    });
    await setDoc(doc(db, "clips", "clip1"), { userId: "alice", title: "Alice clip" });
    await setDoc(doc(db, "conversations", "conv1"), {
      participants: ["alice", "bob"],
      lastMessage: "",
      unreadBy: { alice: 0, bob: 0 },
    });
  });

  await assertSucceeds(getDoc(doc(anonDb, "users", "publicUser")));
  await assertFails(getDoc(doc(anonDb, "users", "legacyAlice")));
  await assertSucceeds(getDoc(doc(legacyAliceDb, "users", "legacyAlice")));
  await assertFails(
    setDoc(doc(aliceDb, "users", "aliceWithNames"), {
      username: "alice",
      firstName: "Alice",
      lastName: "Leak",
    }),
  );
  await assertSucceeds(
    setDoc(doc(aliceDb, "users", "alice"), {
      username: "alice",
      hasLegalName: true,
    }),
  );

  await assertSucceeds(
    setDoc(doc(aliceDb, "privateUsers", "alice"), {
      firstName: "Alice",
      lastName: "Private",
      updatedAt: new Date(),
    }),
  );
  await assertFails(getDoc(doc(bobDb, "privateUsers", "alice")));

  await assertFails(setDoc(doc(bobDb, "clips", "spoofed"), { userId: "alice", title: "Spoofed" }));
  await assertFails(
    setDoc(doc(aliceDb, "clips", "emailLeak"), {
      userId: "alice",
      title: "Email leak",
      curatorEmail: "alice@example.com",
    }),
  );
  await assertSucceeds(setDoc(doc(aliceDb, "clips", "aliceNew"), { userId: "alice", title: "New" }));
  await assertFails(updateDoc(doc(bobDb, "clips", "clip1"), { title: "Bob edit" }));
  await assertFails(updateDoc(doc(aliceDb, "clips", "clip1"), { curatorEmail: "alice@example.com" }));
  await assertSucceeds(setDoc(doc(aliceDb, "clips", "clip1", "comments", "comment1"), { text: "ok" }));
  await assertFails(setDoc(doc(aliceDb, "clips", "clip1", "reactions", "reaction1"), { emoji: "x" }));

  await assertSucceeds(
    setDoc(doc(aliceDb, "savedClips", "alice_clip1"), {
      userId: "alice",
      clipId: "clip1",
      savedAt: new Date(),
    }),
  );
  await assertSucceeds(getDocs(query(collection(aliceDb, "savedClips"), where("userId", "==", "alice"))));
  await assertFails(getDoc(doc(bobDb, "savedClips", "alice_clip1")));
  await assertFails(setDoc(doc(bobDb, "savedClips", "bob_spoof"), { userId: "alice", clipId: "clip1" }));
  await assertFails(deleteDoc(doc(bobDb, "savedClips", "alice_clip1")));

  await assertSucceeds(getDoc(doc(aliceDb, "conversations", "conv1")));
  await assertFails(getDoc(doc(charlieDb, "conversations", "conv1")));
  await assertSucceeds(updateDoc(doc(aliceDb, "conversations", "conv1"), { "unreadBy.alice": 0 }));
  await assertFails(updateDoc(doc(charlieDb, "conversations", "conv1"), { "unreadBy.charlie": 0 }));
  await assertFails(updateDoc(doc(aliceDb, "conversations", "conv1"), { participants: ["alice", "charlie"] }));

  await assertSucceeds(
    addDoc(collection(aliceDb, "conversations", "conv1", "messages"), {
      senderId: "alice",
      text: "hello",
      createdAt: new Date(),
    }),
  );
  await assertFails(
    addDoc(collection(charlieDb, "conversations", "conv1", "messages"), {
      senderId: "charlie",
      text: "intrusion",
      createdAt: new Date(),
    }),
  );
  await assertFails(getDocs(collection(charlieDb, "conversations", "conv1", "messages")));

  const saved = await getDocs(query(collection(aliceDb, "savedClips"), where("userId", "==", "alice")));
  assert.equal(saved.size, 1);

  console.log("firestore rules regressions passed");
} finally {
  await testEnv.cleanup();
}
