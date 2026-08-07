import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rulesSource = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const messagingSource = readFileSync(new URL("../app/messages/messaging.ts", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../app/[username]/page.tsx", import.meta.url), "utf8");
const newMessageSource = readFileSync(
  new URL("../app/components/NewMessageModal.tsx", import.meta.url),
  "utf8",
);

function conversationsBlock() {
  const match = rulesSource.match(/match \/conversations\/\{id\} \{[\s\S]*?\n    \}/);
  assert.ok(match, "expected conversations match block");
  return match[0];
}

function messagesBlock() {
  const match = rulesSource.match(/match \/conversations\/\{id\}\/messages\/\{mid\} \{[\s\S]*?\n    \}/);
  assert.ok(match, "expected messages match block");
  return match[0];
}

function testDmCreateBindsDocIdToExactPair() {
  assert.match(rulesSource, /function sortedDmId\(/);
  assert.match(rulesSource, /function isValidDmConversationCreate\(/);
  assert.match(rulesSource, /participants\.size\(\) == 2/);
  assert.match(
    rulesSource,
    /id == sortedDmId\(\s*request\.resource\.data\.participants\[0\],\s*request\.resource\.data\.participants\[1\]\s*\)/,
  );
  const block = conversationsBlock();
  assert.match(block, /allow create: if isValidDmConversationCreate\(id\) \|\| isValidGroupConversationCreate\(\)/);
  assert.doesNotMatch(block, /allow read, write: if request\.auth != null;/);
}

function testGroupCreateStillAllowedWithCreatedBy() {
  assert.match(rulesSource, /function isValidGroupConversationCreate\(/);
  assert.match(rulesSource, /request\.resource\.data\.createdBy == request\.auth\.uid/);
  assert.match(rulesSource, /get\('isGroup', false\) == true/);
}

function testParticipantsImmutableOnUpdate() {
  assert.match(rulesSource, /function sameParticipantSet\(/);
  assert.match(rulesSource, /after\.participants\.hasAll\(before\.participants\)/);
  const block = conversationsBlock();
  assert.match(block, /sameParticipantSet\(resource\.data, request\.resource\.data\)/);
}

function testMessagesBlockPeerForgeAndWipe() {
  const block = messagesBlock();
  assert.match(block, /request\.resource\.data\.senderId == request\.auth\.uid/);
  assert.match(block, /isMessageSender\(\)/);
  assert.match(
    block,
    /request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\['read'\]\)/,
  );
  assert.match(block, /allow delete: if currentConversationParticipant\(id\) && isMessageSender\(\)/);
}

function testIsExactDmPairHelper() {
  // Inline the same semantics the app exports (keep test free of TS transpile).
  function isExactDmPair(participants, a, b) {
    if (!Array.isArray(participants) || participants.length !== 2) return false;
    if (!a || !b || a === b) return false;
    const set = new Set(participants.filter((p) => typeof p === "string" && p.length > 0));
    return set.size === 2 && set.has(a) && set.has(b);
  }

  assert.equal(isExactDmPair(["bob", "charlie"], "bob", "charlie"), true);
  assert.equal(isExactDmPair(["charlie", "bob"], "bob", "charlie"), true);
  // Silent third-party squat: Alice pre-creates Bob_Charlie with herself included.
  assert.equal(isExactDmPair(["bob", "charlie", "alice"], "bob", "charlie"), false);
  assert.equal(isExactDmPair(["alice", "bob"], "bob", "charlie"), false);
  assert.equal(isExactDmPair(["bob"], "bob", "charlie"), false);
}

function testEnsureTwoPartyDmWired() {
  assert.match(messagingSource, /export function isExactDmPair/);
  assert.match(messagingSource, /export async function ensureTwoPartyDm/);
  assert.match(messagingSource, /DM_SLOT_COMPROMISED/);
  assert.match(messagingSource, /deleteDoc\(convRef\)/);
  assert.match(messagingSource, /isGroup: false/);

  assert.match(profileSource, /ensureTwoPartyDm/);
  assert.doesNotMatch(
    profileSource,
    /setDoc\(\s*doc\(db, "conversations", convId\)/,
  );

  assert.match(newMessageSource, /ensureTwoPartyDm/);
  assert.match(newMessageSource, /isExactDmPair/);
  assert.doesNotMatch(newMessageSource, /addDoc\(collection\(db, "conversations"\)/);
  // Must not reopen a third-party squat via loose "both uids present" matching.
  assert.doesNotMatch(
    newMessageSource,
    /parts\.includes\(currentUserId\) && parts\.includes\(otherUid\)/,
  );
}

testDmCreateBindsDocIdToExactPair();
testGroupCreateStillAllowedWithCreatedBy();
testParticipantsImmutableOnUpdate();
testMessagesBlockPeerForgeAndWipe();
testIsExactDmPairHelper();
testEnsureTwoPartyDmWired();

console.log("critical-regressions: ok");
