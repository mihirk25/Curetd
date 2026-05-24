import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const firestoreSource = readFileSync(new URL("../src/lib/firestore.ts", import.meta.url), "utf8");
const onboardingSource = readFileSync(new URL("../app/username-setup.tsx", import.meta.url), "utf8");
const rulesSource = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("legal names are stored outside public user profiles", () => {
  assert.match(firestoreSource, /doc\(db, "privateUsers", uid\)/);
  assert.match(firestoreSource, /firstName: deleteField\(\)/);
  assert.match(firestoreSource, /lastName: deleteField\(\)/);
  assert.match(onboardingSource, /doc\(db, "privateUsers", user\.uid\)/);
});

test("Firestore rules keep legal names owner-only", () => {
  assert.match(rulesSource, /match \/privateUsers\/\{userId\}/);
  assert.match(rulesSource, /allow read: if request\.auth != null && request\.auth\.uid == userId/);
  assert.match(rulesSource, /!request\.resource\.data\.keys\(\)\.hasAny\(\['firstName', 'lastName'\]\)/);
});
