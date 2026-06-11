import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";

const projectId = `curatd-rules-${Date.now()}`;
const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
  },
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc("users/alice").set({
      username: "alice",
      firstName: "Alice",
      lastName: "Example",
    });
    await db.doc("users/bob").set({ username: "bob", photoURL: null });
    await db.doc("savedClips/alice_clip1").set({
      userId: "alice",
      clipId: "clip1",
    });
    await db.doc("conversations/alice_bob").set({
      participants: ["alice", "bob"],
      lastMessage: "",
    });
    await db.doc("conversations/alice_bob/messages/m1").set({
      senderId: "alice",
      text: "secret",
    });
    await db.doc("clips/clip1").set({
      userId: "alice",
      title: "Clip",
      repostCount: 0,
    });
  });

  const anon = testEnv.unauthenticatedContext().firestore();
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();
  const charlie = testEnv.authenticatedContext("charlie").firestore();

  await assertFails(anon.doc("users/alice").get());
  await assertSucceeds(anon.doc("users/bob").get());
  await assertSucceeds(alice.doc("users/alice").get());

  await assertSucceeds(
    alice.doc("privateUsers/alice").set({ firstName: "Alice", lastName: "Example" }),
  );
  await assertFails(bob.doc("privateUsers/alice").get());
  await assertFails(
    alice.doc("users/alice").set({ username: "alice", firstName: "Alice" }, { merge: true }),
  );

  await assertSucceeds(
    alice.collection("savedClips").where("userId", "==", "alice").get(),
  );
  await assertFails(bob.doc("savedClips/alice_clip1").get());
  await assertFails(
    bob.doc("savedClips/bad").set({ userId: "alice", clipId: "clip1" }),
  );
  await assertSucceeds(
    bob.doc("savedClips/bob_clip1").set({ userId: "bob", clipId: "clip1" }),
  );

  await assertSucceeds(alice.doc("conversations/alice_bob").get());
  await assertFails(charlie.doc("conversations/alice_bob").get());
  await assertFails(
    charlie.doc("conversations/alice_bob/messages/bad").set({
      senderId: "charlie",
      text: "intrusion",
    }),
  );
  await assertSucceeds(
    bob.doc("conversations/alice_bob/messages/b2").set({
      senderId: "bob",
      text: "reply",
    }),
  );

  await assertSucceeds(
    alice.collection("clips").add({ userId: "alice", title: "Allowed" }),
  );
  await assertFails(
    bob.collection("clips").add({ userId: "alice", title: "Impersonated" }),
  );
  await assertFails(
    alice.collection("clips").add({
      userId: "alice",
      title: "Leaks email",
      curatorEmail: "alice@example.com",
    }),
  );
  await assertFails(bob.doc("clips/clip1").update({ title: "Taken over" }));
  await assertSucceeds(bob.doc("clips/clip1").update({ repostCount: 1 }));

  await assertSucceeds(
    bob.doc("clips/clip1/comments/comment1").set({
      userId: "bob",
      text: "Nice",
    }),
  );
  await assertFails(charlie.doc("clips/clip1/comments/comment1").delete());
  await assertSucceeds(alice.doc("clips/clip1/comments/comment1").delete());

  assert.ok(true);
} finally {
  await testEnv.cleanup();
}
