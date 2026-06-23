import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

const calls = [];
const sandbox = {
  console,
  FIREBASE_CONFIG: {
    apiKey: "test-api-key",
    projectId: "demo-curatd",
  },
  CuratdAuth: {
    async getStoredSession() {
      return {
        idToken: "id-token",
        refreshToken: "refresh-token",
        uid: "user-a",
        email: "private@example.com",
        expiresAt: Date.now() + 600_000,
      };
    },
    async saveSession() {},
  },
  crypto: {
    randomUUID() {
      return "moment-1";
    },
  },
  async fetch(url, options = {}) {
    calls.push({ url: String(url), options });

    if (String(url).endsWith("/documents/users/user-a")) {
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
            name: "projects/demo-curatd/databases/(default)/documents/clips/clip-1",
            fields: {
              userId: { stringValue: "user-a" },
              videoId: { stringValue: "abc123def45" },
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
        },
      ]);
    }

    if (String(url).endsWith("/documents:commit")) {
      return jsonResponse({ writeResults: [{}] });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  },
};

vm.createContext(sandbox);
vm.runInContext(await readFile("curatd-extension/firebase-rest.js", "utf8"), sandbox, {
  filename: "curatd-extension/firebase-rest.js",
});

const result = await sandbox.CuratdFirebaseRest.saveClip({
  videoId: "abc123def45",
  videoTitle: "A video",
  channelName: "A channel",
  startTime: 12,
  endTime: 20,
});

assert.equal(result.ok, true);
assert.equal(result.clipId, "clip-1");
assert.equal(result.merged, true);

const patchCall = calls.find((call) => call.options.method === "PATCH");
assert.equal(patchCall, undefined, "existing saves must not overwrite the moments array with PATCH");

const commitCall = calls.find((call) => call.url.endsWith("/documents:commit"));
assert.ok(commitCall, "existing saves should use a Firestore commit transform");

const commitBody = JSON.parse(commitCall.options.body);
assert.equal(commitBody.writes.length, 1);
const write = commitBody.writes[0];
assert.deepEqual(write.updateMask.fieldPaths.sort(), [
  "audioOnly",
  "channelName",
  "curatorId",
  "displayName",
  "endTime",
  "source",
  "startTime",
  "title",
  "username",
  "videoId",
  "videoTitle",
  "videoUrl",
].sort());
assert.equal(
  write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields.id.stringValue,
  "moment-1",
);
assert.equal(
  JSON.stringify(commitBody).includes("curatorEmail"),
  false,
  "extension writes must not store private email on public clips",
);
