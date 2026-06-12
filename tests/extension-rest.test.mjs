import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function jsonResponse(body, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

const runQueryResponses = [];
const commitBodies = [];
const createBodies = [];

const sandbox = {
  console,
  Date,
  FIREBASE_CONFIG: {
    apiKey: "test-api-key",
    projectId: "test-project",
  },
  CuratdAuth: {
    async getStoredSession() {
      return {
        idToken: "token",
        refreshToken: "refresh",
        uid: "alice",
        email: "alice@example.com",
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
  async fetch(url, options = {}) {
    const href = String(url);
    if (href.includes("/documents/users/alice")) {
      return jsonResponse({
        fields: {
          username: { stringValue: "alice" },
        },
      });
    }
    if (href.endsWith("/documents:runQuery")) {
      return jsonResponse(runQueryResponses.shift() ?? []);
    }
    if (href.endsWith("/documents:commit")) {
      commitBodies.push(JSON.parse(String(options.body || "{}")));
      return jsonResponse({});
    }
    if (href.endsWith("/documents/clips") && options.method === "POST") {
      createBodies.push(JSON.parse(String(options.body || "{}")));
      return jsonResponse({
        name: "projects/test-project/databases/(default)/documents/clips/newclip",
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  },
};

vm.createContext(sandbox);
vm.runInContext(readFileSync("curatd-extension/firebase-rest.js", "utf8"), sandbox);

runQueryResponses.push([
  {
    document: {
      name: "projects/test-project/databases/(default)/documents/clips/clip1",
      fields: {
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

await sandbox.CuratdFirebaseRest.saveClip({
  videoId: "video-1",
  videoTitle: "A video",
  channelName: "A channel",
  startTime: 10,
  endTime: 20,
});

assert.equal(commitBodies.length, 1);
const commit = commitBodies[0];
assert.equal(commit.writes.length, 2);
assert.deepEqual(commit.writes[0].updateMask.fieldPaths.includes("curatorEmail"), true);
assert.equal(commit.writes[0].update.fields.curatorEmail, undefined);
assert.equal(commit.writes[0].update.fields.moments, undefined);
assert.equal(
  commit.writes[1].transform.fieldTransforms[0].appendMissingElements.values[0].mapValue.fields.id.stringValue,
  "moment-1",
);

runQueryResponses.push([]);
await sandbox.CuratdFirebaseRest.saveClip({
  videoId: "video-2",
  videoTitle: "Another video",
  channelName: "Another channel",
  startTime: 5,
  endTime: 12,
});

assert.equal(createBodies.length, 1);
assert.equal(createBodies[0].fields.curatorEmail, undefined);
assert.equal(createBodies[0].fields.userId.stringValue, "alice");

console.log("Extension REST regression tests passed.");
