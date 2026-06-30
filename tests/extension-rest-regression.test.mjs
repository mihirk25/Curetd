import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadExtensionRest({ runQueryDocs = [] } = {}) {
  const requests = [];
  const session = {
    idToken: "id-token",
    refreshToken: "refresh-token",
    uid: "user_123",
    email: "user@example.com",
    expiresAt: Date.now() + 60 * 60 * 1000,
  };

  const context = {
    FIREBASE_CONFIG: {
      apiKey: "api-key",
      projectId: "demo-project",
    },
    CuratdAuth: {
      getStoredSession: async () => session,
      saveSession: async (next) => next,
    },
    crypto: {
      randomUUID: () => "moment-id-1",
    },
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/documents/users/user_123")) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              fields: {
                username: { stringValue: "alice" },
              },
            }),
        };
      }
      if (String(url).endsWith("/documents:runQuery")) {
        return {
          ok: true,
          json: async () => runQueryDocs,
        };
      }
      if (String(url).endsWith("/documents:commit")) {
        return {
          ok: true,
          text: async () => JSON.stringify({ commitTime: "now" }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    },
    console,
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);

  const source = await readFile(
    new URL("../curatd-extension/firebase-rest.js", import.meta.url),
    "utf8",
  );
  vm.runInContext(source, context, { filename: "firebase-rest.js" });
  return { api: context.CuratdFirebaseRest, requests };
}

function commitBody(requests) {
  const commit = requests.find((req) => req.url.endsWith("/documents:commit"));
  assert.ok(commit, "expected a Firestore commit request");
  return JSON.parse(commit.options.body);
}

{
  const { api, requests } = await loadExtensionRest();
  const result = await api.saveClip({
    videoId: "abc123",
    videoTitle: "Video",
    channelName: "Channel",
    startTime: 10,
    endTime: 20,
  });

  assert.equal(result.ok, true);
  assert.equal(result.clipId, "user_123_video_abc123");
  assert.equal(result.merged, false);

  const body = commitBody(requests);
  assert.equal(body.writes.length, 1);
  const write = body.writes[0];
  assert.equal(
    write.update.name,
    "projects/demo-project/databases/(default)/documents/clips/user_123_video_abc123",
  );
  assert.ok(write.updateTransforms, "expected atomic array transform");
  assert.equal(write.updateTransforms.length, 1);
  assert.equal(write.updateTransforms[0].fieldPath, "moments");
  const appendedMoment =
    write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields;
  assert.deepEqual(appendedMoment.id, { stringValue: "moment-id-1" });
  assert.deepEqual(appendedMoment.startTime, { integerValue: "10" });
  assert.deepEqual(appendedMoment.endTime, { integerValue: "20" });
  assert.deepEqual(appendedMoment.note, { stringValue: "" });
  assert.deepEqual(appendedMoment.topic, { stringValue: "General" });
  assert.match(appendedMoment.addedAt.stringValue, /^\d{4}-\d{2}-\d{2}T/);
  const fields = write.update.fields;
  assert.equal(fields.userId.stringValue, "user_123");
  assert.equal(fields.curatorEmail, undefined);
  assert.ok(
    write.updateMask.fieldPaths.includes("curatorEmail"),
    "legacy public curatorEmail should be deleted by update mask",
  );
  assert.equal(fields.moments, undefined, "moments must not be overwritten wholesale");
}

{
  const existingDoc = {
    document: {
      name: "projects/demo-project/databases/(default)/documents/clips/legacyClip",
      fields: {
        userId: { stringValue: "user_123" },
        videoId: { stringValue: "abc123" },
        audioOnly: { booleanValue: false },
        moments: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    id: { stringValue: "old" },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
  const { api, requests } = await loadExtensionRest({ runQueryDocs: [existingDoc] });
  const result = await api.saveClip({
    videoId: "abc123",
    videoTitle: "Video",
    channelName: "Channel",
    startTime: 30,
    endTime: 40,
  });

  assert.equal(result.clipId, "legacyClip");
  assert.equal(result.merged, true);
  const body = commitBody(requests);
  assert.equal(body.writes[0].update.fields.moments, undefined);
  assert.equal(body.writes[0].updateTransforms[0].fieldPath, "moments");
}
