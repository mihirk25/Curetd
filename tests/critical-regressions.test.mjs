import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rulesSource = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const collectionPageSource = readFileSync(
  new URL("../app/[username]/collections/[slug]/page.tsx", import.meta.url),
  "utf8",
);
const groupClientSource = readFileSync(new URL("../app/lib/firestore.ts", import.meta.url), "utf8");
const messagingSource = readFileSync(new URL("../app/messages/messaging.ts", import.meta.url), "utf8");

function conversationsBlock() {
  const match = rulesSource.match(/match \/conversations\/\{id\} \{([\s\S]*?)\n    \}/);
  assert.ok(match, "expected conversations rule block");
  return match[1];
}

function collectionsBlock() {
  const match = rulesSource.match(/match \/collections\/\{id\} \{([\s\S]*?)\n    \}/);
  assert.ok(match, "expected collections rule block");
  return match[1];
}

function testGroupCreatesCannotOccupyDmSlots() {
  assert.match(rulesSource, /function isValidGroupConversationCreate\(id\)/);
  assert.match(rulesSource, /id\.matches\('\^group_\.\*'\)/);
  const block = conversationsBlock();
  assert.match(
    block,
    /allow create: if isValidDmConversationCreate\(id\) \|\| isValidGroupConversationCreate\(id\)/,
  );
  assert.match(groupClientSource, /group_\$\{autoId\}/);
  assert.match(groupClientSource, /isGroup: true/);
}

function testEnsureTwoPartyDmRecoversGroupSquat() {
  assert.match(messagingSource, /export async function ensureTwoPartyDm/);
  assert.match(messagingSource, /data\?\.isGroup === true/);
  assert.match(messagingSource, /await deleteDoc\(convRef\)/);
  assert.match(messagingSource, /`unreadBy\.\$\{otherId\}`/);
  assert.match(messagingSource, /`unreadBy\.\$\{args\.viewerId\}`/);
}

function testEditClipUsesTransactionForMoments() {
  assert.match(pageSource, /runTransaction/);
  // The main-form Edit Clip path (editingClipId) must not rewrite moments from a
  // non-transactional getDoc+updateDoc RMW (concurrent appends would be dropped).
  const editIdx = pageSource.indexOf("if (editingClipId)");
  assert.ok(editIdx >= 0, "expected editingClipId branch");
  const elseIdx = pageSource.indexOf("} else {", editIdx);
  assert.ok(elseIdx > editIdx, "expected else after editingClipId");
  const editBlock = pageSource.slice(editIdx, elseIdx);
  assert.match(editBlock, /runTransaction/);
  assert.match(editBlock, /tx\.update\(clipRef/);
  assert.doesNotMatch(editBlock, /await updateDoc\(doc\(db, "clips", editingClipId\)/);
}

function testCollectionLookupRejectsUsernameSpoof() {
  assert.match(collectionPageSource, /usernames/);
  assert.match(collectionPageSource, /where\("userId",\s*"==",\s*ownerUid\)/);
  // Legacy fallback must not accept another user's doc under this handle.
  assert.match(collectionPageSource, /legacyUid === ownerUid/);
  const col = collectionsBlock();
  assert.match(col, /request\.resource\.data\.userId == request\.auth\.uid/);
  assert.match(col, /get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)\.data\.username/);
  assert.match(col, /request\.resource\.data\.userId == resource\.data\.userId/);
}

testGroupCreatesCannotOccupyDmSlots();
testEnsureTwoPartyDmRecoversGroupSquat();
testEditClipUsesTransactionForMoments();
testCollectionLookupRejectsUsernameSpoof();

console.log("critical regressions passed");
