import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const firestoreHelper = await readFile(new URL("../src/lib/firestore.ts", import.meta.url), "utf8");
const firestoreRules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

test("legal names are written only to privateUsers and removed from public users docs", () => {
  assert.match(firestoreHelper, /doc\(db,\s*"privateUsers",\s*uid\)/);
  assert.match(firestoreHelper, /firstName:\s*deleteField\(\)/);
  assert.match(firestoreHelper, /lastName:\s*deleteField\(\)/);
  assert.match(firestoreHelper, /hasLegalName:\s*true/);
});

test("rules keep legal-name fields out of publicly readable user documents", () => {
  assert.match(firestoreRules, /match \/privateUsers\/\{userId\}/);
  assert.match(firestoreRules, /allow read:\s*if isOwner\(userId\)/);
  assert.match(firestoreRules, /hasPublicLegalNameFields\(request\.resource\.data\)/);
  assert.match(firestoreRules, /allow read:\s*if isOwner\(userId\) \|\| !hasPublicLegalNameFields\(resource\.data\)/);
});
