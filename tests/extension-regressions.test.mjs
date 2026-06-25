import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();

function loadScript(context, relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

function createChromeStorage(initial = {}) {
  const state = { ...initial };
  return {
    state,
    api: {
      storage: {
        local: {
          get(keys, cb) {
            const out = {};
            for (const key of keys) out[key] = state[key];
            cb(out);
          },
          set(data, cb) {
            Object.assign(state, data);
            cb?.();
          },
          remove(keys, cb) {
            for (const key of keys) delete state[key];
            cb?.();
          },
        },
      },
    },
  };
}

async function testExistingClipUsesAtomicAppendAndNoEmail() {
  const storage = createChromeStorage({
    curatdSession: {
      uid: "user-1",
      email: "private@example.com",
      idToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
  });
  const requests = [];
  const context = vm.createContext({
    chrome: storage.api,
    FIREBASE_CONFIG: { apiKey: "api-key", projectId: "demo-curatd" },
    crypto: { randomUUID: () => "moment-new" },
    console,
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      const body = options.body ? JSON.parse(options.body) : null;

      if (String(url).includes("/documents/users/user-1")) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              fields: {
                username: { stringValue: "curator" },
              },
            }),
        };
      }

      if (String(url).endsWith("/documents:runQuery")) {
        assert.equal(body.structuredQuery.from[0].collectionId, "clips");
        return {
          ok: true,
          json: async () => [
            {
              document: {
                name: "projects/demo-curatd/databases/(default)/documents/clips/clip-1",
                fields: {
                  moments: {
                    arrayValue: {
                      values: [
                        {
                          mapValue: {
                            fields: {
                              id: { stringValue: "moment-old" },
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
        };
      }

      if (String(url).endsWith("/documents:commit")) {
        return { ok: true, text: async () => JSON.stringify({ commitTime: "now" }) };
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  loadScript(context, "curatd-extension/curatd-auth.js");
  loadScript(context, "curatd-extension/firebase-rest.js");

  const result = await context.CuratdFirebaseRest.saveClip({
    videoId: "video-1",
    videoTitle: "Video",
    startTime: 10,
    endTime: 20,
    channelName: "Channel",
  });

  assert.deepEqual(result, { ok: true, clipId: "clip-1", merged: true });
  const commit = requests.find((req) => req.url.endsWith("/documents:commit"));
  assert.ok(commit, "existing clip save should use documents:commit");

  const write = JSON.parse(commit.options.body).writes[0];
  assert.equal(write.update.name, "projects/demo-curatd/databases/(default)/documents/clips/clip-1");
  assert.equal(write.update.fields.curatorEmail, undefined);
  assert.ok(write.updateMask.fieldPaths.includes("curatorEmail"), "legacy curatorEmail should be deleted");
  assert.deepEqual(write.updateTransforms, [
    {
      fieldPath: "moments",
      appendMissingElements: {
        values: [
          {
            mapValue: {
              fields: {
                id: { stringValue: "moment-new" },
                startTime: { integerValue: "10" },
                endTime: { integerValue: "20" },
                note: { stringValue: "" },
                topic: { stringValue: "General" },
                addedAt: write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields.addedAt,
              },
            },
          },
        ],
      },
    },
  ]);
}

async function testNewClipDoesNotWriteEmail() {
  const storage = createChromeStorage({
    curatdSession: {
      uid: "user-1",
      email: "private@example.com",
      idToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
  });
  let createBody = null;
  const context = vm.createContext({
    chrome: storage.api,
    FIREBASE_CONFIG: { apiKey: "api-key", projectId: "demo-curatd" },
    crypto: { randomUUID: () => "moment-new" },
    console,
    fetch: async (url, options = {}) => {
      if (String(url).includes("/documents/users/user-1")) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              fields: {
                username: { stringValue: "curator" },
              },
            }),
        };
      }
      if (String(url).endsWith("/documents:runQuery")) {
        return { ok: true, json: async () => [] };
      }
      if (String(url).endsWith("/documents/clips")) {
        createBody = JSON.parse(options.body);
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              name: "projects/demo-curatd/databases/(default)/documents/clips/new-clip",
            }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  loadScript(context, "curatd-extension/curatd-auth.js");
  loadScript(context, "curatd-extension/firebase-rest.js");

  const result = await context.CuratdFirebaseRest.saveClip({
    videoId: "video-1",
    videoTitle: "Video",
    startTime: 10,
    endTime: 20,
    channelName: "Channel",
  });

  assert.deepEqual(result, { ok: true, clipId: "new-clip", merged: false });
  assert.ok(createBody, "new clip should be created");
  assert.equal(createBody.fields.curatorEmail, undefined);
  assert.equal(createBody.fields.userId.stringValue, "user-1");
}

async function testStaleSessionCannotOverwriteFreshSession() {
  const storage = createChromeStorage({
    curatdSession: {
      uid: "user-1",
      email: "private@example.com",
      idToken: "fresh-token",
      refreshToken: "fresh-refresh",
      expiresAt: 2000,
    },
  });
  const context = vm.createContext({ chrome: storage.api });
  loadScript(context, "curatd-extension/curatd-auth.js");

  const saved = await context.CuratdAuth.saveSession({
    uid: "user-1",
    email: "private@example.com",
    idToken: "stale-token",
    refreshToken: "stale-refresh",
    expiresAt: 1000,
  });

  assert.equal(saved.idToken, "fresh-token");
  assert.equal(storage.state.curatdSession.idToken, "fresh-token");
}

async function testIndexedDbReadErrorsDoNotClearSession() {
  const sent = [];
  const context = vm.createContext({
    FIREBASE_CONFIG: { apiKey: "api-key" },
    chrome: {
      runtime: {
        sendMessage(message, cb) {
          sent.push(message);
          cb?.();
        },
        lastError: null,
      },
    },
    document: {
      visibilityState: "visible",
      addEventListener() {},
    },
    indexedDB: {
      open() {
        const request = { error: new Error("locked") };
        setTimeout(() => request.onerror(), 0);
        return request;
      },
    },
    setInterval() {},
    setTimeout,
    window: {
      addEventListener() {},
    },
  });

  loadScript(context, "curatd-extension/curatd-bridge.js");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(sent, []);
}

await testExistingClipUsesAtomicAppendAndNoEmail();
await testNewClipDoesNotWriteEmail();
await testStaleSessionCannotOverwriteFreshSession();
await testIndexedDbReadErrorsDoNotClearSession();

console.log("extension regressions passed");
