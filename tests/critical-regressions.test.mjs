import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rulesSource = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

function commentsBlock() {
  const match = rulesSource.match(
    /match \/clips\/\{clipId\}\/comments\/\{commentId\} \{([\s\S]*?)\n    \}/,
  );
  assert.ok(match, "expected comments rule block");
  return match[1];
}

function likesBlock() {
  const match = rulesSource.match(
    /match \/clips\/\{clipId\}\/likes\/\{userId\} \{([\s\S]*?)\n    \}/,
  );
  assert.ok(match, "expected likes rule block");
  return match[1];
}

function testCommentUserIdStickyOnUpdate() {
  const block = commentsBlock();
  // Create must bind authorship to the authenticated user.
  assert.match(block, /request\.resource\.data\.userId == request\.auth\.uid/);
  // Update allowed only for the existing author…
  assert.match(block, /resource\.data\.userId == request\.auth\.uid/);
  // …and userId must remain unchanged (blocks reattribution / forgery).
  assert.match(
    block,
    /request\.resource\.data\.userId == resource\.data\.userId/,
  );
  assert.match(block, /allow delete: if signedIn\(\)/);
  // Broad authenticated write under clips/* must not remain.
  assert.doesNotMatch(
    rulesSource,
    /match \/clips\/\{clipId\}\/\{document=\*\*\} \{[\s\S]*allow write: if request\.auth != null/,
  );
}

function testLikesAreOwnerScoped() {
  const block = likesBlock();
  assert.match(block, /allow create, update, delete: if isOwner\(userId\)/);
}

testCommentUserIdStickyOnUpdate();
testLikesAreOwnerScoped();

console.log("critical regressions passed");
