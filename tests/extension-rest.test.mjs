import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { describe, it } from "node:test";

function loadExtensionRest({ existingClip = true } = {}) {
  const calls = [];
  const sandbox = {
    console,
    crypto: { randomUUID: () => "moment-1" },
    FIREBASE_CONFIG: {
      apiKey: "api-key",
      projectId: "project-id",
    },
    CuratdAuth: {
      getStoredSession: async () => ({
        idToken: "id-token",
        refreshToken: "refresh-token",
        uid: "user_1",
        email: "private@example.com",
        expiresAt: Date.now() + 3_600_000,
      }),
      saveSession: async () => {},
    },
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/documents/users/user_1")) {
        return jsonResponse({
          fields: {
            username: { stringValue: "curator" },
          },
        });
      }
      if (String(url).endsWith("/documents:runQuery")) {
        return jsonResponse(
          existingClip
            ? [
                {
                  document: {
                    name: "projects/project-id/databases/(default)/documents/clips/existingClip",
                    fields: {
                      userId: { stringValue: "user_1" },
                      videoId: { stringValue: "abc123" },
                      audioOnly: { booleanValue: false },
                      createdAt: { stringValue: "2026-01-01T00:00:00.000Z" },
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
        return jsonResponse({ writeResults: [{}] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("curatd-extension/firebase-rest.js", "utf8"), sandbox);
  return { api: sandbox.CuratdFirebaseRest, calls };
}

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe("extension Firestore REST saves", () => {
  it("appends moments with a commit transform and never writes curator email", async () => {
    const { api, calls } = loadExtensionRest({ existingClip: true });

    const result = await api.saveClip({
      videoId: "abc123",
      videoTitle: "Video",
      channelName: "Channel",
      startTime: 10,
      endTime: 20,
    });

    assert.equal(result.ok, true);
    assert.equal(result.clipId, "existingClip");
    assert.equal(result.merged, true);

    const commit = calls.find((call) => call.url.endsWith("/documents:commit"));
    assert.ok(commit, "expected Firestore commit call");
    assert.equal(commit.options.method, "POST");
    const body = JSON.parse(commit.options.body);
    const write = body.writes[0];
    assert.equal(
      write.update.name,
      "projects/project-id/databases/(default)/documents/clips/existingClip",
    );
    assert.ok(!("curatorEmail" in write.update.fields), "email must not be written publicly");
    assert.ok(!("moments" in write.update.fields), "moments must not be overwritten");
    assert.ok(write.updateMask.fieldPaths.includes("curatorEmail"), "legacy email should be deleted");
    assert.deepEqual(write.updateTransforms, [
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
                  addedAt: write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields.addedAt,
                },
              },
            },
          ],
        },
      },
    ]);
  });

  it("uses a deterministic owner/video document id for new extension clips", async () => {
    const { api, calls } = loadExtensionRest({ existingClip: false });

    const result = await api.saveClip({
      videoId: "abc123",
      videoTitle: "Video",
      startTime: 5,
      endTime: 15,
    });

    assert.equal(result.ok, true);
    assert.equal(result.clipId, "ext_user_1_abc123");
    assert.equal(result.merged, false);
    const commit = calls.find((call) => call.url.endsWith("/documents:commit"));
    const body = JSON.parse(commit.options.body);
    assert.equal(
      body.writes[0].update.name,
      "projects/project-id/databases/(default)/documents/clips/ext_user_1_abc123",
    );
  });
});
