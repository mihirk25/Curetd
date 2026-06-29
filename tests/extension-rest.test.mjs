import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadExtensionRest(fetchImpl) {
  const code = await readFile(new URL("../curatd-extension/firebase-rest.js", import.meta.url), "utf8");
  const context = {
    console,
    crypto,
    Date,
    FIREBASE_CONFIG: {
      apiKey: "test-api-key",
      projectId: "test-project",
    },
    CuratdAuth: {
      async getStoredSession() {
        return {
          idToken: "id-token",
          refreshToken: "refresh-token",
          uid: "alice",
          email: "alice@example.com",
          expiresAt: Date.now() + 60 * 60 * 1000,
        };
      },
      async saveSession() {},
    },
    fetch: fetchImpl,
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: "firebase-rest.js" });
  return context;
}

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

async function testExistingClipUsesAtomicAppendAndDeletesLegacyEmail() {
  let commitBody = null;
  const context = await loadExtensionRest(async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/documents/users/alice")) {
      return jsonResponse({
        fields: {
          username: { stringValue: "alice" },
        },
      });
    }
    if (href.includes("/documents:runQuery")) {
      return jsonResponse([
        {
          document: {
            name: "projects/test-project/databases/(default)/documents/clips/existingClip",
            fields: {
              moments: { arrayValue: { values: [] } },
            },
          },
        },
      ]);
    }
    if (href.includes("/documents:commit")) {
      commitBody = JSON.parse(String(options.body));
      return jsonResponse({ writeResults: [{}] });
    }
    throw new Error(`Unexpected fetch URL: ${href}`);
  });

  const result = await context.CuratdFirebaseRest.saveClip({
    videoId: "abc123def45",
    videoTitle: "A video",
    channelName: "A channel",
    startTime: 10,
    endTime: 20,
  });

  assert.deepEqual(result, { ok: true, clipId: "existingClip", merged: true });
  assert.equal(commitBody.writes.length, 1);
  const write = commitBody.writes[0];
  assert.equal(write.update.name, "projects/test-project/databases/(default)/documents/clips/existingClip");
  assert.ok(write.updateMask.fieldPaths.includes("curatorEmail"));
  assert.equal(write.update.fields.curatorEmail, undefined);
  assert.equal(write.update.fields.moments, undefined);
  assert.equal(write.update.fields.userId, undefined);
  assert.deepEqual(write.updateTransforms, [
    {
      fieldPath: "moments",
      appendMissingElements: {
        values: [
          {
            mapValue: {
              fields: write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields,
            },
          },
        ],
      },
    },
  ]);
}

async function testFirstSaveUsesDeterministicOwnerVideoDoc() {
  let commitBody = null;
  const context = await loadExtensionRest(async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/documents/users/alice")) {
      return jsonResponse({
        fields: {
          username: { stringValue: "alice" },
        },
      });
    }
    if (href.includes("/documents:runQuery")) {
      return jsonResponse([]);
    }
    if (href.includes("/documents:commit")) {
      commitBody = JSON.parse(String(options.body));
      return jsonResponse({ writeResults: [{}] });
    }
    throw new Error(`Unexpected fetch URL: ${href}`);
  });

  const result = await context.CuratdFirebaseRest.saveClip({
    videoId: "abc123def45",
    videoTitle: "A video",
    channelName: "A channel",
    startTime: 10,
    endTime: 20,
  });

  assert.deepEqual(result, { ok: true, clipId: "ext_alice_abc123def45", merged: false });
  const write = commitBody.writes[0];
  assert.equal(write.update.name, "projects/test-project/databases/(default)/documents/clips/ext_alice_abc123def45");
  assert.equal(write.update.fields.curatorEmail, undefined);
  assert.equal(write.update.fields.moments, undefined);
  assert.equal(write.update.fields.userId.stringValue, "alice");
  assert.equal(write.updateTransforms[0].fieldPath, "moments");
}

await testExistingClipUsesAtomicAppendAndDeletesLegacyEmail();
await testFirstSaveUsesDeterministicOwnerVideoDoc();

console.log("extension REST regressions passed");
