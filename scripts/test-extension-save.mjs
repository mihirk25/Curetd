import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("curatd-extension/firebase-rest.js", "utf8");

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

function loadExtension({ existingClip = null } = {}) {
  const requests = [];
  const context = {
    console,
    Date,
    Error,
    FIREBASE_CONFIG: {
      apiKey: "test-api-key",
      projectId: "curatd-test",
    },
    CuratdAuth: {
      async getStoredSession() {
        return {
          idToken: "id-token",
          refreshToken: "refresh-token",
          uid: "alice",
          email: "alice@example.com",
          expiresAt: Date.now() + 3_600_000,
        };
      },
      async saveSession() {},
    },
    crypto: {
      randomUUID() {
        return "moment-123";
      },
    },
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url: String(url), method: options.method || "GET", body });

      if (String(url).endsWith("/documents/users/alice")) {
        return jsonResponse({
          fields: {
            username: { stringValue: "alice" },
          },
        });
      }

      if (String(url).endsWith("/documents:runQuery")) {
        return jsonResponse(
          existingClip
            ? [
                {
                  document: {
                    name: "projects/curatd-test/databases/(default)/documents/clips/existingClip",
                    fields: {
                      videoId: { stringValue: "abc123xyz00" },
                      userId: { stringValue: "alice" },
                      audioOnly: { booleanValue: false },
                      moments: {
                        arrayValue: {
                          values: [
                            {
                              mapValue: {
                                fields: {
                                  id: { stringValue: "existing-moment" },
                                  startTime: { integerValue: "1" },
                                  endTime: { integerValue: "5" },
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              ]
            : [],
        );
      }

      if (String(url).endsWith("/documents:commit")) {
        return jsonResponse({ writeResults: [{}] });
      }

      if (String(url).endsWith("/documents/clips") && options.method === "POST") {
        return jsonResponse({
          name: "projects/curatd-test/databases/(default)/documents/clips/newClip",
        });
      }

      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    },
  };

  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "firebase-rest.js" });
  return { context, requests };
}

const clipData = {
  videoId: "abc123xyz00",
  videoTitle: "Concurrency Test",
  startTime: 10,
  endTime: 20,
  channelName: "Curatd",
};

{
  const { context, requests } = loadExtension({ existingClip: true });
  const result = await context.CuratdFirebaseRest.saveClip(clipData);
  assert.equal(result.merged, true);

  const commit = requests.find((req) => req.url.endsWith("/documents:commit"));
  assert.ok(commit, "existing clip save should use documents:commit");
  const write = commit.body.writes[0];
  assert.deepEqual(write.updateMask.fieldPaths.includes("moments"), false);
  assert.equal(write.updateTransforms[0].fieldPath, "moments");
  assert.equal(write.updateTransforms[0].appendMissingElements.values.length, 1);
  assert.equal(write.update.fields.curatorEmail, undefined);
  assert.equal(write.update.fields.userId.stringValue, "alice");
}

{
  const { context, requests } = loadExtension({ existingClip: false });
  const result = await context.CuratdFirebaseRest.saveClip(clipData);
  assert.equal(result.merged, false);

  const create = requests.find((req) => req.url.endsWith("/documents/clips") && req.method === "POST");
  assert.ok(create, "new clip save should create a clip document");
  assert.equal(create.body.fields.curatorEmail, undefined);
  assert.equal(create.body.fields.userId.stringValue, "alice");
  assert.equal(create.body.fields.moments.arrayValue.values.length, 1);
}

console.log("extension save regressions passed");
