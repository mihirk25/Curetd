import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rulesSource = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

function conversationBlock() {
  const match = rulesSource.match(/match \/conversations\/\{id\} \{([\s\S]*?)\n    \}/);
  assert.ok(match, "expected conversations rule block");
  return match[1];
}

function messagesBlock() {
  const match = rulesSource.match(
    /match \/conversations\/\{id\}\/messages\/\{mid\} \{([\s\S]*?)\n    \}/,
  );
  assert.ok(match, "expected messages rule block");
  return match[1];
}

function testConversationParticipantsAreImmutable() {
  const block = conversationBlock();
  assert.match(rulesSource, /function sameParticipantSet\(/);
  assert.match(rulesSource, /after\.participants\.hasAll\(before\.participants\)/);
  assert.match(block, /sameParticipantSet\(resource\.data, request\.resource\.data\)/);
  assert.doesNotMatch(block, /allow read, write: if request\.auth != null;/);
  assert.match(block, /participantIn\(resource\.data\)/);
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
  assert.doesNotMatch(block, /allow read, write: if request\.auth != null;/);
  assert.doesNotMatch(block, /allow read, update, delete: if currentConversationParticipant\(id\);/);
}

testConversationParticipantsAreImmutable();
testMessagesBlockPeerForgeAndWipe();

console.log("critical regressions passed");
