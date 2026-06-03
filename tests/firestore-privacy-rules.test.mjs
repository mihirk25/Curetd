import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const PROJECT_ID = "curatd-firestore-privacy";

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: await readFile("firestore.rules", "utf8"),
  },
});

try {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "alice"), {
      username: "alice",
      firstName: "Alice",
      lastName: "Liddell",
    });
    await setDoc(doc(db, "users", "bob"), {
      username: "bob",
    });
  });

  const anonDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonDb, "users", "alice")));
  const publicProfile = await assertSucceeds(getDoc(doc(anonDb, "users", "bob")));
  assert.equal(publicProfile.data()?.username, "bob");

  const aliceDb = testEnv.authenticatedContext("alice").firestore();
  await assertSucceeds(getDoc(doc(aliceDb, "users", "alice")));
  await assertFails(
    setDoc(
      doc(aliceDb, "users", "alice"),
      { firstName: "Alice", lastName: "Liddell" },
      { merge: true },
    ),
  );

  await assertSucceeds(
    setDoc(doc(aliceDb, "privateUsers", "alice"), {
      firstName: "Alice",
      lastName: "Liddell",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    updateDoc(doc(aliceDb, "users", "alice"), {
      firstName: deleteField(),
      lastName: deleteField(),
      hasLegalName: true,
    }),
  );
  await assertSucceeds(getDoc(doc(anonDb, "users", "alice")));

  const bobDb = testEnv.authenticatedContext("bob").firestore();
  await assertFails(getDoc(doc(bobDb, "privateUsers", "alice")));
  await assertFails(
    setDoc(doc(bobDb, "privateUsers", "alice"), {
      firstName: "Mallory",
      lastName: "Other",
      updatedAt: serverTimestamp(),
    }),
  );

  console.log("Firestore privacy rules regression passed.");
} finally {
  await testEnv.cleanup();
}
