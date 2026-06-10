import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const SCRIPT_PATH = new URL("../curatd-extension/firebase-rest.js", import.meta.url);

async function loadFirebaseRest(fetchImpl) {
  const source = await readFile(SCRIPT_PATH, "utf8");
  let storedSession = {
    uid: "user_a",
    email: "owner@example.com",
    idToken: "token",
    refreshToken: "refresh",
    expiresAt: Date.now() + 120_000,
  };
  const context = {
    console,
    FIREBASE_CONFIG: {
      apiKey: "api-key",
      projectId: "demo-project",
    },
    CuratdAuth: {
      getStoredSession: async () => storedSession,
      saveSession: async (session) => {
        storedSession = session;
        return session;
      },
    },
    crypto: {
      randomUUID: () => "moment-1",
    },
    fetch: fetchImpl,
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(source, context, { filename: "firebase-rest.js" });
  return context.CuratdFirebaseRest;
}

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

test("existing extension clip saves append moments with an atomic transform", async () => {
  const calls = [];
  const rest = await loadFirebaseRest(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/documents/users/user_a")) {
      return jsonResponse({
        fields: {
          username: { stringValue: "alice" },
        },
      });
    }
    if (String(url).endsWith("/documents:runQuery")) {
      return jsonResponse([
        {
          document: {
            name: "projects/demo-project/databases/(default)/documents/clips/clip_existing",
            fields: {
              moments: { arrayValue: { values: [] } },
            },
          },
        },
      ]);
    }
    if (String(url).endsWith("/documents:commit")) {
      return jsonResponse({ writeResults: [{}] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await rest.saveClip({
    videoId: "abcdefghijk",
    videoTitle: "A video",
    startTime: 10,
    endTime: 20,
    channelName: "Channel",
  });

  assert.deepEqual(result, { ok: true, clipId: "clip_existing", merged: true });
  assert.equal(calls.some((call) => call.options?.method === "PATCH"), false);

  const commitCall = calls.find((call) => String(call.url).endsWith("/documents:commit"));
  assert.ok(commitCall, "expected Firestore commit request");
  const body = JSON.parse(commitCall.options.body);
  assert.equal(body.writes.length, 1);
  assert.equal(body.writes[0].update.name, "projects/demo-project/databases/(default)/documents/clips/clip_existing");
  assert.equal(body.writes[0].update.fields.curatorEmail, undefined);
  assert.deepEqual(body.writes[0].updateTransforms, [
    {
      fieldPath: "moments",
      appendMissingElements: {
        values: [
          {
            mapValue: {
              fields: {
                id: { stringValue: "moment-1" },
                startTime: { integerValue: "10" },
                endTime: { integerValue: "20" },
                note: { stringValue: "" },
                topic: { stringValue: "General" },
                addedAt: body.writes[0].updateTransforms[0].appendMissingElements.values[0].mapValue.fields.addedAt,
              },
            },
          },
        ],
      },
    },
  ]);
});

test("new extension clip saves do not write public curator email", async () => {
  const calls = [];
  const rest = await loadFirebaseRest(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/documents/users/user_a")) {
      return jsonResponse({
        fields: {
          username: { stringValue: "alice" },
        },
      });
    }
    if (String(url).endsWith("/documents:runQuery")) {
      return jsonResponse([]);
    }
    if (String(url).endsWith("/documents/clips")) {
      return jsonResponse({
        name: "projects/demo-project/databases/(default)/documents/clips/new_clip",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await rest.saveClip({
    videoId: "abcdefghijk",
    videoTitle: "A video",
    startTime: 10,
    endTime: 20,
    channelName: "Channel",
  });

  assert.deepEqual(result, { ok: true, clipId: "new_clip", merged: false });
  const createCall = calls.find((call) => String(call.url).endsWith("/documents/clips"));
  assert.ok(createCall, "expected Firestore create request");
  const body = JSON.parse(createCall.options.body);
  assert.equal(body.fields.curatorEmail, undefined);
  assert.equal(body.fields.userId.stringValue, "user_a");
});
