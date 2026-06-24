import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../curatd-extension/firebase-rest.js", import.meta.url), "utf8");

function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(data);
    },
  };
}

function loadExtension({ runQueryDocuments = [], calls }) {
  const context = vm.createContext({
    console: { log() {}, error() {} },
    Date,
    FIREBASE_CONFIG: { apiKey: "test-api-key", projectId: "test-project" },
    CuratdAuth: {
      async getStoredSession() {
        return {
          idToken: "id-token",
          refreshToken: "refresh-token",
          uid: "user-1",
          email: "person@example.com",
          expiresAt: Date.now() + 60 * 60 * 1000,
        };
      },
      async saveSession() {},
    },
    crypto: {
      randomUUID() {
        return "moment-1";
      },
    },
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/documents/users/user-1")) {
        return jsonResponse({
          fields: {
            username: { stringValue: "alice" },
          },
        });
      }
      if (String(url).includes("/documents:runQuery")) {
        return jsonResponse(runQueryDocuments.map((document) => ({ document })));
      }
      if (String(url).includes("/documents:commit")) {
        return jsonResponse({});
      }
      if (String(url).endsWith("/documents/clips")) {
        return jsonResponse({
          name: "projects/test-project/databases/(default)/documents/clips/new-clip",
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });
  vm.runInContext(source, context);
  return context.CuratdFirebaseRest;
}

test("existing extension saves append moments with a transform and do not publish email", async () => {
  const calls = [];
  const api = loadExtension({
    calls,
    runQueryDocuments: [
      {
        name: "projects/test-project/databases/(default)/documents/clips/existing-clip",
        fields: {
          userId: { stringValue: "user-1" },
          videoId: { stringValue: "abc123" },
          audioOnly: { booleanValue: false },
          moments: {
            arrayValue: {
              values: [
                {
                  mapValue: {
                    fields: {
                      id: { stringValue: "old-moment" },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    ],
  });

  const result = await api.saveClip({
    videoId: "abc123",
    videoTitle: "A clip",
    channelName: "Channel",
    startTime: 10,
    endTime: 20,
  });

  assert.equal(result.merged, true);
  assert.equal(calls.some((call) => call.options?.method === "PATCH"), false);

  const commitCall = calls.find((call) => call.url.includes("/documents:commit"));
  assert.ok(commitCall, "expected an atomic commit call");
  const body = JSON.parse(commitCall.options.body);
  assert.equal(body.writes.length, 2);
  assert.deepEqual(body.writes[0].updateMask.fieldPaths.includes("moments"), false);
  assert.equal(body.writes[0].updateMask.fieldPaths.includes("curatorEmail"), true);
  assert.equal(Object.hasOwn(body.writes[0].update.fields, "curatorEmail"), false);
  assert.equal(body.writes[1].transform.fieldTransforms[0].fieldPath, "moments");
  assert.equal(
    body.writes[1].transform.fieldTransforms[0].appendMissingElements.values[0].mapValue.fields.id.stringValue,
    "moment-1",
  );
  assert.equal(JSON.stringify(body).includes("curatorEmail"), false);
  assert.equal(JSON.stringify(body).includes("person@example.com"), false);
});

test("new extension clip creates do not publish the signed-in email", async () => {
  const calls = [];
  const api = loadExtension({ calls });

  const result = await api.saveClip({
    videoId: "new123",
    videoTitle: "New clip",
    channelName: "Channel",
    startTime: 3,
    endTime: 8,
  });

  assert.equal(result.clipId, "new-clip");
  assert.equal(result.merged, false);

  const createCall = calls.find((call) => String(call.url).endsWith("/documents/clips"));
  assert.ok(createCall, "expected a clip create call");
  const body = JSON.parse(createCall.options.body);
  assert.equal(body.fields.userId.stringValue, "user-1");
  assert.equal(JSON.stringify(body).includes("curatorEmail"), false);
  assert.equal(JSON.stringify(body).includes("person@example.com"), false);
});
