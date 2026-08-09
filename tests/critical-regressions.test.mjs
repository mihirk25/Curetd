import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rulesSource = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const followClientSource = readFileSync(
  new URL("../app/lib/firestore.ts", import.meta.url),
  "utf8",
);

function followsBlock() {
  const match = rulesSource.match(/match \/follows\/\{id\} \{([\s\S]*?)\n    \}/);
  assert.ok(match, "expected follows rule block");
  return match[1];
}

function testFollowsAreOwnerScopedWithStickyEndpoints() {
  const block = followsBlock();

  // Broad authenticated write must not remain.
  assert.doesNotMatch(
    block,
    /allow read, write: if request\.auth != null/,
  );

  // Create binds ownership to the authenticated follower and the deterministic doc id.
  assert.match(block, /allow create:/);
  assert.match(block, /request\.resource\.data\.followerId == request\.auth\.uid/);
  assert.match(
    block,
    /id == request\.resource\.data\.followerId \+ '_' \+ request\.resource\.data\.followingId/,
  );

  // Update requires prior ownership (resource) — closes overwrite-via-claimed-followerId.
  assert.match(block, /allow update:/);
  assert.match(block, /resource\.data\.followerId == request\.auth\.uid/);
  // Both endpoints sticky so a follow edge cannot be redirected or reattributed.
  assert.match(
    block,
    /request\.resource\.data\.followerId == resource\.data\.followerId/,
  );
  assert.match(
    block,
    /request\.resource\.data\.followingId == resource\.data\.followingId/,
  );

  // Delete only by the existing follower.
  assert.match(block, /allow delete:/);
  assert.match(block, /resource\.data\.followerId == request\.auth\.uid/);
}

function testFollowClientUsesDeterministicDocId() {
  assert.match(
    followClientSource,
    /const followId = `\$\{currentUid\}_\$\{targetUid\}`/,
  );
  assert.match(followClientSource, /followerId: currentUid/);
  assert.match(followClientSource, /followingId: targetUid/);
}

testFollowsAreOwnerScopedWithStickyEndpoints();
testFollowClientUsesDeterministicDocId();

console.log("critical regressions passed");
