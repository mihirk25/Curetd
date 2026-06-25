import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
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

const projectId = `curatd-rules-${Date.now()}`;
const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: {
    rules: fs.readFileSync("firestore.rules", "utf8"),
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
    await setDoc(doc(db, "privateUsers", "alice"), {
      firstName: "Alice",
      lastName: "Private",
    });
    await setDoc(doc(db, "savedClips", "alice_clip-1"), {
      userId: "alice",
      clipId: "clip-1",
    });
    await setDoc(doc(db, "savedClips", "bob_clip-1"), {
      userId: "bob",
      clipId: "clip-1",
    });
    await setDoc(doc(db, "conversations", "alice_bob"), {
      participants: ["alice", "bob"],
      lastMessage: "",
    });
    await setDoc(doc(db, "clips", "legacy-clip"), {
      userId: "alice",
      videoId: "v1",
      audioOnly: false,
      curatorEmail: "private@example.com",
    });
  });

  const anonDb = testEnv.unauthenticatedContext().firestore();
  const aliceDb = testEnv.authenticatedContext("alice").firestore();
  const bobDb = testEnv.authenticatedContext("bob").firestore();
  const malloryDb = testEnv.authenticatedContext("mallory").firestore();

  await assertFails(getDoc(doc(anonDb, "users", "alice")));
  await assertSucceeds(getDoc(doc(aliceDb, "users", "alice")));
  await assertSucceeds(getDoc(doc(anonDb, "users", "bob")));

  await assertFails(
    setDoc(doc(aliceDb, "users", "alice"), {
      username: "alice",
      firstName: "Alice",
      lastName: "Private",
    }),
  );
  await assertSucceeds(
    setDoc(
      doc(aliceDb, "privateUsers", "alice"),
      { firstName: "Alice", lastName: "Private" },
      { merge: true },
    ),
  );
  await assertSucceeds(
    updateDoc(doc(aliceDb, "users", "alice"), {
      firstName: deleteField(),
      lastName: deleteField(),
      hasLegalName: true,
    }),
  );
  await assertSucceeds(getDoc(doc(aliceDb, "privateUsers", "alice")));
  await assertFails(getDoc(doc(bobDb, "privateUsers", "alice")));

  await assertFails(
    setDoc(doc(aliceDb, "clips", "bad-email"), {
      userId: "alice",
      videoId: "v2",
      audioOnly: false,
      curatorEmail: "private@example.com",
    }),
  );
  await assertFails(
    setDoc(doc(aliceDb, "clips", "bad-owner"), {
      userId: "bob",
      videoId: "v2",
      audioOnly: false,
    }),
  );
  await assertSucceeds(
    setDoc(doc(aliceDb, "clips", "good-clip"), {
      userId: "alice",
      videoId: "v2",
      audioOnly: false,
      moments: [],
    }),
  );
  await assertFails(updateDoc(doc(bobDb, "clips", "good-clip"), { title: "takeover" }));
  await assertFails(
    updateDoc(doc(aliceDb, "clips", "legacy-clip"), {
      curatorEmail: "private@example.com",
    }),
  );
  await assertSucceeds(
    updateDoc(doc(aliceDb, "clips", "legacy-clip"), {
      curatorEmail: deleteField(),
      userId: "alice",
      title: "scrubbed",
    }),
  );

  await assertSucceeds(getDoc(doc(aliceDb, "savedClips", "alice_clip-1")));
  await assertFails(getDoc(doc(aliceDb, "savedClips", "bob_clip-1")));
  await assertSucceeds(
    getDocs(query(collection(aliceDb, "savedClips"), where("userId", "==", "alice"))),
  );
  await assertFails(getDocs(collection(aliceDb, "savedClips")));
  await assertFails(
    setDoc(doc(aliceDb, "savedClips", "alice_bad"), {
      userId: "bob",
      clipId: "clip-2",
    }),
  );

  await assertSucceeds(getDoc(doc(aliceDb, "conversations", "alice_bob")));
  await assertFails(getDoc(doc(malloryDb, "conversations", "alice_bob")));
  await assertSucceeds(
    setDoc(doc(aliceDb, "conversations", "alice_bob", "messages", "m1"), {
      senderId: "alice",
      text: "hello",
      createdAt: new Date(),
    }),
  );
  await assertFails(
    setDoc(doc(malloryDb, "conversations", "alice_bob", "messages", "m2"), {
      senderId: "mallory",
      text: "intrude",
      createdAt: new Date(),
    }),
  );

  console.log("firestore rules regressions passed");
} finally {
  await testEnv.cleanup();
}

assert.ok(true);
