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
} from "firebase/firestore";

const projectId = "demo-curatd-rules";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulatorHost) {
  throw new Error("FIRESTORE_EMULATOR_HOST must be set by firebase emulators:exec");
}

const [host, portString] = emulatorHost.split(":");
const port = Number(portString);

if (!host || !Number.isFinite(port)) {
  throw new Error(`Invalid FIRESTORE_EMULATOR_HOST: ${emulatorHost}`);
}

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: {
    host,
    port,
    rules: await readFile("firestore.rules", "utf8"),
  },
});

try {
  await testEnv.clearFirestore();

  const aliceDb = testEnv.authenticatedContext("alice").firestore();
  const bobDb = testEnv.authenticatedContext("bob").firestore();
  const anonDb = testEnv.unauthenticatedContext().firestore();

  await assertSucceeds(
    setDoc(doc(aliceDb, "users", "alice"), {
      username: "alice",
      photoURL: null,
    }),
  );
  await assertSucceeds(getDoc(doc(anonDb, "users", "alice")));

  await assertFails(
    setDoc(
      doc(aliceDb, "users", "alice"),
      { firstName: "Alice", lastName: "Example" },
      { merge: true },
    ),
  );

  await assertSucceeds(
    setDoc(
      doc(aliceDb, "privateUsers", "alice"),
      {
        firstName: "Alice",
        lastName: "Example",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
  await assertSucceeds(getDoc(doc(aliceDb, "privateUsers", "alice")));
  await assertFails(getDoc(doc(bobDb, "privateUsers", "alice")));
  await assertFails(getDoc(doc(anonDb, "privateUsers", "alice")));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", "legacy"), {
      username: "legacy",
      firstName: "Legacy",
      lastName: "User",
    });
  });

  const legacyDb = testEnv.authenticatedContext("legacy").firestore();
  await assertSucceeds(
    setDoc(
      doc(legacyDb, "privateUsers", "legacy"),
      {
        firstName: "Legacy",
        lastName: "User",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
  await assertSucceeds(
    setDoc(
      doc(legacyDb, "users", "legacy"),
      { firstName: deleteField(), lastName: deleteField() },
      { merge: true },
    ),
  );

  console.log("Firestore legal-name privacy rules passed");
} finally {
  await testEnv.cleanup();
}
