const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../curatd-extension/firebase-rest.js"),
  "utf8",
);

function response(body, ok = true, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok,
    status,
    json: async () => body,
    text: async () => text,
  };
}

function stringValue(value) {
  return { stringValue: value };
}

function intValue(value) {
  return { integerValue: String(value) };
}

function existingClipDocument() {
  return {
    name: "projects/demo/databases/(default)/documents/clips/clip1",
    fields: {
      moments: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  id: stringValue("moment-1"),
                  startTime: intValue(10),
                  endTime: intValue(20),
                },
              },
            },
          ],
        },
      },
    },
  };
}

function makeHarness({ existingDocs }) {
  const requests = [];
  const session = {
    uid: "uid1",
    email: "alice@example.com",
    idToken: "token",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  const sandbox = {
    FIREBASE_CONFIG: {
      apiKey: "api-key",
      projectId: "demo",
    },
    CuratdAuth: {
      getStoredSession: async () => session,
      saveSession: async () => {},
    },
    crypto: {
      randomUUID: () => "moment-2",
    },
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url, method: options.method || "GET", body });

      if (url.endsWith("/documents/users/uid1")) {
        return response({
          fields: {
            username: stringValue("alice"),
          },
        });
      }
      if (url.endsWith("/documents:runQuery")) {
        return response(existingDocs.map((document) => ({ document })));
      }
      if (url.endsWith("/documents:commit")) {
        return response({ commitTime: "2026-05-29T00:00:00.000000Z" });
      }
      if (url.endsWith("/documents/clips") && options.method === "POST") {
        return response({
          name: "projects/demo/databases/(default)/documents/clips/newclip",
        });
      }
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    },
  };

  vm.runInNewContext(source, sandbox, {
    filename: "curatd-extension/firebase-rest.js",
  });

  return { api: sandbox.CuratdFirebaseRest, requests };
}

test("existing clip saves append a moment atomically without replacing moments", async () => {
  const { api, requests } = makeHarness({ existingDocs: [existingClipDocument()] });

  await api.saveClip({
    videoId: "abc123",
    videoTitle: "A video",
    channelName: "A channel",
    startTime: 30,
    endTime: 45,
  });

  const commit = requests.find((request) => request.url.endsWith("/documents:commit"));
  assert.ok(commit, "expected a Firestore commit request");
  const write = commit.body.writes[0];

  assert.equal(write.update.fields.moments, undefined);
  assert.equal(write.update.fields.startTime, undefined);
  assert.equal(write.update.fields.endTime, undefined);
  assert.equal(write.update.fields.curatorEmail, undefined);
  assert.ok(write.updateMask.fieldPaths.includes("curatorEmail"));
  assert.deepEqual(write.updateTransforms, [
    {
      fieldPath: "moments",
      appendMissingElements: {
        values: [
          {
            mapValue: {
              fields: {
                id: stringValue("moment-2"),
                startTime: intValue(30),
                endTime: intValue(45),
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
});

test("new extension clips do not store curator email on public clip docs", async () => {
  const { api, requests } = makeHarness({ existingDocs: [] });

  await api.saveClip({
    videoId: "abc123",
    videoTitle: "A video",
    channelName: "A channel",
    startTime: 30,
    endTime: 45,
  });

  const create = requests.find(
    (request) => request.url.endsWith("/documents/clips") && request.method === "POST",
  );
  assert.ok(create, "expected a Firestore create request");
  assert.equal(create.body.fields.curatorEmail, undefined);
});
