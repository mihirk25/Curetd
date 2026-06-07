import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function restValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(restValue) } };
  const fields = {};
  for (const [key, nested] of Object.entries(value)) fields[key] = restValue(nested);
  return { mapValue: { fields } };
}

function restDoc(name, data) {
  const fields = {};
  for (const [key, value] of Object.entries(data)) fields[key] = restValue(value);
  return { name, fields };
}

function response(data, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function loadExtension(fetchImpl) {
  const context = {
    console,
    crypto: { randomUUID: () => "moment-1" },
    CuratdAuth: {
      getStoredSession: async () => ({
        idToken: "token",
        refreshToken: "refresh",
        uid: "alice",
        email: "alice@example.com",
        expiresAt: Date.now() + 3600_000,
      }),
      saveSession: async () => {},
    },
    FIREBASE_CONFIG: {
      apiKey: "api-key",
      projectId: "curatd-test",
    },
    fetch: fetchImpl,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync("curatd-extension/firebase-rest.js", "utf8"), context);
  return context.CuratdFirebaseRest;
}

async function testExistingClipUsesCommitTransform() {
  const requests = [];
  const api = loadExtension(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/users/alice")) {
      return response(restDoc("projects/curatd-test/databases/(default)/documents/users/alice", {
        username: "alice",
      }));
    }
    if (String(url).includes(":runQuery")) {
      return response([
        {
          document: restDoc("projects/curatd-test/databases/(default)/documents/clips/existing", {
            userId: "alice",
            videoId: "abc123",
            audioOnly: false,
            moments: [],
          }),
        },
      ]);
    }
    if (String(url).includes("documents:commit")) return response({});
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await api.saveClip({
    videoId: "abc123",
    videoTitle: "Video",
    startTime: 12,
    endTime: 34,
    channelName: "Channel",
  });

  assert.deepEqual(result, { ok: true, clipId: "existing", merged: true });
  const commit = requests.find((req) => req.url.includes("documents:commit"));
  assert.ok(commit, "expected existing clip save to use commit endpoint");
  const body = JSON.parse(commit.options.body);
  assert.equal(body.writes.length, 2);
  assert.equal(body.writes[0].update.name, "projects/curatd-test/databases/(default)/documents/clips/existing");
  assert.equal(body.writes[0].update.fields.curatorEmail, undefined);
  assert.ok(body.writes[0].updateMask.fieldPaths.includes("curatorEmail"));
  assert.equal(
    body.writes[1].transform.fieldTransforms[0].appendMissingElements.values[0].mapValue.fields.id.stringValue,
    "moment-1",
  );
}

async function testNewClipDoesNotWriteEmail() {
  const requests = [];
  const api = loadExtension(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/users/alice")) {
      return response(restDoc("projects/curatd-test/databases/(default)/documents/users/alice", {
        username: "alice",
      }));
    }
    if (String(url).includes(":runQuery")) return response([]);
    if (String(url).endsWith("/clips")) {
      return response({ name: "projects/curatd-test/databases/(default)/documents/clips/newclip" });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await api.saveClip({
    videoId: "new123",
    videoTitle: "New Video",
    startTime: 1,
    endTime: 5,
    channelName: "Channel",
  });

  assert.deepEqual(result, { ok: true, clipId: "newclip", merged: false });
  const create = requests.find((req) => req.url.endsWith("/clips"));
  assert.ok(create, "expected new clip save to create a clip");
  const body = JSON.parse(create.options.body);
  assert.equal(body.fields.curatorEmail, undefined);
  assert.equal(body.fields.userId.stringValue, "alice");
}

await testExistingClipUsesCommitTransform();
await testNewClipDoesNotWriteEmail();
