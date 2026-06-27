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
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const projectId = `curatd-rules-${Date.now()}`;

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
  },
});

try {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "victim"), {
      username: "victim",
      firstName: "Private",
      lastName: "Person",
    });
    await setDoc(doc(db, "users", "publicUser"), {
      username: "public",
      hasLegalName: true,
    });
    await setDoc(doc(db, "privateUsers", "alice"), {
      firstName: "Alice",
      lastName: "Owner",
    });
    await setDoc(doc(db, "clips", "clipA"), {
      userId: "alice",
      title: "Alice clip",
      moments: [],
    });
    await setDoc(doc(db, "conversations", "alice_bob"), {
      participants: ["alice", "bob"],
      lastMessage: "hi",
      unreadBy: { alice: 0, bob: 1 },
    });
    await setDoc(doc(db, "conversations", "alice_bob", "messages", "m1"), {
      senderId: "alice",
      text: "secret",
      read: false,
    });
  });

  const anon = testEnv.unauthenticatedContext().firestore();
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();
  const mallory = testEnv.authenticatedContext("mallory").firestore();

  await assertFails(getDoc(doc(anon, "users", "victim")));
  await assertSucceeds(getDoc(doc(anon, "users", "publicUser")));
  await assertSucceeds(getDoc(doc(alice, "privateUsers", "alice")));
  await assertFails(getDoc(doc(bob, "privateUsers", "alice")));

  await assertSucceeds(
    setDoc(doc(alice, "savedClips", "alice_clipA"), {
      userId: "alice",
      clipId: "clipA",
    }),
  );
  await assertSucceeds(
    getDocs(query(collection(alice, "savedClips"), where("userId", "==", "alice"))),
  );
  await assertFails(getDoc(doc(bob, "savedClips", "alice_clipA")));
  await assertFails(deleteDoc(doc(bob, "savedClips", "alice_clipA")));
  await assertFails(
    setDoc(doc(bob, "savedClips", "bob_claims_alice"), {
      userId: "alice",
      clipId: "clipA",
    }),
  );

  await assertSucceeds(getDoc(doc(alice, "conversations", "alice_bob")));
  await assertSucceeds(getDocs(collection(alice, "conversations", "alice_bob", "messages")));
  await assertFails(getDoc(doc(mallory, "conversations", "alice_bob")));
  await assertFails(getDocs(collection(mallory, "conversations", "alice_bob", "messages")));
  await assertSucceeds(
    addDoc(collection(alice, "conversations", "alice_bob", "messages"), {
      senderId: "alice",
      text: "from alice",
    }),
  );
  await assertFails(
    addDoc(collection(mallory, "conversations", "alice_bob", "messages"), {
      senderId: "mallory",
      text: "intrusion",
    }),
  );
  await assertFails(
    addDoc(collection(alice, "conversations", "alice_bob", "messages"), {
      senderId: "mallory",
      text: "spoofed",
    }),
  );
  await assertSucceeds(
    addDoc(collection(alice, "conversations"), {
      participants: ["alice", "bob"],
      lastMessage: "",
    }),
  );
  await assertFails(
    addDoc(collection(mallory, "conversations"), {
      participants: ["alice", "bob"],
      lastMessage: "",
    }),
  );

  await assertFails(
    setDoc(doc(bob, "clips", "spoofed"), {
      userId: "victim",
      title: "spoofed",
    }),
  );
  await assertFails(
    setDoc(doc(alice, "clips", "emailLeak"), {
      userId: "alice",
      title: "leak",
      curatorEmail: "alice@example.com",
    }),
  );
  await assertSucceeds(
    setDoc(doc(alice, "clips", "aliceNew"), {
      userId: "alice",
      title: "safe",
    }),
  );
  await assertFails(updateDoc(doc(bob, "clips", "clipA"), { title: "stolen" }));
  await assertFails(updateDoc(doc(alice, "clips", "clipA"), { curatorEmail: "alice@example.com" }));
  await assertSucceeds(updateDoc(doc(alice, "clips", "clipA"), { title: "updated" }));

  assert.ok(true);
} finally {
  await testEnv.cleanup();
}
