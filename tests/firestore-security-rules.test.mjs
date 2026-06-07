import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const projectId = `curatd-rules-${Date.now()}`;
let testEnv;

function emulatorConfig() {
  const hostPort = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  const [host, port] = hostPort.split(":");
  return { host, port: Number(port) };
}

function authedDb(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function publicDb() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seed(callback) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await callback(ctx.firestore());
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      ...emulatorConfig(),
    },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

test("public user docs fail closed when legacy legal names are present", async () => {
  await testEnv.clearFirestore();
  await seed(async (db) => {
    await setDoc(doc(db, "users", "alice"), {
      username: "alice",
      firstName: "Alice",
      lastName: "Secret",
    });
    await setDoc(doc(db, "users", "bob"), { username: "bob" });
    await setDoc(doc(db, "privateUsers", "alice"), {
      firstName: "Alice",
      lastName: "Secret",
    });
  });

  await assertFails(getDoc(doc(publicDb(), "users", "alice")));
  await assertSucceeds(getDoc(doc(publicDb(), "users", "bob")));
  await assertSucceeds(getDoc(doc(authedDb("alice"), "users", "alice")));
  await assertFails(getDoc(doc(authedDb("bob"), "privateUsers", "alice")));

  await assertFails(
    setDoc(doc(authedDb("alice"), "users", "alice"), {
      username: "alice",
      firstName: "Alice",
      lastName: "Secret",
    }),
  );
});

test("clips cannot impersonate another owner or expose curator email", async () => {
  await testEnv.clearFirestore();
  const alice = authedDb("alice");

  await assertFails(
    setDoc(doc(alice, "clips", "bad-owner"), {
      userId: "bob",
      videoId: "v1",
      title: "impersonated",
    }),
  );
  await assertFails(
    setDoc(doc(alice, "clips", "email-leak"), {
      userId: "alice",
      videoId: "v1",
      title: "leaky",
      curatorEmail: "alice@example.com",
    }),
  );
  await assertSucceeds(
    setDoc(doc(alice, "clips", "valid"), {
      userId: "alice",
      videoId: "v1",
      title: "safe",
    }),
  );

  await seed(async (db) => {
    await setDoc(doc(db, "clips", "legacy-email"), {
      userId: "alice",
      videoId: "v2",
      title: "legacy",
      curatorEmail: "alice@example.com",
    });
  });

  await assertFails(getDoc(doc(publicDb(), "clips", "legacy-email")));
  await assertSucceeds(getDoc(doc(alice, "clips", "legacy-email")));
});

test("saved clips are scoped to their owner", async () => {
  await testEnv.clearFirestore();
  await seed(async (db) => {
    await setDoc(doc(db, "savedClips", "bob_clip1"), {
      userId: "bob",
      clipId: "clip1",
    });
  });

  await assertFails(getDoc(doc(authedDb("alice"), "savedClips", "bob_clip1")));
  await assertFails(
    setDoc(doc(authedDb("alice"), "savedClips", "alice_bad"), {
      userId: "bob",
      clipId: "clip1",
    }),
  );
  await assertSucceeds(
    setDoc(doc(authedDb("alice"), "savedClips", "alice_clip1"), {
      userId: "alice",
      clipId: "clip1",
    }),
  );
  await assertFails(deleteDoc(doc(authedDb("bob"), "savedClips", "alice_clip1")));
});

test("conversation and message access is limited to participants", async () => {
  await testEnv.clearFirestore();
  await seed(async (db) => {
    await setDoc(doc(db, "conversations", "alice_bob"), {
      participants: ["alice", "bob"],
      unreadBy: { alice: 0, bob: 0 },
    });
    await setDoc(doc(db, "conversations", "alice_bob", "messages", "m1"), {
      senderId: "alice",
      text: "hello",
      read: false,
    });
  });

  await assertSucceeds(getDoc(doc(authedDb("alice"), "conversations", "alice_bob")));
  await assertFails(getDoc(doc(authedDb("charlie"), "conversations", "alice_bob")));
  await assertFails(getDoc(doc(authedDb("charlie"), "conversations", "alice_bob", "messages", "m1")));
  await assertFails(
    setDoc(doc(authedDb("alice"), "conversations", "alice_bob", "messages", "spoof"), {
      senderId: "charlie",
      text: "spoof",
      read: false,
    }),
  );
  await assertSucceeds(
    setDoc(doc(authedDb("alice"), "conversations", "alice_bob", "messages", "m2"), {
      senderId: "alice",
      text: "legit",
      read: false,
    }),
  );
  await assertSucceeds(
    updateDoc(doc(authedDb("bob"), "conversations", "alice_bob", "messages", "m1"), {
      read: true,
    }),
  );
  await assertFails(deleteDoc(doc(authedDb("bob"), "conversations", "alice_bob", "messages", "m1")));
});

test("batched first message can create the conversation and message atomically", async () => {
  await testEnv.clearFirestore();
  const alice = authedDb("alice");
  const batch = writeBatch(alice);
  batch.set(doc(alice, "conversations", "alice_dana"), {
    participants: ["alice", "dana"],
    unreadBy: { alice: 0, dana: 1 },
  });
  batch.set(doc(alice, "conversations", "alice_dana", "messages", "first"), {
    senderId: "alice",
    text: "hi",
    read: false,
  });

  await assertSucceeds(batch.commit());
  const snap = await getDoc(doc(alice, "conversations", "alice_dana", "messages", "first"));
  assert.equal(snap.exists(), true);
});

test("follow writes cannot impersonate another follower", async () => {
  await testEnv.clearFirestore();
  await assertFails(
    setDoc(doc(authedDb("alice"), "follows", "bob_alice"), {
      followerId: "bob",
      followingId: "alice",
    }),
  );
  await assertSucceeds(
    setDoc(doc(authedDb("alice"), "follows", "alice_bob"), {
      followerId: "alice",
      followingId: "bob",
    }),
  );
  await assertFails(deleteDoc(doc(authedDb("bob"), "follows", "alice_bob")));
});
