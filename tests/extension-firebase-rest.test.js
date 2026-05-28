const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
    json: async () => data,
  };
}

function userDocument() {
  return {
    fields: {
      username: { stringValue: "alice" },
    },
  };
}

function existingClipDocument() {
  return {
    name: "projects/demo-project/databases/(default)/documents/clips/existing-clip",
    fields: {
      moments: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  id: { stringValue: "existing-moment" },
                  startTime: { integerValue: "1" },
                  endTime: { integerValue: "2" },
                },
              },
            },
          ],
        },
      },
    },
  };
}

async function runSaveClip({ existing }) {
  const requests = [];
  const code = fs.readFileSync(
    path.join(__dirname, "..", "curatd-extension", "firebase-rest.js"),
    "utf8",
  );
  const session = {
    idToken: "id-token",
    refreshToken: "refresh-token",
    uid: "user-1",
    email: "secret@example.com",
    expiresAt: Date.now() + 60 * 60 * 1000,
  };

  const context = {
    console,
    FIREBASE_CONFIG: { projectId: "demo-project", apiKey: "demo-key" },
    CuratdAuth: {
      getStoredSession: async () => session,
      saveSession: async () => {},
    },
    crypto: {
      randomUUID: () => "new-moment",
    },
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("/documents/users/user-1")) {
        return jsonResponse(userDocument());
      }
      if (String(url).includes(":runQuery")) {
        return jsonResponse(existing ? [{ document: existingClipDocument() }] : []);
      }
      if (String(url).includes(":commit")) {
        return jsonResponse({ writeResults: [{}] });
      }
      if (String(url).endsWith("/documents/clips")) {
        return jsonResponse({
          name: "projects/demo-project/databases/(default)/documents/clips/new-clip",
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };

  vm.createContext(context);
  vm.runInContext(code, context, { filename: "firebase-rest.js" });

  const result = await context.CuratdFirebaseRest.saveClip({
    videoId: "abc123def45",
    videoTitle: "A video",
    channelName: "A channel",
    startTime: 10,
    endTime: 20,
  });

  return { requests, result };
}

async function testMergedSaveUsesAtomicArrayTransform() {
  const { requests, result } = await runSaveClip({ existing: true });
  assert.equal(result.ok, true);
  assert.equal(result.merged, true);

  const commit = requests.find((request) => request.url.includes(":commit"));
  assert.ok(commit, "existing clip saves should use documents:commit");
  const body = JSON.parse(commit.options.body);
  const write = body.writes[0];

  assert.equal(write.currentDocument.exists, true);
  assert.deepEqual(write.updateMask.fieldPaths.includes("curatorEmail"), true);
  assert.equal(write.update.fields.moments, undefined);
  assert.equal(write.update.fields.curatorEmail, undefined);
  assert.equal(write.updateTransforms[0].fieldPath, "moments");
  assert.equal(
    write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields.id.stringValue,
    "new-moment",
  );
  assert.equal(
    requests.some((request) => String(request.options.body || "").includes("secret@example.com")),
    false,
  );
}

async function testNewClipDoesNotStoreEmail() {
  const { requests, result } = await runSaveClip({ existing: false });
  assert.equal(result.ok, true);
  assert.equal(result.merged, false);

  const create = requests.find((request) => request.url.endsWith("/documents/clips"));
  assert.ok(create, "new clip saves should create a clip document");
  const body = JSON.parse(create.options.body);
  assert.equal(body.fields.curatorEmail, undefined);
  assert.equal(body.fields.userId.stringValue, "user-1");
  assert.equal(
    requests.some((request) => String(request.options.body || "").includes("secret@example.com")),
    false,
  );
}

(async () => {
  await testMergedSaveUsesAtomicArrayTransform();
  await testNewClipDoesNotStoreEmail();
  console.log("extension-firebase-rest regression tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
