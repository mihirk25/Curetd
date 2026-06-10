import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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

const PROJECT_ID = "curatd-rules-test";

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    },
  });
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
});

test.after(async () => {
  await testEnv.cleanup();
});

function authed(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seed(callback) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await callback(context.firestore());
  });
}

test("legal names are blocked from public profiles and owner-only in privateUsers", async () => {
  await seed(async (db) => {
    await setDoc(doc(db, "users", "victim"), {
      username: "victim",
      firstName: "Vic",
      lastName: "Tim",
    });
    await setDoc(doc(db, "privateUsers", "victim"), {
      firstName: "Vic",
      lastName: "Tim",
    });
  });

  await assertFails(getDoc(doc(authed("attacker"), "users", "victim")));
  await assertSucceeds(getDoc(doc(authed("victim"), "users", "victim")));
  await assertFails(getDoc(doc(authed("attacker"), "privateUsers", "victim")));
  await assertSucceeds(getDoc(doc(authed("victim"), "privateUsers", "victim")));

  await assertFails(
    setDoc(doc(authed("victim"), "users", "victim"), {
      username: "victim",
      firstName: "Vic",
    }),
  );
  await assertSucceeds(
    setDoc(doc(authed("victim"), "privateUsers", "victim"), {
      firstName: "Vic",
      lastName: "Tim",
    }),
  );
});

test("savedClips are isolated by userId", async () => {
  await assertSucceeds(
    setDoc(doc(authed("alice"), "savedClips", "alice_clip1"), {
      userId: "alice",
      clipId: "clip1",
    }),
  );

  await assertSucceeds(getDoc(doc(authed("alice"), "savedClips", "alice_clip1")));
  await assertFails(getDoc(doc(authed("bob"), "savedClips", "alice_clip1")));
  await assertFails(deleteDoc(doc(authed("bob"), "savedClips", "alice_clip1")));
  await assertFails(
    setDoc(doc(authed("alice"), "savedClips", "spoofed"), {
      userId: "bob",
      clipId: "clip1",
    }),
  );
});

test("clips must be owned by the authenticated creator and cannot add public curatorEmail", async () => {
  await assertSucceeds(
    setDoc(doc(authed("alice"), "clips", "clip1"), {
      userId: "alice",
      title: "Clip",
    }),
  );
  await assertFails(
    setDoc(doc(authed("alice"), "clips", "spoofed"), {
      userId: "bob",
      title: "Spoof",
    }),
  );
  await assertFails(
    setDoc(doc(authed("alice"), "clips", "email_leak"), {
      userId: "alice",
      title: "Leak",
      curatorEmail: "alice@example.com",
    }),
  );
  await assertSucceeds(updateDoc(doc(authed("alice"), "clips", "clip1"), { title: "Updated" }));
  await assertFails(updateDoc(doc(authed("bob"), "clips", "clip1"), { title: "Stolen" }));
  await assertFails(updateDoc(doc(authed("alice"), "clips", "clip1"), { curatorEmail: "alice@example.com" }));
});

test("conversation documents and messages are participant-only", async () => {
  await seed(async (db) => {
    await setDoc(doc(db, "conversations", "alice_bob"), {
      participants: ["alice", "bob"],
      lastMessage: "",
    });
    await setDoc(doc(db, "conversations", "alice_bob", "messages", "m1"), {
      senderId: "alice",
      text: "secret",
    });
  });

  await assertSucceeds(getDoc(doc(authed("alice"), "conversations", "alice_bob")));
  await assertFails(getDoc(doc(authed("charlie"), "conversations", "alice_bob")));
  await assertSucceeds(getDoc(doc(authed("bob"), "conversations", "alice_bob", "messages", "m1")));
  await assertFails(getDoc(doc(authed("charlie"), "conversations", "alice_bob", "messages", "m1")));
  await assertSucceeds(
    addDoc(collection(authed("bob"), "conversations", "alice_bob", "messages"), {
      senderId: "bob",
      text: "reply",
    }),
  );
  await assertFails(
    addDoc(collection(authed("alice"), "conversations", "alice_bob", "messages"), {
      senderId: "charlie",
      text: "forged",
    }),
  );
});

test("non-participants cannot create conversations for other users", async () => {
  await assertSucceeds(
    setDoc(doc(authed("alice"), "conversations", "alice_bob"), {
      participants: ["alice", "bob"],
      lastMessage: "",
    }),
  );
  await assertFails(
    setDoc(doc(authed("charlie"), "conversations", "alice_bob_2"), {
      participants: ["alice", "bob"],
      lastMessage: "",
    }),
  );

  const snap = await assertSucceeds(getDoc(doc(authed("alice"), "conversations", "alice_bob")));
  assert.equal(snap.exists(), true);
});
