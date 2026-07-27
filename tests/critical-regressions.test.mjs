import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const extensionSource = readFileSync(
  new URL("../curatd-extension/firebase-rest.js", import.meta.url),
  "utf8",
);
const collectionPageSource = readFileSync(
  new URL("../app/[username]/collections/[slug]/page.tsx", import.meta.url),
  "utf8",
);

function response({ ok = true, status = 200, body = null } = {}) {
  const text = body == null ? "" : JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => text,
    json: async () => (body == null ? null : body),
  };
}

function loadExtension({ fetchImpl, getStoredSession, saveSession }) {
  const context = {
    console,
    crypto: { randomUUID: () => "moment-test-id" },
    FIREBASE_CONFIG: { apiKey: "test-key", projectId: "test-project" },
    CuratdAuth: {
      getStoredSession,
      saveSession,
    },
    fetch: fetchImpl,
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(extensionSource, context, { filename: "firebase-rest.js" });
  return context.CuratdFirebaseRest;
}

function validSession() {
  return {
    idToken: "id-token",
    refreshToken: "refresh-token",
    uid: "user-1",
    email: "user@example.com",
    expiresAt: Date.now() + 3_600_000,
  };
}

async function testSaveClipWritesTimestampCreatedAt() {
  /** @type {unknown[]} */
  const posts = [];
  const api = loadExtension({
    getStoredSession: async () => validSession(),
    saveSession: async () => {},
    fetchImpl: async (url, options = {}) => {
      const u = String(url);
      if (u.includes("/documents/users/")) {
        return response({
          body: {
            fields: {
              username: { stringValue: "alice" },
            },
          },
        });
      }
      if (u.includes(":runQuery")) {
        return response({ body: [{}] });
      }
      if (options.method === "POST" && u.includes("/documents/clips") && !u.includes(":runQuery")) {
        posts.push(JSON.parse(String(options.body || "{}")));
        return response({
          body: { name: "projects/test-project/databases/(default)/documents/clips/clip-1" },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    },
  });

  const result = await api.saveClip({
    videoId: "abc123",
    videoTitle: "Demo",
    startTime: 10,
    endTime: 40,
    channelName: "Channel",
  });
  assert.equal(result.ok, true);
  assert.equal(posts.length, 1);
  const fields = posts[0].fields;
  assert.ok(fields.createdAt?.timestampValue, "createdAt must be timestampValue, not stringValue");
  assert.equal(fields.createdAt.stringValue, undefined);
  const momentFields = fields.moments?.arrayValue?.values?.[0]?.mapValue?.fields;
  assert.ok(momentFields?.addedAt?.timestampValue, "moment.addedAt must be timestampValue");
  assert.equal(momentFields?.addedAt?.stringValue, undefined);
}

async function testMergeSaveRoundTripsMomentTimestamps() {
  /** @type {unknown[]} */
  const patches = [];
  const priorAddedAt = "2024-01-15T12:00:00.000Z";
  const api = loadExtension({
    getStoredSession: async () => validSession(),
    saveSession: async () => {},
    fetchImpl: async (url, options = {}) => {
      const u = String(url);
      if (u.includes("/documents/users/")) {
        return response({
          body: {
            fields: {
              username: { stringValue: "alice" },
            },
          },
        });
      }
      if (u.includes(":runQuery")) {
        return response({
          body: [
            {
              document: {
                name: "projects/test-project/databases/(default)/documents/clips/existing-1",
                fields: {
                  videoId: { stringValue: "abc123" },
                  audioOnly: { booleanValue: false },
                  userId: { stringValue: "user-1" },
                  moments: {
                    arrayValue: {
                      values: [
                        {
                          mapValue: {
                            fields: {
                              id: { stringValue: "old-moment" },
                              startTime: { integerValue: "0" },
                              endTime: { integerValue: "30" },
                              note: { stringValue: "" },
                              topic: { stringValue: "General" },
                              addedAt: { timestampValue: priorAddedAt },
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
      if (options.method === "PATCH" && u.includes("/documents/clips/existing-1")) {
        patches.push(JSON.parse(String(options.body || "{}")));
        return response({ body: { name: u } });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    },
  });

  const result = await api.saveClip({
    videoId: "abc123",
    videoTitle: "Demo",
    startTime: 40,
    endTime: 70,
    channelName: "Channel",
  });
  assert.equal(result.ok, true);
  assert.equal(result.merged, true);
  assert.equal(patches.length, 1);
  const momentValues = patches[0].fields.moments.arrayValue.values;
  assert.equal(momentValues.length, 2);
  const oldAddedAt = momentValues[0].mapValue.fields.addedAt;
  assert.ok(oldAddedAt.timestampValue, "prior moment.addedAt must stay timestampValue after merge");
  assert.equal(oldAddedAt.stringValue, undefined);
  assert.equal(new Date(oldAddedAt.timestampValue).toISOString(), priorAddedAt);
  const newAddedAt = momentValues[1].mapValue.fields.addedAt;
  assert.ok(newAddedAt.timestampValue, "new moment.addedAt must be timestampValue");
}

function testCollectionDetailResolvesByUserId() {
  assert.match(collectionPageSource, /usernames/);
  assert.match(collectionPageSource, /where\("userId",\s*"==",\s*ownerUid\)/);
  assert.match(collectionPageSource, /where\("slug",\s*"==",\s*slug\)/);
  // Keep legacy username+slug fallback for old share links.
  assert.match(collectionPageSource, /where\("username",\s*"==",\s*username\)/);
}

function testExtensionSourceAvoidsIsoStringTimestamps() {
  assert.doesNotMatch(
    extensionSource,
    /createdAt:\s*new Date\(\)\.toISOString\(\)/,
    "createdAt must not be written as an ISO string",
  );
  assert.doesNotMatch(
    extensionSource,
    /addedAt:\s*new Date\(\)\.toISOString\(\)/,
    "addedAt must not be written as an ISO string",
  );
  assert.match(extensionSource, /addedAt:\s*new Date\(\)/);
  assert.match(extensionSource, /createdAt:\s*new Date\(\)/);
  assert.match(extensionSource, /timestampValue/);
  assert.match(extensionSource, /new Date\(v\.timestampValue\)/);
}

async function main() {
  testExtensionSourceAvoidsIsoStringTimestamps();
  testCollectionDetailResolvesByUserId();
  await testSaveClipWritesTimestampCreatedAt();
  await testMergeSaveRoundTripsMomentTimestamps();
  console.log("critical-regressions: ok");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
