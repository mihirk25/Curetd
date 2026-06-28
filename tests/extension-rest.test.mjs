import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function jsonResponse(ok, body, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

function loadExtension({ existingClip }) {
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
          uid: "user1",
          email: "alice@example.com",
          expiresAt: Date.now() + 3_600_000,
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
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), options, body });

      if (String(url).includes("/documents/users/user1")) {
        return jsonResponse(true, {
          fields: {
            username: { stringValue: "alice" },
          },
        });
      }

      if (String(url).endsWith("/documents:runQuery")) {
        return jsonResponse(
          true,
          existingClip
            ? [
                {
                  document: {
                    name: "projects/test-project/databases/(default)/documents/clips/existingClip",
                    fields: {
                      userId: { stringValue: "user1" },
                      videoId: { stringValue: "abc12345678" },
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
              ]
            : [],
        );
      }

      if (String(url).endsWith("/documents:commit")) {
        return jsonResponse(true, { commitTime: "2026-01-01T00:00:00Z" });
      }

      if (String(url).endsWith("/documents/clips")) {
        return jsonResponse(true, {
          name: "projects/test-project/databases/(default)/documents/clips/newClip",
        });
      }

      return jsonResponse(false, { error: { message: `Unexpected URL: ${url}` } });
    },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync("curatd-extension/firebase-rest.js", "utf8"), context);
  return { context, calls };
}

const clipInput = {
  videoId: "abc12345678",
  videoTitle: "Video title",
  startTime: 10,
  endTime: 20,
  channelName: "Channel",
};

{
  const { context, calls } = loadExtension({ existingClip: true });
  const result = await context.CuratdFirebaseRest.saveClip(clipInput);
  assert.equal(result.merged, true);

  const commit = calls.find((call) => call.url.endsWith("/documents:commit"));
  assert.ok(commit, "existing clip save should use Firestore commit");
  assert.equal(calls.some((call) => call.options.method === "PATCH"), false);
  const write = commit.body.writes[0];
  assert.equal(write.update.name, "projects/test-project/databases/(default)/documents/clips/existingClip");
  assert.equal(write.update.fields.curatorEmail, undefined);
  assert.equal(write.update.fields.moments, undefined);
  assert.ok(write.updateMask.fieldPaths.includes("curatorEmail"));
  assert.equal(write.updateTransforms[0].fieldPath, "moments");
  assert.equal(JSON.stringify(write.updateTransforms[0]).includes("moment-1"), true);
  assert.equal(JSON.stringify(commit.body).includes("alice@example.com"), false);
}

{
  const { context, calls } = loadExtension({ existingClip: false });
  const result = await context.CuratdFirebaseRest.saveClip(clipInput);
  assert.equal(result.merged, false);

  const create = calls.find((call) => call.url.endsWith("/documents/clips"));
  assert.ok(create, "new clip save should create a clip document");
  assert.equal(create.body.fields.userId.stringValue, "user1");
  assert.equal(create.body.fields.curatorEmail, undefined);
  assert.equal(JSON.stringify(create.body).includes("alice@example.com"), false);
}
