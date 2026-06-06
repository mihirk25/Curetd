import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../curatd-extension/firebase-rest.js", import.meta.url), "utf8");

const calls = [];
const context = {
  FIREBASE_CONFIG: {
    apiKey: "test-key",
    projectId: "test-project",
  },
  CuratdAuth: {
    async getStoredSession() {
      return {
        idToken: "id-token",
        refreshToken: "refresh-token",
        uid: "alice",
        email: "alice@example.com",
        expiresAt: Date.now() + 60_000,
      };
    },
    async saveSession() {},
  },
  crypto: {
    randomUUID() {
      return "moment-new";
    },
  },
  fetch: async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url).includes("/documents/users/alice")) {
      return jsonResponse({
        name: "projects/test-project/databases/(default)/documents/users/alice",
        fields: {
          username: { stringValue: "alice" },
        },
      });
    }

    if (String(url).endsWith("/documents:runQuery")) {
      return jsonResponse([
        {
          document: {
            name: "projects/test-project/databases/(default)/documents/clips/existingClip",
            fields: {
              userId: { stringValue: "alice" },
              videoId: { stringValue: "video-1" },
              audioOnly: { booleanValue: false },
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
      ]);
    }

    if (String(url).endsWith("/documents:commit")) {
      return jsonResponse({ commitTime: "2026-06-06T00:00:00Z" });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  },
};
context.globalThis = context;
context.self = context;

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    async json() {
      return data;
    },
    async text() {
      return JSON.stringify(data);
    },
  };
}

vm.runInNewContext(source, context, { filename: "firebase-rest.js" });

const result = await context.CuratdFirebaseRest.saveClip({
  videoId: "video-1",
  videoTitle: "Useful video",
  startTime: 10,
  endTime: 20,
  channelName: "Channel",
});

assert.deepEqual(result, { ok: true, clipId: "existingClip", merged: true });

const commitCall = calls.find((call) => call.url.endsWith("/documents:commit"));
assert.ok(commitCall, "existing clip save should use Firestore commit");

const commitBody = JSON.parse(commitCall.options.body);
assert.equal(commitBody.writes.length, 2);
assert.deepEqual(commitBody.writes[0].updateMask.fieldPaths.includes("moments"), false);
assert.equal(commitBody.writes[0].update.fields.curatorEmail, undefined);
assert.equal(commitBody.writes[1].transform.fieldTransforms[0].fieldPath, "moments");
assert.equal(
  commitBody.writes[1].transform.fieldTransforms[0].appendMissingElements.values[0].mapValue.fields.id.stringValue,
  "moment-new",
);
assert.equal(JSON.stringify(commitBody).includes("alice@example.com"), false);
