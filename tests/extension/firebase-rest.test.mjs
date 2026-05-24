import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../curatd-extension/firebase-rest.js", import.meta.url), "utf8");

function jsonResponse(body) {
  return {
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function loadFirebaseRest(fetchImpl) {
  const context = {
    FIREBASE_CONFIG: {
      apiKey: "test-api-key",
      projectId: "test-project",
    },
    CuratdAuth: {
      getStoredSession: async () => ({
        idToken: "id-token",
        refreshToken: "refresh-token",
        uid: "user-1",
        email: "user@example.com",
        expiresAt: Date.now() + 3_600_000,
      }),
      saveSession: async () => {},
    },
    fetch: fetchImpl,
    crypto: {
      randomUUID: () => "moment-1",
    },
    console,
    Date,
    Error,
    JSON,
    Math,
    Number,
    Object,
    String,
    Array,
    encodeURIComponent,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.CuratdFirebaseRest;
}

test("existing extension saves append a moment atomically", async () => {
  const requests = [];
  const rest = loadFirebaseRest(async (url, options = {}) => {
    requests.push({ url, options });

    if (String(url).includes("/documents/users/user-1")) {
      return jsonResponse({
        fields: {
          username: { stringValue: "curator" },
        },
      });
    }

    if (String(url).endsWith("/documents:runQuery")) {
      return jsonResponse([
        {
          document: {
            name: "projects/test-project/databases/(default)/documents/clips/clip-1",
            fields: {
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
      return jsonResponse({ writeResults: [{}] });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await rest.saveClip({
    videoId: "abc123",
    videoTitle: "Test video",
    channelName: "Test channel",
    startTime: 10,
    endTime: 20,
  });

  assert.deepEqual(result, { ok: true, clipId: "clip-1", merged: true });

  const commit = requests.find((request) => String(request.url).endsWith("/documents:commit"));
  assert.ok(commit, "expected existing clip saves to use the commit endpoint");

  const body = JSON.parse(commit.options.body);
  const write = body.writes[0];
  assert.equal(write.update.name, "projects/test-project/databases/(default)/documents/clips/clip-1");
  assert.equal(write.update.fields.moments, undefined);
  assert.ok(!write.updateMask.fieldPaths.includes("moments"));
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
