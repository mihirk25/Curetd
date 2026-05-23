import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

function okJson(body) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("saveClip appends moments atomically for existing clips", async () => {
  const requests = [];
  const context = {
    FIREBASE_CONFIG: {
      apiKey: "test-api-key",
      projectId: "demo-curatd",
    },
    CuratdAuth: {
      async getStoredSession() {
        return {
          idToken: "id-token",
          refreshToken: "refresh-token",
          uid: "user-1",
          email: "user@example.com",
          expiresAt: Date.now() + 3_600_000,
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
      requests.push({ url: String(url), options });

      if (String(url).endsWith("/documents/users/user-1")) {
        return okJson({
          fields: {
            username: { stringValue: "curator" },
          },
        });
      }

      if (String(url).endsWith("/documents:runQuery")) {
        return okJson([
          {
            document: {
              name: "projects/demo-curatd/databases/(default)/documents/clips/clip-1",
              fields: {
                moments: {
                  arrayValue: {
                    values: [
                      {
                        mapValue: {
                          fields: {
                            id: { stringValue: "moment-existing" },
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
        return okJson({});
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    await readFile(new URL("./firebase-rest.js", import.meta.url), "utf8"),
    context,
  );

  const result = await context.CuratdFirebaseRest.saveClip({
    videoId: "abc123",
    videoTitle: "A video",
    startTime: 10,
    endTime: 20,
    channelName: "A channel",
  });

  assert.equal(result.merged, true);
  assert.equal(result.clipId, "clip-1");

  const commitRequest = requests.find((request) => request.url.endsWith("/documents:commit"));
  assert.ok(commitRequest, "expected a Firestore commit request");

  const body = JSON.parse(commitRequest.options.body);
  assert.equal(body.writes.length, 1);

  const write = body.writes[0];
  assert.equal(
    write.update.name,
    "projects/demo-curatd/databases/(default)/documents/clips/clip-1",
  );
  assert.equal(write.currentDocument.exists, true);
  assert.equal(write.update.fields.moments, undefined);
  assert.ok(!write.updateMask.fieldPaths.includes("moments"));
  assert.equal(write.updateTransforms.length, 1);
  assert.equal(write.updateTransforms[0].fieldPath, "moments");
  const appendedMoment =
    write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields;
  assert.equal(appendedMoment.id.stringValue, "moment-new");
  assert.equal(appendedMoment.startTime.integerValue, "10");
  assert.equal(appendedMoment.endTime.integerValue, "20");
  assert.equal(appendedMoment.note.stringValue, "");
  assert.equal(appendedMoment.topic.stringValue, "General");
  assert.match(appendedMoment.addedAt.timestampValue, /^\d{4}-\d{2}-\d{2}T/);
});
