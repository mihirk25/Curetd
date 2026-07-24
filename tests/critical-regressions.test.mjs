import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const extensionSource = readFileSync(new URL("../curatd-extension/firebase-rest.js", import.meta.url), "utf8");
const rulesSource = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const messagingSource = readFileSync(new URL("../app/messages/messaging.ts", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../curatd-extension/curatd-bridge.js", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../app/[username]/page.tsx", import.meta.url), "utf8");
const newMessageSource = readFileSync(new URL("../app/components/NewMessageModal.tsx", import.meta.url), "utf8");

function response({ ok = true, status = 200, body = null } = {}) {
  const text = body == null ? "" : JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => text,
    json: async () => (body == null ? null : body),
  };
}

function loadExtension(fetchImpl) {
  const context = {
    console,
    crypto: { randomUUID: () => "moment-test-id" },
    FIREBASE_CONFIG: { apiKey: "test-key", projectId: "test-project" },
    CuratdAuth: {
      getStoredSession: async () => ({
        idToken: "id-token",
        refreshToken: "refresh-token",
        uid: "user-1",
        email: "user@example.com",
        expiresAt: Date.now() + 60 * 60 * 1000,
      }),
      saveSession: async () => {},
    },
    fetch: fetchImpl,
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(extensionSource, context, { filename: "firebase-rest.js" });
  return context.CuratdFirebaseRest;
}

async function testMissingUserProfileDoesNotBlockExtensionSave() {
  const calls = [];
  const api = loadExtension(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/documents/users/user-1")) {
      return response({
        ok: false,
        status: 404,
        body: { error: { status: "NOT_FOUND", message: "Document not found" } },
      });
    }
    if (String(url).endsWith("/documents:runQuery")) {
      return response({ body: [] });
    }
    if (String(url).endsWith("/documents:commit")) {
      return response({ body: { commitTime: "2026-07-24T11:00:00Z" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const result = await api.saveClip({
    videoId: "abc123def45",
    videoTitle: "Demo video",
    startTime: 10,
    endTime: 20,
    channelName: "Demo channel",
  });

  assert.equal(result.ok, true);
  assert.equal(result.clipId, "user-1_video_abc123def45");
  assert.equal(result.merged, false);
  const commitCall = calls.find((call) => call.url.endsWith("/documents:commit"));
  assert.ok(commitCall, "expected extension to create via deterministic commit");
  const commitBody = JSON.parse(commitCall.options.body);
  const write = commitBody.writes[0];
  assert.equal(write.update.fields.userId.stringValue, "user-1");
  assert.equal(write.update.fields.displayName.stringValue, "Anonymous");
  assert.equal("curatorEmail" in write.update.fields, false);
  assert.ok(write.updateMask.fieldPaths.includes("curatorEmail"));
  assert.equal(write.updateTransforms[0].fieldPath, "moments");
}

async function testExistingClipUsesAtomicMomentAppend() {
  const calls = [];
  const api = loadExtension(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/documents/users/user-1")) {
      return response({
        body: {
          fields: {
            username: { stringValue: "alice" },
          },
        },
      });
    }
    if (String(url).endsWith("/documents:runQuery")) {
      return response({
        body: [
          {
            document: {
              name: "projects/test-project/databases/(default)/documents/clips/existing-clip",
              fields: {
                moments: {
                  arrayValue: {
                    values: [
                      {
                        mapValue: {
                          fields: {
                            id: { stringValue: "existing-moment" },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      });
    }
    if (String(url).endsWith("/documents:commit")) {
      return response({ body: { commitTime: "2026-07-24T11:00:00Z" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const result = await api.saveClip({
    videoId: "abc123def45",
    videoTitle: "Demo video",
    startTime: 10,
    endTime: 20,
    channelName: "Demo channel",
  });

  assert.equal(result.ok, true);
  assert.equal(result.merged, true);
  assert.equal(result.clipId, "existing-clip");
  const commitCall = calls.find((call) => call.url.endsWith("/documents:commit"));
  assert.ok(commitCall, "expected existing clip save to use Firestore commit");
  const commitBody = JSON.parse(commitCall.options.body);
  const write = commitBody.writes[0];
  assert.equal(write.updateMask.fieldPaths.includes("moments"), false);
  assert.equal(write.update.fields.userId.stringValue, "user-1");
  assert.equal("curatorEmail" in write.update.fields, false);
  assert.ok(write.updateMask.fieldPaths.includes("curatorEmail"));
  assert.equal(write.updateTransforms[0].fieldPath, "moments");
  assert.equal(
    write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields.id.stringValue,
    "moment-test-id",
  );
}

function testFirestoreRulesProtectPrivateAndParticipantData() {
  const usersMatch = rulesSource.match(/match \/users\/\{userId\} \{([\s\S]*?)\n    \}/);
  assert.ok(usersMatch, "expected users rule block");
  const usersBlock = usersMatch[1];

  assert.match(rulesSource, /match \/privateUsers\/\{userId\}/);
  assert.match(rulesSource, /hasNoPublicPrivateFields/);
  assert.match(rulesSource, /firstName/);
  assert.match(rulesSource, /lastName/);
  assert.doesNotMatch(usersBlock, /allow read: if true;/);
  assert.match(rulesSource, /request\.resource\.data\.keys\(\)\.hasAny\(\['curatorEmail'\]\)/);
  assert.match(rulesSource, /match \/savedClips\/\{id\} \{[\s\S]*resource\.data\.userId == request\.auth\.uid/);
  assert.match(rulesSource, /participantIn\(resource\.data\)/);
  assert.match(rulesSource, /getAfter\(conversationPath\(id\)\)/);
  assert.doesNotMatch(rulesSource, /match \/conversations\/\{id\} \{[\s\S]*?allow read, write: if request\.auth != null;/);
}

function testMessagingDoesNotShallowWipeUnreadBy() {
  assert.match(messagingSource, /`unreadBy\.\$\{otherId\}`/);
  assert.match(messagingSource, /`unreadBy\.\$\{args\.viewerId\}`/);
  assert.doesNotMatch(
    messagingSource,
    /unreadBy:\s*\{\s*\[args\.viewerId\]:\s*0\s*\}/,
  );
  assert.doesNotMatch(
    messagingSource,
    /unreadBy:\s*\{\s*\[otherId\]:\s*increment\(1\)\s*\}/,
  );
}

function testConversationCreatesDoNotResetExistingThreads() {
  assert.match(profileSource, /if \(!existing\.exists\(\)\)/);
  assert.match(newMessageSource, /getConversationId\(currentUserId, u\.uid\)/);
  assert.match(newMessageSource, /if \(!existing\.exists\(\)\)/);
  assert.doesNotMatch(newMessageSource, /addDoc\(collection\(db, "conversations"\)/);
}

function testBridgeRequiresConsecutiveEmptyAuthReads() {
  assert.match(bridgeSource, /emptySessionReads/);
  assert.match(bridgeSource, /emptySessionReads < 3/);
  assert.doesNotMatch(
    bridgeSource,
    /String\(rowKey\)\.startsWith\("firebase:authUser:"\)/,
  );
}

await testMissingUserProfileDoesNotBlockExtensionSave();
await testExistingClipUsesAtomicMomentAppend();
testFirestoreRulesProtectPrivateAndParticipantData();
testMessagingDoesNotShallowWipeUnreadBy();
testConversationCreatesDoNotResetExistingThreads();
testBridgeRequiresConsecutiveEmptyAuthReads();

console.log("critical regressions passed");
