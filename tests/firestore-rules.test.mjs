import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
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

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

function authedDb(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function publicDb() {
  return testEnv.unauthenticatedContext().firestore();
}

describe("Firestore privacy and ownership rules", () => {
  it("keeps legal names owner-only and blocks future public writes", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", "victim"), {
        username: "victim",
        firstName: "Private",
        lastName: "Person",
      });
    });

    await assertFails(getDoc(doc(publicDb(), "users", "victim")));
    await assertSucceeds(getDoc(doc(authedDb("victim"), "users", "victim")));

    await assertFails(
      setDoc(doc(authedDb("victim"), "users", "victim"), { firstName: "Leak" }, { merge: true }),
    );
    await assertSucceeds(
      setDoc(doc(authedDb("victim"), "privateUsers", "victim"), {
        firstName: "Private",
        lastName: "Person",
        updatedAt: new Date(),
      }),
    );
    await assertFails(getDoc(doc(authedDb("other"), "privateUsers", "victim")));
  });

  it("isolates saved clips by user", async () => {
    await assertSucceeds(
      setDoc(doc(authedDb("u1"), "savedClips", "u1_clipA"), {
        userId: "u1",
        clipId: "clipA",
        savedAt: new Date(),
      }),
    );

    await assertSucceeds(getDoc(doc(authedDb("u1"), "savedClips", "u1_clipA")));
    await assertFails(getDoc(doc(authedDb("u2"), "savedClips", "u1_clipA")));
    await assertFails(deleteDoc(doc(authedDb("u2"), "savedClips", "u1_clipA")));
    await assertFails(
      setDoc(doc(authedDb("u2"), "savedClips", "u2_bad"), {
        userId: "u1",
        clipId: "clipA",
      }),
    );
  });

  it("prevents clip impersonation and ownership transfer", async () => {
    await assertFails(
      setDoc(doc(authedDb("attacker"), "clips", "impersonated"), {
        userId: "victim",
        title: "fake",
      }),
    );
    await assertFails(
      setDoc(doc(authedDb("owner"), "clips", "email-leak"), {
        userId: "owner",
        curatorEmail: "owner@example.com",
      }),
    );
    await assertSucceeds(
      setDoc(doc(authedDb("owner"), "clips", "owned"), {
        userId: "owner",
        title: "real",
      }),
    );
    await assertFails(updateDoc(doc(authedDb("owner"), "clips", "owned"), { userId: "victim" }));
  });

  it("limits conversations and messages to participants", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "conversations", "c1"), {
        participants: ["u1", "u2"],
        lastMessage: "",
      });
    });

    await assertSucceeds(getDoc(doc(authedDb("u1"), "conversations", "c1")));
    await assertFails(getDoc(doc(authedDb("u3"), "conversations", "c1")));
    await assertFails(
      addDoc(collection(authedDb("u3"), "conversations", "c1", "messages"), {
        senderId: "u3",
        text: "intrusion",
      }),
    );
    await assertSucceeds(
      addDoc(collection(authedDb("u2"), "conversations", "c1", "messages"), {
        senderId: "u2",
        text: "hello",
      }),
    );
  });

  it("protects clip comments from unrelated users", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "clips", "clipA"), { userId: "owner" });
      await setDoc(doc(ctx.firestore(), "clips", "clipA", "comments", "commentA"), {
        userId: "commenter",
        text: "keep me",
      });
    });

    await assertFails(deleteDoc(doc(authedDb("attacker"), "clips", "clipA", "comments", "commentA")));
    await assertSucceeds(deleteDoc(doc(authedDb("commenter"), "clips", "clipA", "comments", "commentA")));
    assert.ok(true);
  });
});
