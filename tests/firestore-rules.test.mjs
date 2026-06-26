import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
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
  writeBatch,
} from "firebase/firestore";

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-curatd",
    firestore: {
      rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

function authed(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function anon() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

test("legal names are private and cannot be written to public user docs", async () => {
  await seed("users/alice", {
    username: "alice",
    firstName: "Alice",
    lastName: "Private",
  });

  await assertFails(getDoc(doc(anon(), "users/alice")));
  await assertSucceeds(getDoc(doc(authed("alice"), "users/alice")));
  await assertFails(getDoc(doc(authed("bob"), "privateUsers/alice")));
  await assertSucceeds(
    setDoc(doc(authed("alice"), "privateUsers/alice"), {
      firstName: "Alice",
      lastName: "Private",
    }),
  );
  await assertFails(
    setDoc(doc(authed("alice"), "users/alice"), {
      username: "alice",
      firstName: "Alice",
      lastName: "Private",
    }),
  );
  await assertSucceeds(
    setDoc(doc(authed("alice"), "users/alice"), {
      username: "alice",
      hasLegalName: true,
    }),
  );
  await assertSucceeds(getDoc(doc(anon(), "users/alice")));
});

test("saved clips are isolated to the owning user", async () => {
  const aliceSave = doc(authed("alice"), "savedClips/alice_clip1");

  await assertFails(
    setDoc(doc(authed("alice"), "savedClips/bad"), {
      userId: "bob",
      clipId: "clip1",
    }),
  );
  await assertSucceeds(
    setDoc(aliceSave, {
      userId: "alice",
      clipId: "clip1",
    }),
  );
  await assertSucceeds(getDoc(doc(authed("alice"), "savedClips/alice_clip1")));
  await assertFails(getDoc(doc(authed("bob"), "savedClips/alice_clip1")));
  await assertFails(deleteDoc(doc(authed("bob"), "savedClips/alice_clip1")));
  await assertSucceeds(deleteDoc(doc(authed("alice"), "savedClips/alice_clip1")));
});

test("clips cannot be impersonated and public email fields are rejected", async () => {
  await assertFails(
    addDoc(collection(authed("alice"), "clips"), {
      userId: "bob",
      title: "Impersonation",
    }),
  );
  await assertFails(
    addDoc(collection(authed("alice"), "clips"), {
      userId: "alice",
      title: "Email leak",
      curatorEmail: "alice@example.com",
    }),
  );

  await assertSucceeds(
    setDoc(doc(authed("alice"), "clips/clip1"), {
      userId: "alice",
      title: "Safe clip",
    }),
  );
  await assertFails(
    updateDoc(doc(authed("bob"), "clips/clip1"), {
      title: "Hijacked",
    }),
  );
  await assertFails(
    setDoc(doc(authed("bob"), "clips/clip1/likes/alice"), {
      likedAt: 1,
    }),
  );
  await assertSucceeds(
    setDoc(doc(authed("alice"), "clips/clip1/likes/alice"), {
      likedAt: 1,
    }),
  );
  await assertFails(
    addDoc(collection(authed("bob"), "clips/clip1/comments"), {
      userId: "alice",
      text: "spoofed",
    }),
  );
});

test("conversation reads and writes are limited to participants", async () => {
  await assertSucceeds(
    setDoc(doc(authed("alice"), "conversations/alice_bob"), {
      participants: ["alice", "bob"],
      lastMessage: "",
    }),
  );
  await assertSucceeds(getDoc(doc(authed("bob"), "conversations/alice_bob")));
  await assertFails(getDoc(doc(authed("charlie"), "conversations/alice_bob")));
  await assertFails(
    addDoc(collection(authed("charlie"), "conversations/alice_bob/messages"), {
      senderId: "charlie",
      text: "intrusion",
    }),
  );
  await assertFails(
    addDoc(collection(authed("bob"), "conversations/alice_bob/messages"), {
      senderId: "alice",
      text: "spoofed",
    }),
  );
  const messageRef = doc(collection(authed("alice"), "conversations/alice_bob/messages"));
  await assertSucceeds(
    setDoc(messageRef, {
      senderId: "alice",
      text: "hello",
      read: false,
    }),
  );
  await assertSucceeds(getDoc(doc(authed("bob"), messageRef.path)));
  await assertFails(getDoc(doc(authed("charlie"), messageRef.path)));
});

test("batched first message can create its conversation atomically", async () => {
  const db = authed("alice");
  const batch = writeBatch(db);
  batch.set(doc(db, "conversations/alice_bob"), {
    participants: ["alice", "bob"],
    lastMessage: "hello",
  });
  batch.set(doc(collection(db, "conversations/alice_bob/messages")), {
    senderId: "alice",
    text: "hello",
  });

  await assertSucceeds(batch.commit());
  const snap = await getDoc(doc(authed("bob"), "conversations/alice_bob"));
  assert.equal(snap.exists(), true);
});

test("follow edges can only be created or deleted by the follower", async () => {
  await assertFails(
    setDoc(doc(authed("alice"), "follows/bob_alice"), {
      followerId: "bob",
      followingId: "alice",
    }),
  );
  await assertSucceeds(
    setDoc(doc(authed("alice"), "follows/alice_bob"), {
      followerId: "alice",
      followingId: "bob",
    }),
  );
  await assertFails(deleteDoc(doc(authed("bob"), "follows/alice_bob")));
  await assertSucceeds(deleteDoc(doc(authed("alice"), "follows/alice_bob")));
});
