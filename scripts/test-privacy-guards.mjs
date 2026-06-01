import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const firestoreLib = await readFile(new URL("../src/lib/firestore.ts", import.meta.url), "utf8");
const usernameSetup = await readFile(new URL("../app/username-setup.tsx", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

assert.match(
  firestoreLib,
  /doc\(db,\s*"privateUsers",\s*uid\)/,
  "legal names must be written to privateUsers",
);
assert.match(
  firestoreLib,
  /firstName:\s*deleteField\(\)/,
  "legacy firstName must be scrubbed from public users docs",
);
assert.match(
  firestoreLib,
  /lastName:\s*deleteField\(\)/,
  "legacy lastName must be scrubbed from public users docs",
);
assert.match(
  usernameSetup,
  /doc\(db,\s*"privateUsers",\s*user\.uid\)/,
  "onboarding must gate on owner-only private profile",
);
assert.match(
  usernameSetup,
  /migratePublicLegalName\(user\.uid,\s*data\)/,
  "onboarding must migrate legacy public legal names for the owner",
);
assert.match(
  rules,
  /match \/privateUsers\/\{userId\}/,
  "rules must define privateUsers access",
);
assert.match(
  rules,
  /allow read: if signedInAs\(userId\);/,
  "privateUsers reads must be owner-only",
);
assert.match(
  rules,
  /allow read: if signedInAs\(userId\) \|\| !resource\.data\.keys\(\)\.hasAny\(privateUserFields\(\)\);/,
  "public users docs with legacy legal names must not be publicly readable",
);
assert.match(
  rules,
  /request\.resource\.data\.keys\(\)\.hasOnly\(publicUserFields\(\)\)/,
  "public users writes must be limited to public profile fields",
);

console.log("privacy guard regression tests passed");
