import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("curatd-extension/firebase-rest.js", "utf8");
const requests = [];

const context = {
  console,
  Date,
  Error,
  Math,
  Number,
  Object,
  String,
  FIREBASE_CONFIG: {
    apiKey: "test-api-key",
    projectId: "test-project",
  },
  CuratdAuth: {
    async getStoredSession() {
      return {
        idToken: "id-token",
        refreshToken: "refresh-token",
        uid: "user_a",
        email: "user-a@example.com",
        expiresAt: Date.now() + 3_600_000,
      };
    },
    async saveSession() {},
  },
  crypto: {
    randomUUID() {
      return "moment-id";
    },
  },
  async fetch(url, options = {}) {
    requests.push({
      url: String(url),
      method: options.method || "GET",
      body: options.body ? JSON.parse(options.body) : null,
    });

    if (String(url).endsWith("/documents/users/user_a")) {
      return jsonResponse({
        fields: {
          username: { stringValue: "user_a" },
        },
      });
    }

    if (String(url).endsWith("/documents:runQuery")) {
      return jsonResponse([
        {
          document: {
            name: "projects/test-project/databases/(default)/documents/clips/existing_clip",
            fields: {
              userId: { stringValue: "user_a" },
              videoId: { stringValue: "abc123" },
              audioOnly: { booleanValue: false },
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
      ]);
    }

    if (String(url).endsWith("/documents:commit")) {
      return jsonResponse({ commitTime: "2026-06-11T00:00:00Z" });
    }

    throw new Error(`Unexpected request: ${url}`);
  },
};

context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "firebase-rest.js" });

const result = await context.CuratdFirebaseRest.saveClip({
  videoId: "abc123",
  videoTitle: "Test video",
  startTime: 10,
  endTime: 20,
  channelName: "Test channel",
});

assert.equal(result.ok, true);
assert.equal(result.clipId, "existing_clip");
assert.equal(result.merged, true);

const commit = requests.find((request) => request.url.endsWith("/documents:commit"));
assert.ok(commit, "expected existing clip save to use Firestore commit");
assert.equal(commit.method, "POST");

const write = commit.body.writes[0];
assert.equal(
  write.update.name,
  "projects/test-project/databases/(default)/documents/clips/existing_clip",
);
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
assert.equal(write.update.fields.curatorEmail, undefined);
assert.equal(write.update.fields.moments, undefined);
assert.deepEqual(write.updateTransforms, [
  {
    fieldPath: "moments",
    appendMissingElements: {
      values: [
        {
          mapValue: {
            fields: {
              id: { stringValue: "moment-id" },
              startTime: { integerValue: "10" },
              endTime: { integerValue: "20" },
              note: { stringValue: "" },
              topic: { stringValue: "General" },
              addedAt: { stringValue: write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields.addedAt.stringValue },
            },
          },
        },
      ],
    },
  },
]);
assert.equal(JSON.stringify(commit.body).includes("user-a@example.com"), false);
assert.equal(JSON.stringify(commit.body).includes("curatorEmail"), false);

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}
