import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rulesSource = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const homepageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const messagesSource = readFileSync(
  new URL("../app/messages/messages-client.tsx", import.meta.url),
  "utf8",
);
const sendClipSource = readFileSync(
  new URL("../app/components/SendClipModal.tsx", import.meta.url),
  "utf8",
);

function savedClipsBlock() {
  const match = rulesSource.match(/match \/savedClips\/\{id\} \{([\s\S]*?)\n    \}/);
  assert.ok(match, "expected savedClips rule block");
  return match[1];
}

function testSavedClipsAreOwnerScopedWithStickyEndpoints() {
  const block = savedClipsBlock();

  // Broad authenticated write must not remain.
  assert.doesNotMatch(block, /allow read, write: if request\.auth != null/);

  // Create binds ownership + clipId and deterministic doc id.
  assert.match(block, /allow create:/);
  assert.match(block, /request\.resource\.data\.userId == request\.auth\.uid/);
  assert.match(block, /request\.resource\.data\.clipId is string/);
  assert.match(
    block,
    /id == request\.resource\.data\.userId \+ '_' \+ request\.resource\.data\.clipId/,
  );

  // Update requires prior ownership and sticky userId/clipId — closes
  // reassignment of a private Saved bookmark onto another account.
  assert.match(block, /allow update:/);
  assert.match(block, /resource\.data\.userId == request\.auth\.uid/);
  assert.match(block, /request\.resource\.data\.userId == resource\.data\.userId/);
  assert.match(block, /request\.resource\.data\.clipId == resource\.data\.clipId/);

  // Delete only by the existing owner.
  assert.match(block, /allow delete:/);
  assert.match(block, /resource\.data\.userId == request\.auth\.uid/);
}

function testHomepageSavedUsesPerUserDocs() {
  assert.match(
    homepageSource,
    /query\(collection\(db, "savedClips"\), where\("userId", "==", user\.uid\)\)/,
  );
  assert.match(homepageSource, /const savedDocId = `\$\{user\.uid\}_\$\{clip\.id\}`/);
  assert.match(homepageSource, /userId: user\.uid/);
  assert.match(homepageSource, /clipId: clip\.id/);
  // Must not use global collection snapshot / shared clip.id doc keys.
  assert.doesNotMatch(
    homepageSource,
    /onSnapshot\(collection\(db, "savedClips"\),\s*\(snapshot\) => \{\s*setSavedClips\(snapshot\.docs\.map\(\(d\) => d\.id\)\)/,
  );
}

function testDmSaveUsesHomepageSchema() {
  assert.match(messagesSource, /const savedDocId = `\$\{user\.uid\}_\$\{clipId\}`/);
  assert.match(messagesSource, /clipId,/);
  assert.match(messagesSource, /userId: user\.uid/);
  // Legacy incompatible schema must not remain.
  assert.doesNotMatch(
    messagesSource,
    /addDoc\(collection\(db, "savedClips"\),\s*\{[\s\S]*videoId:/,
  );
}

function testSendClipPayloadIncludesClipId() {
  assert.match(sendClipSource, /clipId\?: string/);
  assert.match(homepageSource, /clipId: typeof clip\?\.id === "string" \? clip\.id : undefined/);
}

testSavedClipsAreOwnerScopedWithStickyEndpoints();
testHomepageSavedUsesPerUserDocs();
testDmSaveUsesHomepageSchema();
testSendClipPayloadIncludesClipId();

console.log("critical regressions passed");
