import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function okJson(data) {
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

function stringValue(value) {
  return { stringValue: value };
}

let queryDocs = [
  {
    name: "projects/demo/databases/(default)/documents/clips/existingClip",
    fields: {
      moments: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  id: stringValue("oldMoment"),
                  note: stringValue("already saved"),
                },
              },
            },
          ],
        },
      },
    },
  },
];

const requests = [];
const context = {
  console,
  Date,
  Math,
  URL,
  crypto: {
    randomUUID() {
      return "newMoment";
    },
  },
  FIREBASE_CONFIG: {
    apiKey: "fake-api-key",
    projectId: "demo",
  },
  CuratdAuth: {
    async getStoredSession() {
      return {
        idToken: "id-token",
        refreshToken: "refresh-token",
        uid: "alice",
        email: "alice@example.com",
        expiresAt: Date.now() + 3600_000,
      };
    },
    async saveSession() {},
  },
  async fetch(url, options = {}) {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url: String(url), options, body });

    if (String(url).includes("/documents/users/alice")) {
      return okJson({
        fields: {
          username: stringValue("alice"),
        },
      });
    }

    if (String(url).endsWith("/documents:runQuery")) {
      return okJson(queryDocs.map((document) => ({ document })));
    }

    if (String(url).endsWith("/documents:commit")) {
      return okJson({ commitTime: "2026-06-27T00:00:00Z" });
    }

    if (String(url).endsWith("/documents/clips")) {
      return okJson({
        name: "projects/demo/databases/(default)/documents/clips/newClip",
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  },
};

vm.runInNewContext(readFileSync("curatd-extension/firebase-rest.js", "utf8"), context);

await context.CuratdFirebaseRest.saveClip({
  videoId: "abcdefghijk",
  videoTitle: "Existing video",
  channelName: "Channel",
  startTime: 10,
  endTime: 20,
});

const commitRequest = requests.find((req) => req.url.endsWith("/documents:commit"));
assert.ok(commitRequest, "existing clips should be updated with documents:commit");
const write = commitRequest.body.writes[0];
assert.equal(write.update.name, "projects/demo/databases/(default)/documents/clips/existingClip");
assert.ok(!("curatorEmail" in write.update.fields), "public clip updates must not write curatorEmail");
assert.ok(!("moments" in write.update.fields), "moments must be appended with a transform, not overwritten");
assert.deepEqual(write.updateTransforms, [
  {
    fieldPath: "moments",
    appendMissingElements: {
      values: [
        {
          mapValue: {
            fields: {
              id: stringValue("newMoment"),
              startTime: { integerValue: "10" },
              endTime: { integerValue: "20" },
              note: stringValue(""),
              topic: stringValue("General"),
              addedAt: write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields.addedAt,
            },
          },
        },
      ],
    },
  },
]);
assert.ok(
  write.updateMask.fieldPaths.includes("curatorEmail"),
  "legacy curatorEmail should be deleted when extension updates a clip",
);

requests.length = 0;
queryDocs = [];

await context.CuratdFirebaseRest.saveClip({
  videoId: "newvideo123",
  videoTitle: "New video",
  channelName: "Channel",
  startTime: 1,
  endTime: 5,
});

const createRequest = requests.find((req) => req.url.endsWith("/documents/clips"));
assert.ok(createRequest, "new clips should still be created");
assert.ok(!("curatorEmail" in createRequest.body.fields), "public clip creates must not write curatorEmail");
assert.equal(createRequest.body.fields.userId.stringValue, "alice");
assert.equal(createRequest.body.fields.curatorId.stringValue, "alice");
