import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../curatd-extension/firebase-rest.js", import.meta.url), "utf8");

function response(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function encodedString(value) {
  return { stringValue: value };
}

function loadExtension({ runQueryRows = [] } = {}) {
  const calls = [];
  let momentCounter = 0;
  const context = {
    console,
    FIREBASE_CONFIG: { apiKey: "fake-api-key", projectId: "demo-curatd" },
    CuratdAuth: {
      async getStoredSession() {
        return {
          idToken: "id-token",
          refreshToken: "refresh-token",
          uid: "alice",
          email: "alice@example.com",
          expiresAt: Date.now() + 120_000,
        };
      },
      async saveSession() {},
    },
    crypto: {
      randomUUID() {
        momentCounter += 1;
        return `moment-${momentCounter}`;
      },
    },
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), options, body });
      const asString = String(url);
      if (asString.includes("/users/alice")) {
        return response({
          fields: {
            username: encodedString("alice"),
          },
        });
      }
      if (asString.includes(":runQuery")) {
        return response(runQueryRows);
      }
      if (asString.includes("documents:commit")) {
        return response({ commitTime: "2026-06-26T00:00:00Z" });
      }
      throw new Error(`Unexpected fetch: ${asString}`);
    },
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "firebase-rest.js" });
  return { api: context.CuratdFirebaseRest, calls };
}

function commitWrite(calls) {
  const call = calls.find((c) => c.url.includes("documents:commit"));
  assert.ok(call, "expected Firestore commit call");
  return call.body.writes[0];
}

test("new extension saves use a deterministic clip doc and atomic moment append", async () => {
  const { api, calls } = loadExtension();

  const result = await api.saveClip({
    videoId: "abc123",
    videoTitle: "Demo video",
    startTime: 5,
    endTime: 15,
    channelName: "Demo channel",
  });

  assert.equal(result.ok, true);
  assert.equal(result.clipId, "ext_alice_abc123_video");
  assert.equal(result.merged, false);

  const write = commitWrite(calls);
  assert.equal(write.update.name, "projects/demo-curatd/databases/(default)/documents/clips/ext_alice_abc123_video");
  assert.equal(write.update.fields.userId.stringValue, "alice");
  assert.equal(write.update.fields.username.stringValue, "alice");
  assert.equal(write.update.fields.curatorEmail, undefined);
  assert.equal(write.update.fields.moments, undefined);
  assert.deepEqual(write.updateTransforms.map((t) => t.fieldPath), ["moments"]);
  assert.equal(
    write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields.id.stringValue,
    "moment-1",
  );
});

test("existing extension saves delete legacy curatorEmail and do not overwrite moments", async () => {
  const { api, calls } = loadExtension({
    runQueryRows: [
      {
        document: {
          name: "projects/demo-curatd/databases/(default)/documents/clips/existingClip",
          fields: {
            userId: encodedString("alice"),
            curatorEmail: encodedString("alice@example.com"),
            moments: { arrayValue: { values: [] } },
          },
        },
      },
    ],
  });

  const result = await api.saveClip({
    videoId: "abc123",
    videoTitle: "Demo video",
    startTime: 20,
    endTime: 30,
    channelName: "Demo channel",
  });

  assert.equal(result.ok, true);
  assert.equal(result.clipId, "existingClip");
  assert.equal(result.merged, true);

  const write = commitWrite(calls);
  assert.equal(write.update.name, "projects/demo-curatd/databases/(default)/documents/clips/existingClip");
  assert.ok(write.updateMask.fieldPaths.includes("curatorEmail"));
  assert.equal(write.update.fields.curatorEmail, undefined);
  assert.equal(write.update.fields.moments, undefined);
  assert.equal(write.updateTransforms[0].fieldPath, "moments");
});
