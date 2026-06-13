import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

function firestoreDoc(fields) {
  const encoded = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") encoded[key] = { stringValue: value };
    else if (typeof value === "boolean") encoded[key] = { booleanValue: value };
    else if (typeof value === "number") encoded[key] = { integerValue: String(value) };
    else if (Array.isArray(value)) encoded[key] = { arrayValue: { values: [] } };
    else encoded[key] = { nullValue: null };
  }
  return { fields: encoded };
}

async function loadRestClient(fetchImpl) {
  const code = await readFile(new URL("../curatd-extension/firebase-rest.js", import.meta.url), "utf8");
  const context = {
    console,
    crypto: { randomUUID: () => "moment-1" },
    FIREBASE_CONFIG: {
      apiKey: "test-key",
      projectId: "curatd-test",
    },
    CuratdAuth: {
      async getStoredSession() {
        return {
          idToken: "id-token",
          refreshToken: "refresh-token",
          uid: "user-a",
          email: "user-a@example.com",
          expiresAt: Date.now() + 3600_000,
        };
      },
      async saveSession() {},
    },
    fetch: fetchImpl,
  };
  context.globalThis = context;
  vm.runInNewContext(code, context, { filename: "firebase-rest.js" });
  return context.CuratdFirebaseRest;
}

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

async function testExistingClipUsesAtomicAppend() {
  const requests = [];
  const client = await loadRestClient(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/users/user-a")) {
      return jsonResponse(firestoreDoc({ username: "alice" }));
    }
    if (String(url).endsWith("/documents:runQuery")) {
      return jsonResponse([
        {
          document: {
            name: "projects/curatd-test/databases/(default)/documents/clips/existing-clip",
            ...firestoreDoc({ userId: "user-a", videoId: "abc123", audioOnly: false, moments: [] }),
          },
        },
      ]);
    }
    if (String(url).endsWith("/documents:commit")) {
      return jsonResponse({ writeResults: [{}] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await client.saveClip({
    videoId: "abc123",
    videoTitle: "Atomic saves",
    startTime: 10,
    endTime: 20,
    channelName: "Curatd",
  });

  assert.deepEqual(result, { ok: true, clipId: "existing-clip", merged: true });
  assert.equal(requests.some((req) => req.options.method === "PATCH"), false);
  const commit = requests.find((req) => String(req.url).endsWith("/documents:commit"));
  assert.ok(commit, "existing clip saves must use documents:commit");
  const body = JSON.parse(commit.options.body);
  assert.equal(JSON.stringify(body).includes("curatorEmail"), false);
  assert.equal(body.writes.length, 1);
  assert.equal(body.writes[0].update.name, "projects/curatd-test/databases/(default)/documents/clips/existing-clip");
  assert.deepEqual(body.writes[0].updateTransforms, [
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
                addedAt: body.writes[0].updateTransforms[0].appendMissingElements.values[0].mapValue.fields.addedAt,
              },
            },
          },
        ],
      },
    },
  ]);
}

async function testNewClipDoesNotWriteEmail() {
  const requests = [];
  const client = await loadRestClient(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/users/user-a")) {
      return jsonResponse(firestoreDoc({ username: "alice" }));
    }
    if (String(url).endsWith("/documents:runQuery")) {
      return jsonResponse([]);
    }
    if (String(url).endsWith("/documents/clips")) {
      return jsonResponse({
        name: "projects/curatd-test/databases/(default)/documents/clips/new-clip",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await client.saveClip({
    videoId: "new123",
    videoTitle: "No public email",
    startTime: 1,
    endTime: 2,
    channelName: "Curatd",
  });

  assert.deepEqual(result, { ok: true, clipId: "new-clip", merged: false });
  const create = requests.find((req) => String(req.url).endsWith("/documents/clips"));
  assert.ok(create, "new clip saves must create a clip document");
  assert.equal(JSON.stringify(JSON.parse(create.options.body)).includes("curatorEmail"), false);
}

await testExistingClipUsesAtomicAppend();
await testNewClipDoesNotWriteEmail();
