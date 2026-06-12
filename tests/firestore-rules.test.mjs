import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const projectId = `curatd-rules-${Date.now()}`;

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
  },
});

async function reset() {
  await testEnv.clearFirestore();
}

function authed(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function guest() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seed(callback) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await callback(context.firestore());
  });
}

try {
  await reset();
  await seed(async (db) => {
    await setDoc(doc(db, "users", "alice"), {
      username: "alice",
      firstName: "Alice",
      lastName: "Private",
    });
    await setDoc(doc(db, "users", "public"), { username: "public" });
  });

  await assertSucceeds(getDoc(doc(guest(), "users", "public")));
  await assertFails(getDoc(doc(guest(), "users", "alice")));
  await assertFails(getDoc(doc(authed("bob"), "users", "alice")));
  await assertSucceeds(getDoc(doc(authed("alice"), "users", "alice")));
  await assertFails(
    setDoc(doc(authed("alice"), "users", "alice"), { firstName: "Alice" }, { merge: true }),
  );
  await assertSucceeds(
    setDoc(
      doc(authed("alice"), "users", "alice"),
      {
        hasLegalName: true,
        firstName: deleteField(),
        lastName: deleteField(),
      },
      { merge: true },
    ),
  );
  await assertSucceeds(getDoc(doc(guest(), "users", "alice")));

  await reset();
  await assertSucceeds(
    setDoc(doc(authed("alice"), "privateUsers", "alice"), {
      firstName: "Alice",
      lastName: "Private",
      updatedAt: new Date(),
    }),
  );
  await assertFails(getDoc(doc(authed("bob"), "privateUsers", "alice")));

  await reset();
  await assertSucceeds(
    setDoc(doc(authed("alice"), "savedClips", "alice_clip1"), {
      userId: "alice",
      clipId: "clip1",
    }),
  );
  await assertFails(getDoc(doc(authed("bob"), "savedClips", "alice_clip1")));
  await assertFails(
    setDoc(doc(authed("bob"), "savedClips", "bob_bad"), {
      userId: "alice",
      clipId: "clip1",
    }),
  );

  await reset();
  await assertFails(
    setDoc(doc(authed("alice"), "clips", "clip1"), {
      userId: "alice",
      title: "Clip",
      curatorEmail: "alice@example.com",
    }),
  );
  await assertSucceeds(
    setDoc(doc(authed("alice"), "clips", "clip1"), {
      userId: "alice",
      title: "Clip",
      moments: [],
    }),
  );
  await assertFails(updateDoc(doc(authed("bob"), "clips", "clip1"), { title: "stolen" }));
  await assertFails(updateDoc(doc(authed("alice"), "clips", "clip1"), { curatorEmail: "alice@example.com" }));
  await assertSucceeds(updateDoc(doc(authed("alice"), "clips", "clip1"), { title: "Updated" }));

  await reset();
  await assertSucceeds(
    setDoc(doc(authed("alice"), "conversations", "c1"), {
      participants: ["alice", "bob"],
      lastMessage: "",
    }),
  );
  await assertSucceeds(
    setDoc(doc(authed("alice"), "conversations", "c1", "messages", "m1"), {
      senderId: "alice",
      text: "hello",
    }),
  );
  await assertSucceeds(getDoc(doc(authed("bob"), "conversations", "c1", "messages", "m1")));
  await assertFails(getDoc(doc(authed("eve"), "conversations", "c1", "messages", "m1")));
  await assertFails(updateDoc(doc(authed("bob"), "conversations", "c1"), { participants: ["bob", "eve"] }));
  await assertFails(deleteDoc(doc(authed("bob"), "conversations", "c1", "messages", "m1")));
  await assertSucceeds(deleteDoc(doc(authed("alice"), "conversations", "c1", "messages", "m1")));
  await assertFails(deleteDoc(doc(authed("alice"), "conversations", "c1")));

  assert.ok(true);
  console.log("Firestore rules regression tests passed.");
} finally {
  await testEnv.cleanup();
}
