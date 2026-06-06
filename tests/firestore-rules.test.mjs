import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const projectId = `curatd-rules-${Date.now()}`;
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules },
});

const alice = "alice";
const bob = "bob";
const charlie = "charlie";

function authedDb(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await fn(context.firestore());
  });
}

try {
  await seed(async (db) => {
    await setDoc(doc(db, "users", alice), {
      username: "alice",
      firstName: "Alice",
      lastName: "Private",
    });
    await setDoc(doc(db, "users", charlie), {
      username: "charlie",
      hasLegalName: true,
    });
  });

  await assertSucceeds(getDoc(doc(authedDb(alice), "users", alice)));
  await assertFails(getDoc(doc(authedDb(bob), "users", alice)));
  const publicUser = await assertSucceeds(getDoc(doc(authedDb(bob), "users", charlie)));
  assert.equal(publicUser.data()?.username, "charlie");

  await assertFails(
    setDoc(
      doc(authedDb(alice), "users", alice),
      { firstName: "Alice", lastName: "StillPublic" },
      { merge: true },
    ),
  );
  await assertSucceeds(
    setDoc(doc(authedDb(alice), "privateUsers", alice), {
      firstName: "Alice",
      lastName: "Private",
    }),
  );
  await assertFails(getDoc(doc(authedDb(bob), "privateUsers", alice)));
  await assertSucceeds(
    updateDoc(doc(authedDb(alice), "users", alice), {
      hasLegalName: true,
      firstName: deleteField(),
      lastName: deleteField(),
    }),
  );
  await assertSucceeds(getDoc(doc(authedDb(bob), "users", alice)));

  await assertSucceeds(
    setDoc(doc(authedDb(alice), "clips", "aliceClip"), {
      userId: alice,
      videoId: "video-1",
      audioOnly: false,
      moments: [],
    }),
  );
  await assertFails(
    setDoc(doc(authedDb(bob), "clips", "forgedClip"), {
      userId: alice,
      videoId: "video-2",
      audioOnly: false,
      moments: [],
    }),
  );
  await assertFails(
    setDoc(doc(authedDb(alice), "clips", "emailClip"), {
      userId: alice,
      curatorEmail: "alice@example.com",
      videoId: "video-3",
      audioOnly: false,
      moments: [],
    }),
  );
  await assertFails(updateDoc(doc(authedDb(bob), "clips", "aliceClip"), { title: "stolen" }));
  await assertFails(updateDoc(doc(authedDb(alice), "clips", "aliceClip"), { curatorEmail: "alice@example.com" }));

  await assertSucceeds(
    setDoc(doc(authedDb(alice), "savedClips", "alice_clip1"), {
      userId: alice,
      clipId: "clip1",
    }),
  );
  await assertFails(getDoc(doc(authedDb(bob), "savedClips", "alice_clip1")));
  await assertFails(
    setDoc(doc(authedDb(bob), "savedClips", "bob_forged"), {
      userId: alice,
      clipId: "clip1",
    }),
  );
  const ownSaved = await assertSucceeds(
    getDocs(query(collection(authedDb(alice), "savedClips"), where("userId", "==", alice))),
  );
  assert.equal(ownSaved.size, 1);

  await assertSucceeds(
    setDoc(doc(authedDb(alice), "conversations", "alice_charlie"), {
      participants: [alice, charlie],
      unreadBy: { [alice]: 0, [charlie]: 0 },
    }),
  );
  await assertSucceeds(getDoc(doc(authedDb(alice), "conversations", "alice_charlie")));
  await assertFails(getDoc(doc(authedDb(bob), "conversations", "alice_charlie")));
  await assertSucceeds(
    addDoc(collection(authedDb(alice), "conversations", "alice_charlie", "messages"), {
      senderId: alice,
      text: "hello",
      type: "text",
    }),
  );
  await assertFails(
    addDoc(collection(authedDb(bob), "conversations", "alice_charlie", "messages"), {
      senderId: bob,
      text: "intrude",
      type: "text",
    }),
  );
} finally {
  await testEnv.cleanup();
}
