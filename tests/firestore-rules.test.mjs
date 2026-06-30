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
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const PROJECT_ID = `curatd-rules-${Date.now()}`;

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  },
});

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

try {
  await testEnv.clearFirestore();

  await seed("users/alice", {
    username: "alice",
    firstName: "Alice",
    lastName: "Private",
  });

  const anon = testEnv.unauthenticatedContext().firestore();
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();

  await assertFails(getDoc(doc(anon, "users/alice")));
  await assertSucceeds(getDoc(doc(alice, "users/alice")));

  await assertFails(
    setDoc(
      doc(alice, "users/alice"),
      { firstName: "Alice", lastName: "Private" },
      { merge: true },
    ),
  );
  await assertSucceeds(
    setDoc(
      doc(alice, "privateUsers/alice"),
      { firstName: "Alice", lastName: "Private", updatedAt: serverTimestamp() },
      { merge: true },
    ),
  );
  await assertFails(getDoc(doc(bob, "privateUsers/alice")));

  await assertFails(
    addDoc(collection(bob, "clips"), {
      userId: "alice",
      videoId: "v1",
      audioOnly: false,
      title: "Spoofed",
    }),
  );
  await assertFails(
    addDoc(collection(alice, "clips"), {
      userId: "alice",
      videoId: "v1",
      audioOnly: false,
      title: "Leaky",
      curatorEmail: "alice@example.com",
    }),
  );

  await seed("clips/clip1", {
    userId: "alice",
    videoId: "v1",
    audioOnly: false,
    title: "Owned",
    moments: [],
  });
  await assertFails(updateDoc(doc(bob, "clips/clip1"), { title: "Taken" }));
  await assertSucceeds(updateDoc(doc(alice, "clips/clip1"), { title: "Updated" }));

  await seed("savedClips/alice_clip1", {
    userId: "alice",
    clipId: "clip1",
  });
  await assertSucceeds(getDoc(doc(alice, "savedClips/alice_clip1")));
  await assertFails(getDoc(doc(bob, "savedClips/alice_clip1")));
  await assertFails(
    setDoc(doc(bob, "savedClips/bob_spoof"), {
      userId: "alice",
      clipId: "clip1",
    }),
  );

  await seed("conversations/alice_bob", {
    participants: ["alice", "bob"],
    lastMessage: "",
  });
  await assertSucceeds(getDoc(doc(alice, "conversations/alice_bob")));
  await assertFails(
    getDoc(doc(testEnv.authenticatedContext("mallory").firestore(), "conversations/alice_bob")),
  );

  const batch = writeBatch(alice);
  batch.set(doc(alice, "conversations/alice_charlie"), {
    participants: ["alice", "charlie"],
    lastMessage: "hello",
  });
  batch.set(doc(collection(alice, "conversations/alice_charlie/messages")), {
    senderId: "alice",
    text: "hello",
    createdAt: serverTimestamp(),
    read: false,
  });
  await assertSucceeds(batch.commit());

  assert.ok(true);
} finally {
  await testEnv.cleanup();
}
